// User-facing options. Values must match the names in renderer.js / faces.js.

export const OPTIONS = {
  effect: [
    { value: "none", label: "Aucun" },
    { value: "neon", label: "Néon" },
    { value: "tint", label: "Teinte" },
    { value: "thermal", label: "Thermique" },
    { value: "cartoon", label: "Cartoon" },
    { value: "glitch", label: "Glitch" },
    { value: "pixel", label: "Pixel" },
    { value: "kaleido", label: "Kaléido" },
    { value: "loupe", label: "Loupe" },
    { value: "invert", label: "Négatif" },
    { value: "bw", label: "N&B" },
    { value: "image", label: "Image" },
  ],
  face: [
    { value: "none", label: "Aucun" },
    { value: "bigeyes", label: "👀 Gros yeux" },
    { value: "bigmouth", label: "👄 Grosse bouche" },
    { value: "alien", label: "👽 Alien" },
    { value: "balloon", label: "🎈 Tête ballon" },
    { value: "tiny", label: "🤏 Mini visage" },
    { value: "swirl", label: "🌀 Tourbillon" },
    { value: "laser", label: "🔴 Yeux laser" },
    { value: "anon", label: "🔲 Anonyme" },
  ],
  who: [
    { value: "all", label: "Tout le monde" },
    { value: "me", label: "Moi" },
    { value: "others", label: "Les autres" },
  ],
  target: [
    { value: "all", label: "Tout" },
    { value: "people", label: "Personnes" },
    { value: "background", label: "Fond" },
    { value: "skin", label: "Peau" },
    { value: "hair", label: "Cheveux" },
    { value: "clothes", label: "Vêtements" },
  ],
  shape: [
    { value: "rect", label: "▭ Rectangle" },
    { value: "round", label: "▢ Arrondi" },
    { value: "ellipse", label: "⬭ Ellipse" },
    { value: "circle", label: "◯ Cercle" },
    { value: "heart", label: "♥ Cœur" },
    { value: "star", label: "★ Étoile" },
    { value: "diamond", label: "◆ Losange" },
  ],
  border: [
    { value: "neon", label: "Bord néon" },
    { value: "rainbow", label: "🌈 Arc-en-ciel" },
    { value: "thick", label: "Bord épais" },
    { value: "none", label: "Sans bord" },
  ],
  color: [
    { value: "#ff2d55", label: "Rouge" },
    { value: "#8a3cff", label: "Violet" },
    { value: "#ffd60a", label: "Jaune" },
    { value: "#00e5ff", label: "Cyan" },
    { value: "#30d158", label: "Vert" },
    { value: "#ff6ec7", label: "Rose" },
    { value: "#ff9f0a", label: "Orange" },
    { value: "#ffffff", label: "Blanc" },
  ],
};

export const TABS = [
  { id: "effect", label: "Effet", groups: ["effect"] },
  { id: "face", label: "Visage", groups: ["face", "who"] },
  { id: "target", label: "Cible", groups: ["target"] },
  { id: "shape", label: "Forme", groups: ["shape"] },
  { id: "color", label: "Couleur", groups: ["color", "border"] },
];

export const DEFAULTS = {
  effect: "neon",
  face: "none",
  who: "all",
  target: "all",
  shape: "rect",
  border: "neon",
  color: "#ff2d55",
};

/** "#ff2d55" → [1, 0.176, 0.333] */
export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
