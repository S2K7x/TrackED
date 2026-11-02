// Fine adjustment of "Your 3D model" on the head: offset, rotation and scale on
// top of the automatic anchor fit. Saved per model (keyed by a hash of the file),
// so re-loading the same .glb restores its fit. Pure logic, unit-tested.

/** Slider definitions. Offsets in cm (canonical head space), rotations in degrees. */
export const FIT_FIELDS = [
  { key: "x", label: "Left / right", min: -10, max: 10, step: 0.1, unit: "cm" },
  { key: "y", label: "Down / up", min: -10, max: 10, step: 0.1, unit: "cm" },
  { key: "z", label: "Back / front", min: -10, max: 10, step: 0.1, unit: "cm" },
  { key: "rx", label: "Tilt", min: -180, max: 180, step: 1, unit: "°" },
  { key: "ry", label: "Turn", min: -180, max: 180, step: 1, unit: "°" },
  { key: "rz", label: "Roll", min: -180, max: 180, step: 1, unit: "°" },
  { key: "scale", label: "Scale", min: 0.5, max: 2, step: 0.01, unit: "×" },
];

export const DEFAULT_FIT = Object.freeze({ x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1 });

const STORE_KEY = "tracked.modelFits";
const MAX_MODELS = 20;

/** Returns a complete fit with every value finite, clamped and snapped to its step. */
export function clampFit(fit) {
  const out = { ...DEFAULT_FIT };
  for (const f of FIT_FIELDS) {
    const v = Number(fit?.[f.key]);
    if (!Number.isFinite(v)) continue;
    const snapped = Math.round(v / f.step) * f.step;
    out[f.key] = +Math.min(f.max, Math.max(f.min, snapped)).toFixed(4);
  }
  return out;
}

export function isDefaultFit(fit) {
  return FIT_FIELDS.every((f) => fit[f.key] === DEFAULT_FIT[f.key]);
}

/**
 * Identifies a model file by its size and an FNV-1a hash of up to 256 kB
 * (start and end), cheap even for large .glb files.
 * @param {ArrayBuffer} buf
 */
export function modelKey(buf) {
  const bytes = new Uint8Array(buf);
  const span = 128 * 1024;
  let h = 0x811c9dc5;
  const mix = (from, to) => {
    for (let i = from; i < to; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); }
  };
  if (bytes.length <= span * 2) mix(0, bytes.length);
  else { mix(0, span); mix(bytes.length - span, bytes.length); }
  return `${bytes.length.toString(36)}-${(h >>> 0).toString(36)}`;
}

/**
 * Per-model fits in a Storage-like object (localStorage in the app, a stub in tests).
 * Keeps the most recently used MAX_MODELS entries. Never throws.
 */
export class FitStore {
  constructor(storage) { this.storage = storage; }

  #read() {
    try {
      const v = JSON.parse(this.storage?.getItem(STORE_KEY) || "[]");
      return Array.isArray(v) ? v.filter((e) => e && typeof e.key === "string") : [];
    } catch { return []; }
  }

  #write(list) {
    try { this.storage?.setItem(STORE_KEY, JSON.stringify(list)); } catch { /* storage full or blocked */ }
  }

  get(key) {
    const e = this.#read().find((x) => x.key === key);
    return clampFit(e?.fit);
  }

  set(key, fit) {
    const list = this.#read().filter((x) => x.key !== key);
    const clean = clampFit(fit);
    if (!isDefaultFit(clean)) list.unshift({ key, fit: clean });
    this.#write(list.slice(0, MAX_MODELS));
  }
}
