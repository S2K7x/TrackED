// User-facing options. Values must match the names in renderer.js / faces.js.
// `tile` is the CSS background of the option's preview tile in the UI.

import { POWERS } from "./powers/catalog.js";

export const OPTIONS = {
  effect: [
    { value: "none", label: "None", tile: "linear-gradient(135deg,#f4f4f1,#d9d9d4)" },
    { value: "neon", label: "Neon", tile: "radial-gradient(circle at 30% 30%,var(--pick) 0 28%,#2a0a10 70%)" },
    { value: "tint", label: "Tint", tile: "linear-gradient(135deg,#fff 0%,var(--pick) 90%)" },
    { value: "thermal", label: "Thermal", tile: "linear-gradient(135deg,#1a0670 0%,#d6007a 40%,#ff6a00 70%,#ffe14d 100%)" },
    { value: "cartoon", label: "Cartoon", tile: "conic-gradient(from 30deg,#ffd166 0 25%,#ef476f 0 50%,#06d6a0 0 75%,#118ab2 0)" },
    { value: "glitch", label: "Glitch", tile: "linear-gradient(90deg,#00e5ff 0 33%,#1b1b1b 0 66%,#ff2bd6 0)" },
    { value: "pixel", label: "Pixel", tile: "conic-gradient(#9bc47a 25%,#e3d36a 0 50%,#9bc47a 0 75%,#e3d36a 0) 0 0/14px 14px" },
    { value: "kaleido", label: "Kaleido", tile: "conic-gradient(#f7b267,#f4845f,#c06c84,#6c5b7b,#f7b267)" },
    { value: "loupe", label: "Loupe", tile: "radial-gradient(circle,#fff 0 30%,#cfe3b8 31% 60%,#7fae5a 100%)" },
    { value: "invert", label: "Invert", tile: "linear-gradient(135deg,#111 50%,#f4f4f1 50%)" },
    { value: "bw", label: "Mono", tile: "linear-gradient(135deg,#fafafa,#3a3a3a)" },
    { value: "image", label: "Image", tile: "linear-gradient(160deg,#5f9a52,#e7d24a 70%,#f0a35e)" },
  ],
  face: [
    { value: "none", label: "None" },
    { value: "bigeyes", label: "Big eyes" },
    { value: "bigmouth", label: "Big mouth" },
    { value: "alien", label: "Alien" },
    { value: "balloon", label: "Balloon head" },
    { value: "tiny", label: "Tiny face" },
    { value: "swirl", label: "Swirl" },
    { value: "laser", label: "Laser eyes" },
    { value: "anon", label: "Anonymize" },
  ],
  mask: [
    { value: "none", label: "None", tile: "linear-gradient(135deg,#f4f4f1,#d9d9d4)" },
    { value: "wire", label: "Wireframe", tile: "repeating-linear-gradient(60deg,#0f1512 0 7px,var(--pick) 7px 8px),#0f1512" },
    { value: "visor", label: "Visor", tile: "linear-gradient(180deg,#e9e9e4 0 34%,#101418 34% 66%,#e9e9e4 66%)" },
    { value: "skull", label: "Skull", tile: "radial-gradient(circle at 35% 45%,#15120f 0 12%,transparent 13%),radial-gradient(circle at 65% 45%,#15120f 0 12%,transparent 13%),radial-gradient(circle,#f4f1e8,#a8a090)" },
    { value: "gold", label: "Gold", tile: "linear-gradient(135deg,#fff1b8,#e2b33c 35%,#a8741a 60%,#f0cc62 85%)" },
    { value: "feline", label: "Feline", tile: "repeating-linear-gradient(100deg,#d8641c 0 9px,#1d130c 9px 12px)" },
    { value: "warpaint", label: "War paint", tile: "linear-gradient(180deg,#e9d8c8 0 40%,var(--pick) 40% 50%,#e9d8c8 50% 58%,var(--pick) 58% 68%,#e9d8c8 68%)" },
    { value: "kitsune", label: "Kitsune", tile: "radial-gradient(circle at 50% 22%,var(--pick) 0 7%,transparent 8%),linear-gradient(to top right,transparent 36%,var(--pick) 36% 64%,transparent 64%) 12% 50%/38% 30% no-repeat,linear-gradient(to top left,transparent 36%,var(--pick) 36% 64%,transparent 64%) 88% 50%/38% 30% no-repeat,radial-gradient(circle,#fffdf8,#d8cfbf)" },
    { value: "custom", label: "Your mask", upload: "custom" },
    { value: "swap", label: "Face swap", upload: "swap" },
  ],
  maskArea: [
    { value: "face", label: "Appear & disappear" },
    { value: "frame", label: "Inside the frame" },
    { value: "always", label: "Always on" },
  ],
  accessory: [
    { value: "none", label: "None", tile: "linear-gradient(135deg,#f4f4f1,#d9d9d4)" },
    { value: "crown", label: "Crown", tile: "radial-gradient(circle at 30% 30%,#fff1b8,#e2b33c 45%,#8a5d14)" },
    { value: "halo", label: "Halo", tile: "radial-gradient(circle,transparent 0 38%,var(--pick) 40% 52%,transparent 54%),#1a1f1a" },
    { value: "shades", label: "Shades", tile: "radial-gradient(ellipse 22% 18% at 30% 50%,#0b0d10 98%,transparent),radial-gradient(ellipse 22% 18% at 70% 50%,#0b0d10 98%,transparent),#e9e9e4" },
    { value: "horns", label: "Horns", tile: "conic-gradient(from 200deg at 30% 90%,var(--pick) 0 12%,transparent 0),conic-gradient(from 140deg at 70% 90%,var(--pick) 0 12%,transparent 0),#2a1d1d" },
    { value: "partyhat", label: "Party hat", tile: "repeating-linear-gradient(60deg,#fff 0 8px,var(--pick) 8px 16px)" },
    { value: "mohawk", label: "Mohawk", tile: "repeating-linear-gradient(90deg,#e9e9e4 0 10px,var(--pick) 10px 14px)" },
    { value: "catears", label: "Cat ears", tile: "conic-gradient(from 150deg at 30% 80%,var(--pick) 0 17%,transparent 0),conic-gradient(from 150deg at 72% 80%,var(--pick) 0 17%,transparent 0),#f3e9ea" },
    // ready-made .glb models (original designs, built in Blender around the reference head: assets/models/)
    { value: "aero", label: "Aero helmet", glb: "assets/models/aero-helmet.glb",
      tile: "linear-gradient(180deg,transparent 0 44%,#1b1d22 44% 50%,#e09a2a 50% 80%,transparent 80%),radial-gradient(ellipse 46% 52% at 50% 56%,#f7f8fa 97%,transparent),linear-gradient(#232a33,#11151a)" },
    { value: "model", label: "Your 3D model", upload: "model" },
  ],
  anchor: [
    { value: "top", label: "On the head" },
    { value: "eyes", label: "On the eyes" },
    { value: "head", label: "Around the head" },
    { value: "ref", label: "As modelled (Blender head)" },
  ],
  size: [
    { value: "0.75", label: "75%" },
    { value: "1", label: "100%" },
    { value: "1.25", label: "125%" },
    { value: "1.5", label: "150%" },
  ],
  who: [
    { value: "all", label: "Everyone" },
    { value: "me", label: "Me" },
    { value: "others", label: "Others" },
  ],
  target: [
    { value: "all", label: "Everything" },
    { value: "people", label: "People" },
    { value: "background", label: "Background" },
    { value: "skin", label: "Skin" },
    { value: "hair", label: "Hair" },
    { value: "clothes", label: "Clothes" },
  ],
  shape: [
    { value: "rect", label: "Rectangle", icon: '<rect x="3" y="6" width="18" height="12"/>' },
    { value: "round", label: "Rounded", icon: '<rect x="3" y="6" width="18" height="12" rx="4"/>' },
    { value: "ellipse", label: "Ellipse", icon: '<ellipse cx="12" cy="12" rx="9.5" ry="6"/>' },
    { value: "circle", label: "Circle", icon: '<circle cx="12" cy="12" r="8"/>' },
    { value: "heart", label: "Heart", icon: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.1 4.1 0 0 1 12 7.4a4.1 4.1 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20z"/>' },
    { value: "star", label: "Star", icon: '<path d="M12 3.5l2.6 5.7 6.2.5-4.7 4.1 1.5 6.1L12 16.7l-5.6 3.2 1.5-6.1-4.7-4.1 6.2-.5z"/>' },
    { value: "diamond", label: "Diamond", icon: '<path d="M12 3l9 9-9 9-9-9z"/>' },
  ],
  border: [
    { value: "neon", label: "Neon edge" },
    { value: "rainbow", label: "Rainbow" },
    { value: "thick", label: "Thick edge" },
    { value: "none", label: "No edge" },
  ],
  timer: [
    { value: "0", label: "No timer" },
    { value: "3", label: "3 s" },
    { value: "10", label: "10 s" },
  ],
  gesture: [
    { value: "on", label: "Pinch to switch effect" },
    { value: "off", label: "Off" },
  ],
  signs: [
    { value: "on", label: "👍 photo · ✌️ next · 🖐 freeze" },
    { value: "off", label: "Off" },
  ],
  color: [
    { value: "#ff2d55", label: "Red" },
    { value: "#d4ff3a", label: "Lime" },
    { value: "#8a3cff", label: "Violet" },
    { value: "#ffd60a", label: "Yellow" },
    { value: "#00e5ff", label: "Cyan" },
    { value: "#30d158", label: "Green" },
    { value: "#ff6ec7", label: "Pink" },
    { value: "#ff9f0a", label: "Orange" },
    { value: "#ffffff", label: "White" },
  ],
};

// ---------------- Music mode (separate tabs, separate settings) ----------------
const NOTE_LABELS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
Object.assign(OPTIONS, {
  mode: [
    { value: "effects", label: "Effects" },
    { value: "music", label: "Music" },
    { value: "powers", label: "Powers" },
  ],
  instrument: [
    { value: "theremin", label: "Theremin", tile: "repeating-linear-gradient(180deg,#1b2a1f 0 9px,var(--pick) 9px 10px),#1b2a1f" },
    { value: "keys", label: "Keys", tile: "repeating-linear-gradient(90deg,#f4f4f1 0 9px,#141413 9px 11px)" },
    { value: "harp", label: "Harp", tile: "repeating-linear-gradient(90deg,#2b1d14 0 7px,#f0cc62 7px 8px)" },
    { value: "drums", label: "Drums", tile: "radial-gradient(circle at 30% 35%,var(--pick) 0 20%,transparent 21%),radial-gradient(circle at 70% 65%,#f4f4f1 0 20%,transparent 21%),#1d1d1b" },
    { value: "chords", label: "Chords", tile: "linear-gradient(135deg,#f0956a 0 33%,#e9d34b 33% 66%,#6fa35a 66%)" },
    { value: "arp", label: "Arp", tile: "repeating-linear-gradient(45deg,#141413 0 6px,var(--pick) 6px 9px)" },
    { value: "beats", label: "Beats", tile: "conic-gradient(var(--pick) 25%,#2a2a27 0 50%,var(--pick) 0 75%,#2a2a27 0) 0 0/16px 16px" },
    { value: "dj", label: "DJ", tile: "radial-gradient(circle,#141413 0 12%,var(--pick) 13% 16%,#141413 17% 40%,#3a3a36 41%)" },
  ],
  sound: [
    { value: "glass", label: "Glass" },
    { value: "epiano", label: "E-piano" },
    { value: "marimba", label: "Marimba" },
    { value: "pluck", label: "Pluck" },
    { value: "organ", label: "Organ" },
    { value: "strings", label: "Strings" },
    { value: "brass", label: "Brass" },
    { value: "choir", label: "Choir" },
    { value: "synth", label: "Synth" },
    { value: "pad", label: "Pad" },
    { value: "chip", label: "8-bit" },
  ],
  style: [
    { value: "off", label: "Band off" },
    { value: "pop", label: "Pop" },
    { value: "lofi", label: "Lo-fi" },
    { value: "house", label: "House" },
    { value: "rock", label: "Rock" },
    { value: "reggae", label: "Reggae" },
    { value: "hiphop", label: "Hip-hop" },
  ],
  progression: [
    { value: "pop", label: "I–V–vi–IV (pop)" },
    { value: "ballad", label: "I–vi–IV–V (ballad)" },
    { value: "epic", label: "vi–IV–I–V (epic)" },
    { value: "blues", label: "12-bar blues" },
    { value: "calm", label: "I–IV (calm)" },
  ],
  tempo: [
    { value: "auto", label: "Style tempo" },
    { value: "70", label: "70 BPM" },
    { value: "90", label: "90 BPM" },
    { value: "110", label: "110 BPM" },
    { value: "128", label: "128 BPM" },
  ],
  metronome: [
    { value: "off", label: "Metronome off" },
    { value: "on", label: "Metronome" },
  ],
  kit: [
    { value: "auto", label: "Style kit" },
    { value: "acoustic", label: "Acoustic" },
    { value: "electro", label: "Electro 808" },
    { value: "lofi", label: "Lo-fi" },
  ],
  scale: [
    { value: "pentatonic", label: "Pentatonic" },
    { value: "minorPenta", label: "Minor penta" },
    { value: "major", label: "Major" },
    { value: "minor", label: "Minor" },
    { value: "blues", label: "Blues" },
    { value: "dorian", label: "Dorian" },
    { value: "chromatic", label: "Chromatic" },
  ],
  root: NOTE_LABELS.map((label, i) => ({ value: String(i), label })),
  octave: [
    { value: "3", label: "Low" },
    { value: "4", label: "Middle" },
    { value: "5", label: "High" },
  ],
  snap: [
    { value: "locked", label: "Locked to notes" },
    { value: "soft", label: "Soft snap" },
    { value: "free", label: "Free glide" },
  ],
  reverb: [
    { value: "off", label: "Dry" },
    { value: "room", label: "Room" },
    { value: "hall", label: "Hall" },
  ],
  echo: [
    { value: "off", label: "No echo" },
    { value: "on", label: "Echo" },
  ],
  midi: [
    { value: "off", label: "MIDI off" },
    { value: "on", label: "Send MIDI" },
  ],
});

/** Tabs of the music mode (the effects tabs are hidden while it is on). */
export const MUSIC_TABS = [
  { id: "instrument", label: "Play", groups: ["instrument", "sound", "looper"] },
  { id: "band", label: "Band", groups: ["preset", "style", "progression", "tempo", "metronome", "kit"] },
  { id: "learn", label: "Learn", groups: ["lesson"] },
  { id: "notes", label: "Notes", groups: ["scale", "root", "octave", "snap"] },
  { id: "mix", label: "Mix", groups: ["reverb", "echo", "midi"] },
];

// ---------------- Superpower mode (separate tabs, separate settings) ----------------
Object.assign(OPTIONS, {
  power: POWERS.map((p) => ({ value: p.id, label: p.label, tile: p.tile, icon: p.icon })),
  intensity: [
    { value: "subtle", label: "Subtle" },
    { value: "strong", label: "Strong" },
    { value: "epic", label: "Epic" },
  ],
  cloak: [
    { value: "shimmer", label: "Shimmer" },
    { value: "clear", label: "Clear" },
    { value: "ghost", label: "Ghost" },
  ],
  cloneCount: [
    { value: "2", label: "2 clones" },
    { value: "4", label: "4 clones" },
  ],
  activation: [
    { value: "gesture", label: "With a gesture" },
    { value: "always", label: "Always on" },
  ],
  training: [
    { value: "off", label: "Training off" },
    { value: "on", label: "🎯 Training: hit targets" },
  ],
  powerSound: [
    { value: "on", label: "Sound effects" },
    { value: "off", label: "Silent" },
  ],
  shake: [
    { value: "on", label: "Screen shake" },
    { value: "off", label: "No shake" },
  ],
});

/** Tabs of the superpower mode. */
export const POWER_TABS = [
  { id: "power", label: "Powers", groups: ["power", "plate"] },
  { id: "pstyle", label: "Style", groups: ["color", "intensity", "cloak"] },
  { id: "play", label: "Play", groups: ["training", "activation", "cloneCount"] },
  { id: "feel", label: "Feel", groups: ["powerSound", "shake"] },
];

/** One-tap "jam" setups for people who don't know where to start. */
export const PRESETS = [
  { id: "lofi", label: "☕ Chill lo-fi", set: { instrument: "keys", sound: "epiano", style: "lofi", progression: "ballad", scale: "minorPenta", root: "9", tempo: "auto", reverb: "room" } },
  { id: "pop", label: "⭐ Pop star", set: { instrument: "chords", sound: "pluck", style: "pop", progression: "pop", scale: "major", root: "0", tempo: "auto", reverb: "room" } },
  { id: "dance", label: "🪩 Dance floor", set: { instrument: "dj", sound: "synth", style: "house", progression: "epic", scale: "minor", root: "9", tempo: "auto", reverb: "hall" } },
  { id: "blues", label: "🎷 Blues jam", set: { instrument: "keys", sound: "organ", style: "rock", progression: "blues", scale: "blues", root: "4", tempo: "90", reverb: "room" } },
  { id: "dream", label: "🌙 Dreamy", set: { instrument: "harp", sound: "glass", style: "off", progression: "calm", scale: "pentatonic", root: "2", tempo: "auto", reverb: "hall", echo: "on" } },
  { id: "arcade", label: "👾 Arcade", set: { instrument: "arp", sound: "chip", style: "hiphop", progression: "epic", scale: "minor", root: "7", tempo: "110", reverb: "off" } },
];

export const TABS = [
  { id: "effect", label: "Effect", groups: ["effect"] },
  { id: "face", label: "Face", groups: ["face", "who"] },
  { id: "mask", label: "Mask", groups: ["mask", "maskArea"] },
  { id: "3d", label: "3D", groups: ["accessory", "anchor", "size", "fit"] },
  { id: "target", label: "Target", groups: ["target"] },
  { id: "shape", label: "Shape", groups: ["shape"] },
  { id: "color", label: "Color", groups: ["color", "border"] },
  { id: "more", label: "More", groups: ["timer", "gesture", "signs"] },
];

/**
 * Options that are never worn together: picking one switches the other off.
 * (Kitsune and the Aero helmet are two different looks.)
 */
export const EXCLUSIVE = [
  [["mask", "kitsune"], ["accessory", "aero"]],
];

/**
 * Settings to switch off after `key` becomes `value`.
 * @returns {{key: string, value: string, label: string}[]} e.g. [{ key: "accessory", value: "none", label: "Aero helmet" }]
 */
export function exclusiveConflicts(settings, key, value) {
  const out = [];
  for (const pair of EXCLUSIVE) {
    pair.forEach(([k, v], i) => {
      const [ok, ov] = pair[1 - i];
      if (k === key && v === value && settings[ok] === ov) {
        out.push({ key: ok, value: "none", label: OPTIONS[ok].find((o) => o.value === ov)?.label ?? ov });
      }
    });
  }
  return out;
}

/** Tab groups drawn by custom UI (sliders) instead of OPTIONS chips. */
export const PANEL_GROUPS = ["fit", "looper", "preset", "lesson", "plate"];

export const DEFAULTS = {
  effect: "neon",
  face: "none",
  mask: "none",
  maskArea: "face",
  accessory: "none",
  anchor: "top",
  size: "1",
  who: "all",
  target: "all",
  shape: "rect",
  border: "neon",
  color: "#ff2d55",
  timer: "3",
  gesture: "on",
  signs: "on",
  mode: "effects",
  instrument: "theremin",
  sound: "glass",
  scale: "pentatonic",
  root: "0",
  octave: "4",
  snap: "locked",
  reverb: "room",
  echo: "off",
  midi: "off",
  style: "off",
  progression: "pop",
  tempo: "auto",
  metronome: "off",
  kit: "auto",
  power: "wave",
  intensity: "strong",
  cloak: "shimmer",
  cloneCount: "2",
  activation: "gesture",
  training: "off",
  powerSound: "on",
  shake: "on",
};

/** "#ff2d55" → [1, 0.176, 0.333] */
export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
