// Tunes the One Euro filter used for the frame corners, following the procedure
// of Casiez, Roussel & Vogel (CHI 2012): minimise jitter when the hand is still
// and lag when it moves, on a simulated landmark signal.
//
//   node tools/tune-filter.mjs
//
// Signal model (normalised image coordinates, 30 Hz):
//  - still:  hand held still, Gaussian landmark noise σ (MediaPipe-like jitter ≈ 1 px at 640 px)
//  - moving: smooth back-and-forth hand motion (minimum-jerk-like sine, up to ~1.2 image widths / s)
// Metrics:
//  - jitter: standard deviation of the filtered output while still
//  - lag:    RMS error vs the true (noise-free) position while moving, with and
//            without the latency-compensating prediction used by the app
import { OneEuro } from "../src/one-euro.js";
import { extrapolate } from "../src/one-euro.js";

const HZ = 30, SECONDS = 20;
let SIGMA = 0.0016;

function gauss(rand) {
  // Box–Muller with a seeded PRNG so runs are reproducible
  const u = Math.max(1e-12, rand()), v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function prng(seed) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function evaluate({ minCutoff, beta }, lead = 0) {
  const rand = prng(42);
  // still
  let f = new OneEuro({ minCutoff, beta, dCutoff: 1 });
  const still = [];
  for (let i = 0; i < SECONDS * HZ; i++) still.push(f.filter(0.5 + gauss(rand) * SIGMA, i / HZ));
  const s = still.slice(HZ); // skip warm-up
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const jitter = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / s.length);
  // moving
  f = new OneEuro({ minCutoff, beta, dCutoff: 1 });
  let se = 0, n = 0;
  for (let i = 0; i < SECONDS * HZ; i++) {
    const t = i / HZ;
    const truth = 0.5 + 0.2 * Math.sin(2 * Math.PI * 0.9 * t);          // peak speed ≈ 1.13 / s
    const y = f.filter(truth + gauss(rand) * SIGMA, t);
    const shown = extrapolate(y, f.dx, lead);
    if (i > HZ) { se += (shown - truth) ** 2; n++; }
  }
  return { jitter, lag: Math.sqrt(se / n) };
}

// Casiez et al.'s procedure, made explicit: pick a jitter budget that is barely
// perceptible, then take the setting with the least lag (with prediction) that
// stays within that budget. Done for two noise levels (good light / dim light).
const JITTER_BUDGET_PX = 0.5;
const grid = [];
for (const minCutoff of [0.3, 0.5, 0.8, 1, 1.5, 2, 3, 4, 5, 7, 10]) for (const beta of [0, 1, 2, 4, 8, 12, 20, 30, 50, 80]) grid.push({ minCutoff, beta });

for (const sigmaPx of [1, 2.5]) {
  SIGMA = sigmaPx / 640;
  const raw = evaluate({ minCutoff: 1e6, beta: 0 });
  const rows = grid.map((g) => ({ ...g, ...evaluate(g), lagPredicted: evaluate(g, 1 / HZ).lag }));
  const ok = rows.filter((r) => r.jitter * 640 <= JITTER_BUDGET_PX).sort((a, b) => a.lagPredicted - b.lagPredicted);
  const px = (v) => (v * 640).toFixed(2);
  console.log(`\nnoise σ = ${sigmaPx} px (unfiltered jitter ${px(raw.jitter)} px)`);
  for (const r of ok.slice(0, 4)) console.log(`  minCutoff ${String(r.minCutoff).padEnd(4)} beta ${String(r.beta).padEnd(3)} jitter ${px(r.jitter)}  lag ${px(r.lag)}  lag+prediction ${px(r.lagPredicted)}`);
  const cur = rows.find((r) => r.minCutoff === 1.5 && r.beta === 8);
  console.log(`  current (1.5, 8): jitter ${px(cur.jitter)}  lag ${px(cur.lag)}  lag+prediction ${px(cur.lagPredicted)}`);
}
