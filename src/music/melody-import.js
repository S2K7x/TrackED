// "Your melody": turns a file, a recording or typed notes into a Learn-tab song
// (pure: no DOM, no Web Audio, so everything here is unit-tested).
//
// Three ways in, one way out:
//  - MIDI file (.mid): exact notes. The melody track is picked with simple
//    heuristics (track name, no drums, high mean pitch, mostly one note at a
//    time) and made monophonic with the "skyline" rule (highest note wins).
//  - Audio (a recording of one voice or instrument, or humming into the mic):
//    YIN pitch tracking (de Cheveigné & Kawahara 2002) every ~12 ms, a median
//    filter, then notes are cut where the pitch jumps or the sound stops.
//    Full mixes (band + singer) are NOT supported: monophonic pitch trackers
//    follow whichever instrument is loudest.
//  - Typed notes: "C4 D4 E4:2", "do ré mi", one token per note.
//
// Every melody is then normalized for TrackED's instruments: the key is found
// with the Krumhansl–Schmuckler profiles, the tune is moved to C major (or C
// minor), off-scale notes snap to the nearest scale note, and durations are
// rounded to quarter beats. At lesson time, fitToNotes() folds it into the
// range of the chosen instrument.
//
// Only the notes are kept (never lyrics or audio), on this device only.

import { SCALES, NOTE_NAMES } from "./theory.js";

export const MELODY_LIMITS = {
  midiBytes: 2 * 1024 * 1024,
  audioBytes: 40 * 1024 * 1024,
  audioSeconds: 90,          // longer audio is cut (analysis time grows linearly)
  recordSeconds: 20,
  minNotes: 3,
  maxNotes: 200,
  maxSongs: 20,
  titleLength: 40,
};

// ---------------- Files ----------------

/**
 * @param {{name?: string, type?: string, size: number}} file
 * @returns {{kind: "midi"|"audio"} | {error: string}}
 */
export function melodyFileKind(file) {
  if (!file) return { error: "No file selected." };
  if (!file.size) return { error: "That file is empty." };
  const name = (file.name || "").toLowerCase(), type = file.type || "";
  const mb = (n) => `${Math.round(n / 1024 / 1024)} MB`;
  if (/\.(mid|midi|kar)$/.test(name) || /midi/.test(type)) {
    return file.size > MELODY_LIMITS.midiBytes ? { error: `That MIDI file is too large (max ${mb(MELODY_LIMITS.midiBytes)}).` } : { kind: "midi" };
  }
  if (type.startsWith("audio/") || type.startsWith("video/") || /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac|webm|caf|aiff?)$/.test(name)) {
    return file.size > MELODY_LIMITS.audioBytes ? { error: `That audio file is too large (max ${mb(MELODY_LIMITS.audioBytes)}).` } : { kind: "audio" };
  }
  return { error: "Please pick a MIDI file (.mid) or an audio file (MP3, WAV, M4A…)." };
}

// ---------------- MIDI ----------------

/**
 * Parses a Standard MIDI File (format 0 or 1, PPQ or SMPTE timing).
 * Lyrics and other text are ignored; only track names are read.
 * @param {Uint8Array|ArrayBuffer} input
 * @returns {{tracks: {name: string, notes: {midi: number, start: number, dur: number, velocity: number, channel: number}[]}[], bpm: number}}
 */
export function parseMidi(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  let p = 0;
  const need = (n) => { if (p + n > b.length) throw new Error("This MIDI file is cut short."); };
  const u32 = () => { need(4); const v = (b[p] << 24 >>> 0) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3]; p += 4; return v; };
  const u16 = () => { need(2); const v = (b[p] << 8) | b[p + 1]; p += 2; return v; };
  const tag = () => { need(4); const s = String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]); p += 4; return s; };
  const vlq = () => { let v = 0; for (let i = 0; i < 4; i++) { need(1); const c = b[p++]; v = (v << 7) | (c & 0x7f); if (!(c & 0x80)) return v; } throw new Error("This MIDI file is damaged."); };

  // RIFF-wrapped MIDI (.rmi): skip to the "MThd" chunk
  if (b.length > 20 && String.fromCharCode(b[0], b[1], b[2], b[3]) === "RIFF") {
    for (let i = 12; i < b.length - 4; i++) if (b[i] === 0x4d && b[i + 1] === 0x54 && b[i + 2] === 0x68 && b[i + 3] === 0x64) { p = i; break; }
  }
  if (b.length < 14 || tag() !== "MThd") throw new Error("That is not a MIDI file.");
  const hlen = u32();
  const format = u16(), ntrks = u16(), division = u16();
  p += hlen - 6;
  if (format > 2) throw new Error("This MIDI format is not supported.");

  const raw = [];        // per track: {name, events: {tick, kind, ...}}
  const tempos = [];     // {tick, usPerQn}
  for (let t = 0; t < ntrks && p < b.length - 8; t++) {
    const id = tag(), len = u32();
    if (id !== "MTrk") { p += len; t--; continue; }
    const end = Math.min(b.length, p + len);
    const track = { name: "", events: [] };
    let tick = 0, status = 0;
    while (p < end) {
      tick += vlq();
      need(1);
      let s = b[p];
      if (s & 0x80) { p++; if (s < 0xf0) status = s; } else s = status;   // running status
      if (!s) throw new Error("This MIDI file is damaged.");
      if (s === 0xff) {
        need(1);
        const type = b[p++], l = vlq();
        need(l);
        if (type === 0x51 && l === 3) tempos.push({ tick, us: (b[p] << 16) | (b[p + 1] << 8) | b[p + 2] });
        else if (type === 0x03 && !track.name) track.name = String.fromCharCode(...b.subarray(p, p + Math.min(l, 64))).replace(/[^\x20-\x7e]/g, "").trim();
        p += l;
        if (type === 0x2f) break;
      } else if (s === 0xf0 || s === 0xf7) {
        p += vlq();
      } else {
        const hi = s & 0xf0, ch = s & 0x0f;
        const one = hi === 0xc0 || hi === 0xd0;
        need(one ? 1 : 2);
        const d1 = b[p++], d2 = one ? 0 : b[p++];
        if (hi === 0x90 && d2 > 0) track.events.push({ tick, on: true, ch, midi: d1, velocity: d2 / 127 });
        else if (hi === 0x80 || hi === 0x90) track.events.push({ tick, on: false, ch, midi: d1 });
      }
    }
    p = end;
    raw.push(track);
  }

  // ticks → seconds through the tempo map
  tempos.sort((a, c) => a.tick - c.tick);
  const smpte = division & 0x8000;
  const secondsAt = smpte
    ? ((fps, tpf) => (tick) => tick / (fps * tpf))(256 - (division >> 8), division & 0xff)
    : (() => {
      const ppq = division || 480;
      const map = [{ tick: 0, sec: 0, us: 500000 }];
      for (const t of tempos) {
        const last = map[map.length - 1];
        const sec = last.sec + ((t.tick - last.tick) * last.us) / 1e6 / ppq;
        if (t.tick === last.tick) last.us = t.us; else map.push({ tick: t.tick, sec, us: t.us });
      }
      return (tick) => {
        let m = map[0];
        for (const x of map) { if (x.tick > tick) break; m = x; }
        return m.sec + ((tick - m.tick) * m.us) / 1e6 / ppq;
      };
    })();

  const tracks = raw.map((tr) => {
    const open = new Map(), notes = [];
    for (const e of tr.events) {
      const key = e.ch * 128 + e.midi;
      if (e.on) {
        if (!open.has(key)) open.set(key, []);
        open.get(key).push(e);
      } else {
        const on = open.get(key)?.shift();
        if (on) {
          const start = secondsAt(on.tick);
          notes.push({ midi: on.midi, start, dur: Math.max(0.01, secondsAt(e.tick) - start), velocity: on.velocity, channel: on.ch });
        }
      }
    }
    notes.sort((a, c) => a.start - c.start || c.midi - a.midi);
    return { name: tr.name, notes };
  });
  const firstTempo = smpte ? 500000 : (tempos[0]?.us ?? 500000);
  return { tracks, bpm: Math.round(60e6 / firstTempo) };
}

const MELODY_NAME = /melod|lead|vocal|voice|voix|sing|solo|tune|theme|chant|flute|right|droite|main/i;
const ACCOMP_NAME = /drum|perc|bass|basse|chord|accomp|pad|string|left|gauche|batterie/i;

/** How "melodic" a track looks (higher = more likely the tune). */
export function melodyScore(track) {
  const notes = track.notes.filter((n) => n.channel !== 9);       // channel 10 = drums
  if (notes.length < MELODY_LIMITS.minNotes) return -Infinity;
  const mean = notes.reduce((s, n) => s + n.midi, 0) / notes.length;
  let overlaps = 0;
  for (let i = 1; i < notes.length; i++) if (notes[i].start < notes[i - 1].start + notes[i - 1].dur - 0.03) overlaps++;
  const mono = 1 - overlaps / notes.length;
  let score = mean + 20 * mono + Math.min(10, notes.length / 10);
  if (MELODY_NAME.test(track.name)) score += 40;
  if (ACCOMP_NAME.test(track.name)) score -= 40;
  return score;
}

/**
 * Skyline: one note at a time, the highest of notes that start together wins,
 * and each note is cut where the next one starts.
 */
export function skyline(notes, together = 0.03) {
  const sorted = notes.filter((n) => n.channel !== 9).slice().sort((a, c) => a.start - c.start || c.midi - a.midi);
  const out = [];
  for (const n of sorted) {
    const last = out[out.length - 1];
    if (last && n.start - last.start < together) {
      if (n.midi > last.midi) out[out.length - 1] = { ...n, start: last.start };
      continue;
    }
    if (last && last.start + last.dur > n.start) last.dur = n.start - last.start;
    out.push({ ...n });
  }
  return out.filter((n) => n.dur >= 0.04);
}

/** Picks the melody of a parsed MIDI file. @returns {{notes, trackName, beatSec}} */
export function midiMelody(parsed) {
  const ranked = parsed.tracks.map((t) => ({ t, s: melodyScore(t) })).filter((x) => x.s > -Infinity).sort((a, c) => c.s - a.s);
  if (!ranked.length) throw new Error("No melody found in this MIDI file.");
  const best = ranked[0].t;
  return { notes: skyline(best.notes), trackName: best.name, beatSec: 60 / (parsed.bpm || 120) };
}

// ---------------- Audio: YIN pitch tracking ----------------

/**
 * YIN pitch of one frame.
 * @param {Float32Array} x  samples; uses x[offset .. offset + W + tauMax]
 * @returns {{freq: number, clarity: number} | null}
 */
export function yin(x, sampleRate, { offset = 0, W = Math.round(sampleRate * 0.025), minHz = 70, maxHz = 1100, threshold = 0.12 } = {}) {
  const tauMin = Math.max(2, Math.floor(sampleRate / maxHz));
  const tauMax = Math.min(Math.ceil(sampleRate / minHz), x.length - offset - W - 1);
  if (tauMax <= tauMin + 2) return null;
  const d = new Float32Array(tauMax + 2);
  for (let tau = 1; tau <= tauMax + 1; tau++) {
    let s = 0;
    for (let j = 0; j < W; j++) { const v = x[offset + j] - x[offset + j + tau]; s += v * v; }
    d[tau] = s;
  }
  // cumulative mean normalized difference
  const c = new Float32Array(tauMax + 2);
  c[0] = 1;
  let run = 0;
  for (let tau = 1; tau <= tauMax + 1; tau++) { run += d[tau]; c[tau] = run > 0 ? (d[tau] * tau) / run : 1; }
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (c[t] < threshold) { while (t + 1 <= tauMax && c[t + 1] < c[t]) t++; tau = t; break; }
  }
  if (tau < 0) {                                   // no dip under the threshold: best guess, if clear enough
    let best = tauMin;
    for (let t = tauMin; t <= tauMax; t++) if (c[t] < c[best]) best = t;
    if (c[best] > 0.35) return null;
    tau = best;
  }
  // parabolic interpolation around the dip
  const a = c[tau - 1], m = c[tau], z = c[tau + 1];
  const den = a - 2 * m + z;
  const shift = den > 0 ? Math.max(-0.5, Math.min(0.5, (a - z) / (2 * den))) : 0;
  return { freq: sampleRate / (tau + shift), clarity: 1 - m };
}

export const freqToMidi = (f) => 69 + 12 * Math.log2(f / 440);

/**
 * Pitch track of a mono signal. Yields between chunks so the page stays responsive.
 * @returns {Promise<{hop: number, frames: {midi: number|null, rms: number}[]}>}
 */
export async function trackPitch(samples, sampleRate, { hopSec = 0.012, onProgress, yieldEvery = 200 } = {}) {
  const hop = Math.max(1, Math.round(sampleRate * hopSec));
  const W = Math.round(sampleRate * 0.025);
  const span = W + Math.ceil(sampleRate / 70) + 2;
  const frames = [];
  const total = Math.max(0, Math.floor((samples.length - span) / hop));
  for (let i = 0; i < total; i++) {
    const off = i * hop;
    let e = 0;
    for (let j = 0; j < W; j++) e += samples[off + j] * samples[off + j];
    const rms = Math.sqrt(e / W);
    const r = rms > 1e-4 ? yin(samples, sampleRate, { offset: off, W }) : null;
    frames.push({ midi: r && r.clarity > 0.6 ? freqToMidi(r.freq) : null, rms });
    if (yieldEvery && i % yieldEvery === yieldEvery - 1) {
      onProgress?.(i / total);
      await new Promise((res) => setTimeout(res, 0));
    }
  }
  onProgress?.(1);
  return { hop: hop / sampleRate, frames };
}

const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };

/**
 * Cuts a pitch track into notes: silence or a held pitch change starts a new
 * note, short blips are dropped, each note's pitch is the median of its frames.
 * @returns {{midi: number, start: number, dur: number}[]}
 */
export function segmentNotes({ hop, frames }, { minNote = 0.08, gate = 0.08 } = {}) {
  const peak = frames.reduce((m, f) => Math.max(m, f.rms), 0);
  const floor = Math.max(1e-3, peak * gate);
  // median-filter the voiced pitch (5 frames) to remove octave blips
  const pitch = frames.map((f, i) => {
    if (f.midi == null || f.rms < floor) return null;
    const win = [];
    for (let k = i - 2; k <= i + 2; k++) if (frames[k]?.midi != null && frames[k].rms >= floor) win.push(frames[k].midi);
    return median(win);
  });
  const minFrames = Math.max(2, Math.round(minNote / hop));
  const change = 3;                                 // frames a new pitch must hold
  const notes = [];
  let cur = null;
  const close = (endFrame) => {
    if (cur && endFrame - cur.from >= minFrames) {
      notes.push({ midi: Math.round(median(cur.vals)), start: cur.from * hop, dur: (endFrame - cur.from) * hop });
    }
    cur = null;
  };
  for (let i = 0; i < pitch.length; i++) {
    const m = pitch[i];
    if (m == null) { close(i); continue; }
    if (!cur) { cur = { from: i, vals: [m] }; continue; }
    const ref = median(cur.vals.slice(-8));
    if (Math.abs(m - ref) > 0.7) {
      // a new pitch only counts if it holds for a few frames (vibrato, scoops)
      let held = 1;
      while (held < change && pitch[i + held] != null && Math.abs(pitch[i + held] - m) < 0.7) held++;
      if (held >= change) { close(i); cur = { from: i, vals: [m] }; continue; }
    }
    cur.vals.push(m);
  }
  close(pitch.length);
  // notes of the same pitch with a tiny gap were one note with a dropout
  const merged = [];
  for (const n of notes) {
    const last = merged[merged.length - 1];
    if (last && last.midi === n.midi && n.start - (last.start + last.dur) < hop * 1.5) last.dur = n.start + n.dur - last.start;
    else merged.push({ ...n });
  }
  return merged;
}

/** Beat length guessed from the onsets: the median gap, folded into 0.3–0.9 s. */
export function guessBeat(notes) {
  const gaps = [];
  for (let i = 1; i < notes.length; i++) gaps.push(notes[i].start - notes[i - 1].start);
  let beat = gaps.length ? median(gaps.filter((g) => g > 0.05)) ?? 0.5 : 0.5;
  while (beat < 0.3) beat *= 2;
  while (beat > 0.9) beat /= 2;
  return beat;
}

// ---------------- Typed notes ----------------

const SOLFEGE = { do: 0, ut: 0, re: 2, "ré": 2, mi: 4, fa: 5, sol: 7, so: 7, la: 9, si: 11, ti: 11 };
const LETTER = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/**
 * "C4 D4 E4:2 - G" or "do ré mi:2". One token per note; ":2" = 2 beats;
 * "-" or "_" adds a beat of rest to the previous note; no octave = the
 * octave closest to the previous note (the first one is around middle C).
 * @returns {{notes: [number, number][], errors: string[]}}
 */
export function parseNoteText(text) {
  const notes = [], errors = [];
  let prev = 60;
  for (const tok of String(text).normalize("NFC").toLowerCase().split(/[\s,;|]+/).filter(Boolean)) {
    if (/^[-_.]+$/.test(tok) || tok === "r" || tok === "rest") {
      if (notes.length) notes[notes.length - 1][1] += tok.length > 1 && /^[-_.]+$/.test(tok) ? tok.length : 1;
      continue;
    }
    const m = tok.match(/^(do|ut|ré|re|mi|fa|sol|so|la|si|ti|[a-g])(#|♯|b|♭|s)?(-?\d)?(?::(\d+(?:[.,]\d+)?))?$/);
    if (!m) { errors.push(tok); continue; }
    const pc = ((SOLFEGE[m[1]] ?? LETTER[m[1]]) + (m[2] === "#" || m[2] === "♯" || m[2] === "s" ? 1 : m[2] ? -1 : 0) + 12) % 12;
    let midi;
    if (m[3] != null) midi = 12 * (Number(m[3]) + 1) + pc;
    else if (!notes.length) midi = 60 + pc;                 // first note: octave 4
    else { midi = prev - (((prev - pc) % 12) + 12) % 12; if (prev - midi > 6) midi += 12; }
    const beats = m[4] ? Number(m[4].replace(",", ".")) : 1;
    if (!(beats > 0 && beats <= 16) || midi < 21 || midi > 108) { errors.push(tok); continue; }
    notes.push([midi, beats]);
    prev = midi;
  }
  return { notes, errors };
}

// ---------------- Key, scale and lesson format ----------------

// Krumhansl & Kessler (1982) probe-tone profiles
const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function correlate(a, b) {
  const n = a.length, ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/**
 * Key finding on [midi, beats] steps. A melody must fit its scale, so the keys
 * that leave the fewest beats off-scale win first; among those, the
 * Krumhansl–Schmuckler correlation (weighted by note length) decides.
 * Without the first rule, K-S alone picked e.g. C# minor for a tune in A major
 * (both are close), and snapping to that scale changed real notes.
 * @returns {{root: number, mode: "major"|"minor", confidence: number, offScale: number}}
 */
export function detectKey(steps) {
  const hist = new Array(12).fill(0);
  const pc = (m) => ((Math.round(m) % 12) + 12) % 12;
  for (const [m, beats] of steps) hist[pc(m)] += Math.min(beats, 4);
  const total = hist.reduce((a, v) => a + v, 0) || 1;
  const weighted = hist.slice();
  if (steps.length) weighted[pc(steps[steps.length - 1][0])] += 2;   // tunes usually end on the tonic
  let best = null;
  for (let root = 0; root < 12; root++) {
    for (const [mode, prof] of [["major", KK_MAJOR], ["minor", KK_MINOR]]) {
      const inScale = new Set(SCALES[mode].map((s) => (s + root) % 12));
      const offScale = hist.reduce((a, v, i) => a + (inScale.has(i) ? 0 : v), 0) / total;
      const rotated = prof.map((_, i) => prof[(i - root + 12) % 12]);
      // short tunes fit a major key and its relative minor almost equally: lean major
      const confidence = correlate(weighted, rotated) - (mode === "minor" ? 0.03 : 0);
      const better = !best || offScale < best.offScale - 1e-9 || (Math.abs(offScale - best.offScale) <= 1e-9 && confidence > best.confidence + 1e-9);
      if (better) best = { root, mode, confidence, offScale };
    }
  }
  return best;
}

/**
 * Timed notes (seconds) → [midi, beats] steps, rounded to the grid (in beats:
 * quarter beats for MIDI; half beats for recordings, whose timing is looser).
 */
export function notesToSteps(notes, beatSec, grid = 0.25) {
  const q = (beats) => Math.min(8, Math.max(grid, Math.round(beats / grid) * grid));
  return notes.map((n, i) => {
    const next = notes[i + 1];
    const span = next ? next.start - n.start : n.dur;     // a rest belongs to the note before it
    return [Math.round(n.midi), q(span / beatSec)];
  });
}

/**
 * Moves a melody to C (major or minor) and snaps off-scale notes.
 * @returns {{notes: [number, number][], scale: "major"|"minor", key: string, snapped: number}}
 */
export function normalizeSteps(steps) {
  const { root, mode } = detectKey(steps);
  const shift = -(root > 6 ? root - 12 : root);             // the smallest move to C
  const allowed = SCALES[mode];
  let snapped = 0;
  const notes = steps.map(([m, beats]) => {
    let midi = Math.round(m) + shift;
    const pc = ((midi % 12) + 12) % 12;
    if (!allowed.includes(pc)) {
      snapped++;
      // nearest scale note; ties go down (a sharpened note usually leads up, but down sounds safer)
      midi += allowed.includes((pc + 11) % 12) ? -1 : 1;
    }
    return [midi, beats];
  });
  return { notes, scale: mode, key: `${NOTE_NAMES[root]} ${mode}`, snapped };
}

/**
 * Folds a melody into an instrument's notes: the best octave first, then any
 * note still out of range moves by octaves, then snaps to the nearest playable note.
 * @param {[number, number][]} steps
 * @param {number[]} available  ascending MIDI notes the instrument can play
 * @returns {{notes: [number, number][], folded: number}}
 */
export function fitToNotes(steps, available) {
  const lo = available[0], hi = available[available.length - 1];
  let bestK = 0, bestIn = -1;
  for (const k of [0, -1, 1, -2, 2, -3, 3]) {
    const n = steps.filter(([m]) => m + 12 * k >= lo && m + 12 * k <= hi).length;
    if (n > bestIn) { bestIn = n; bestK = k; }
  }
  let folded = 0;
  const notes = steps.map(([m, beats]) => {
    let midi = m + 12 * bestK;
    if (midi < lo || midi > hi) folded++;
    while (midi < lo) midi += 12;
    while (midi > hi) midi -= 12;
    if (midi < lo) midi = lo;
    let near = available[0];
    for (const a of available) if (Math.abs(a - midi) < Math.abs(near - midi)) near = a;
    return [near, beats];
  });
  return { notes, folded };
}

/**
 * Builds a saved "Your melody" song.
 * @param {[number, number][]} steps
 * @param {{title?: string, source: "midi"|"audio"|"text", bpm?: number, id?: string}} meta
 */
export function makeCustomSong(steps, { title, source, bpm = 96, id = `mine-${Date.now().toString(36)}` }) {
  const trimmed = steps.slice(0, MELODY_LIMITS.maxNotes);
  if (trimmed.length < MELODY_LIMITS.minNotes) throw new Error(`Only ${trimmed.length} note${trimmed.length === 1 ? "" : "s"} found: a melody needs at least ${MELODY_LIMITS.minNotes}.`);
  const norm = normalizeSteps(trimmed);
  const span = Math.max(...norm.notes.map(([m]) => m)) - Math.min(...norm.notes.map(([m]) => m));
  const from = { midi: "MIDI file", audio: "recording", text: "typed notes" }[source] ?? "import";
  return {
    id,
    title: cleanTitle(title) || "My melody",
    origin: `Your melody · ${from} · originally in ${norm.key}`,
    level: trimmed.length > 40 || span > 12 ? 3 : trimmed.length > 16 ? 2 : 1,
    custom: true,
    source,
    scale: norm.scale,
    bpm: Math.round(Math.min(160, Math.max(50, bpm))),
    notes: norm.notes,
    snapped: norm.snapped,
    truncated: steps.length > trimmed.length,
  };
}

export const cleanTitle = (t) => String(t ?? "").replace(/\.[a-z0-9]{2,4}$/i, "").replace(/[_]+/g, " ").replace(/[<>]/g, "").trim().slice(0, MELODY_LIMITS.titleLength);

/** Validates songs read back from storage (anything malformed is dropped). */
export function loadCustomSongs(json) {
  let list;
  try { list = JSON.parse(json || "[]"); } catch { return []; }
  if (!Array.isArray(list)) return [];
  return list.filter((s) => s && typeof s.id === "string" && /^mine-[a-z0-9]+$/.test(s.id)
    && Array.isArray(s.notes) && s.notes.length >= MELODY_LIMITS.minNotes && s.notes.length <= MELODY_LIMITS.maxNotes
    && s.notes.every((n) => Array.isArray(n) && Number.isFinite(n[0]) && n[0] >= 0 && n[0] <= 127 && n[1] > 0 && n[1] <= 16)
    && (s.scale === "major" || s.scale === "minor"))
    .slice(0, MELODY_LIMITS.maxSongs)
    .map((s) => ({ ...s, title: cleanTitle(s.title) || "My melody", custom: true }));
}

/** Newest first, capped. */
export function addCustomSong(list, song) {
  return [song, ...list.filter((s) => s.id !== song.id)].slice(0, MELODY_LIMITS.maxSongs);
}
