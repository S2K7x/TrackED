// Decorative line art: the brand spark and the animated wave bundle on the intro.
const NS = "http://www.w3.org/2000/svg";

/** Thin radiating rays, like a sparkle. */
export function drawSpark(g) {
  if (!g) return;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const r = i % 2 ? 6.5 : 9.5;
    const line = document.createElementNS(NS, "line");
    line.setAttribute("x1", 12 + Math.cos(a) * 2);
    line.setAttribute("y1", 12 + Math.sin(a) * 2);
    line.setAttribute("x2", 12 + Math.cos(a) * r);
    line.setAttribute("y2", 12 + Math.sin(a) * r);
    g.append(line);
  }
}

/**
 * A bundle of sine curves anchored at a start and end point (white dot → lime
 * dot), each with its own amplitude and frequency, slowly breathing.
 */
export function drawWaves(svg) {
  if (!svg) return;
  const W = 600, H = 180, x0 = 60, x1 = 540, y0 = 110, y1 = 70;
  const curves = [
    { amp: 46, freq: 2.0, phase: 0.0 },
    { amp: 34, freq: 2.5, phase: 0.6 },
    { amp: 26, freq: 3.0, phase: 1.1 },
    { amp: 40, freq: 3.5, phase: 1.9 },
    { amp: 20, freq: 4.0, phase: 2.6 },
    { amp: 30, freq: 1.5, phase: 3.3 },
  ];
  const base = document.createElementNS(NS, "line");
  Object.entries({ x1: 0, y1: y0 + 8, x2: W, y2: y1 - 8, stroke: "rgba(255,255,255,.25)", "stroke-width": 1 })
    .forEach(([k, v]) => base.setAttribute(k, v));
  svg.append(base);
  const paths = curves.map(() => {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", "rgba(255,255,255,.85)");
    p.setAttribute("stroke-width", "1.1");
    p.setAttribute("vector-effect", "non-scaling-stroke");
    svg.append(p);
    return p;
  });
  const dot = (cx, cy, r, fill) => {
    const c = document.createElementNS(NS, "circle");
    Object.entries({ cx, cy, r, fill }).forEach(([k, v]) => c.setAttribute(k, v));
    svg.append(c);
  };
  dot(x0, y0, 6, "#fff");
  dot(x1, y1, 7, "#d4ff3a");

  const draw = (t) => {
    curves.forEach((c, i) => {
      let d = "";
      for (let s = 0; s <= 80; s++) {
        const u = s / 80;
        const env = Math.sin(Math.PI * u);              // pinned at both ends
        const x = x0 + (x1 - x0) * u;
        const y = y0 + (y1 - y0) * u - env * c.amp * Math.sin(Math.PI * c.freq * u + c.phase + t * 0.8);
        d += (s ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
      }
      paths[i].setAttribute("d", d);
    });
  };
  draw(0);
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const loop = (ms) => {
    if (!svg.isConnected || svg.closest("[hidden]")) return; // stop once the intro is gone
    draw(ms / 1000);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
