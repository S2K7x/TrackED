// User-facing options. Values must match the names in renderer.js / faces.js.
// `tile` is the CSS background of the option's preview tile in the UI.

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

/** Tab groups drawn by custom UI (sliders) instead of OPTIONS chips. */
export const PANEL_GROUPS = ["fit"];

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
};

/** "#ff2d55" → [1, 0.176, 0.333] */
export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
