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
    { value: "custom", label: "Your mask", upload: "custom" },
    { value: "swap", label: "Face swap", upload: "swap" },
  ],
  maskArea: [
    { value: "frame", label: "Inside the frame" },
    { value: "always", label: "Always on" },
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
  { id: "target", label: "Target", groups: ["target"] },
  { id: "shape", label: "Shape", groups: ["shape"] },
  { id: "color", label: "Color", groups: ["color", "border"] },
  { id: "more", label: "More", groups: ["timer", "gesture"] },
];

export const DEFAULTS = {
  effect: "neon",
  face: "none",
  mask: "none",
  maskArea: "frame",
  who: "all",
  target: "all",
  shape: "rect",
  border: "neon",
  color: "#ff2d55",
  timer: "3",
  gesture: "on",
};

/** "#ff2d55" → [1, 0.176, 0.333] */
export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
