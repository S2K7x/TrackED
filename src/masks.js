// Face masks painted procedurally in the canonical UV space of the face mesh
// (see face-mesh-data.js). Every mask is an RGBA canvas: transparent where the
// live face should show through. All designs here are original.
import { UV, TRIS, CONTOURS } from "./face-mesh-data.js";

export const MASK_SIZE = 1024;
const S = MASK_SIZE;

const pt = (i) => [UV[i * 2] * S, UV[i * 2 + 1] * S];

function newCanvas() {
  const c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(S, S) : Object.assign(document.createElement("canvas"), { width: S, height: S });
  return [c, c.getContext("2d")];
}

function loopPath(ctx, loop, scale = 1) {
  const pts = loop.map(pt);
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  ctx.beginPath();
  pts.forEach(([x, y], k) => {
    const X = cx + (x - cx) * scale, Y = cy + (y - cy) * scale;
    k ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
  });
  ctx.closePath();
  return [cx, cy];
}

/** Soft-edged face fill: the oval, slightly inset, with a blurred border. */
function fillFace(ctx, style, feather = 14) {
  ctx.save();
  ctx.filter = `blur(${feather}px)`;
  loopPath(ctx, CONTOURS.oval, 0.97);
  ctx.fillStyle = style;
  ctx.fill();
  ctx.restore();
}

/** Cuts the eyes and/or the mouth out so the live ones show through. */
function cutHoles(ctx, { eyes = 1.25, mouth = 1.05, feather = 5 } = {}) {
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.filter = `blur(${feather}px)`;
  ctx.fillStyle = "#000";
  if (eyes) for (const e of [CONTOURS.eyeL, CONTOURS.eyeR]) { loopPath(ctx, e, eyes); ctx.fill(); }
  if (mouth) { loopPath(ctx, CONTOURS.lipsInner, mouth); ctx.fill(); }
  ctx.restore();
}

function edges() {
  const seen = new Set(), out = [];
  for (let t = 0; t < TRIS.length; t += 3) {
    for (const [a, b] of [[TRIS[t], TRIS[t + 1]], [TRIS[t + 1], TRIS[t + 2]], [TRIS[t + 2], TRIS[t]]]) {
      const k = a < b ? a * 1000 + b : b * 1000 + a;
      if (!seen.has(k)) { seen.add(k); out.push([a, b]); }
    }
  }
  return out;
}

function strokeLoop(ctx, loop, width, style) {
  loopPath(ctx, loop);
  ctx.lineWidth = width;
  ctx.strokeStyle = style;
  ctx.stroke();
}

const PAINTERS = {
  /** Glowing wireframe of the face mesh. */
  wire(ctx, color) {
    ctx.lineCap = "round";
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (const [a, b] of edges()) { ctx.moveTo(...pt(a)); ctx.lineTo(...pt(b)); }
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 14;
    for (const loop of [CONTOURS.oval, CONTOURS.eyeL, CONTOURS.eyeR, CONTOURS.lipsOuter]) strokeLoop(ctx, loop, 3.5, "#fff");
  },

  /** Sleek cyber visor across the eyes with a neon rim. */
  visor(ctx, color) {
    const top = Math.min(...[...CONTOURS.browL.flat(), ...CONTOURS.browR.flat()].map((i) => pt(i)[1])) - 10;
    const bottom = pt(4)[1] - 8; // just above the nose tip
    const left = pt(127)[0] - 6, right = pt(356)[0] + 6;
    const r = (bottom - top) / 2;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(left, top, right - left, bottom - top, r);
    const g = ctx.createLinearGradient(0, top, 0, bottom);
    g.addColorStop(0, "rgba(20,24,30,.96)");
    g.addColorStop(0.5, "rgba(8,10,14,.92)");
    g.addColorStop(1, "rgba(30,36,44,.96)");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.clip();
    // glossy reflection
    const s = ctx.createLinearGradient(left, top, right, bottom);
    s.addColorStop(0.2, "rgba(255,255,255,0)");
    s.addColorStop(0.35, "rgba(255,255,255,.18)");
    s.addColorStop(0.45, "rgba(255,255,255,0)");
    ctx.fillStyle = s;
    ctx.fillRect(left, top, right - left, bottom - top);
    // scanning light bar
    ctx.shadowColor = color;
    ctx.shadowBlur = 24;
    ctx.fillStyle = color;
    ctx.fillRect(left + 30, (top + bottom) / 2 - 5, right - left - 60, 10);
    ctx.restore();
    ctx.shadowColor = color;
    ctx.shadowBlur = 18;
    ctx.lineWidth = 5;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.roundRect(left, top, right - left, bottom - top, r);
    ctx.stroke();
  },

  /** Stylized bone-white skull with dark sockets (live eyes stay visible). */
  skull(ctx) {
    const g = ctx.createRadialGradient(S / 2, S * 0.45, 40, S / 2, S * 0.5, S * 0.5);
    g.addColorStop(0, "#f4f1e8");
    g.addColorStop(0.7, "#d9d3c4");
    g.addColorStop(1, "#a8a090");
    fillFace(ctx, g);
    ctx.save();
    ctx.filter = "blur(10px)";
    ctx.fillStyle = "#15120f";
    for (const e of [CONTOURS.eyeL, CONTOURS.eyeR]) { loopPath(ctx, e, 2.3); ctx.fill(); }
    // nose cavity: upside-down heart under the bridge
    const [nx, ny] = pt(4);
    ctx.beginPath();
    ctx.moveTo(nx, ny - 34);
    ctx.bezierCurveTo(nx - 44, ny + 6, nx - 30, ny + 34, nx, ny + 22);
    ctx.bezierCurveTo(nx + 30, ny + 34, nx + 44, ny + 6, nx, ny - 34);
    ctx.fill();
    // cheek hollows
    ctx.globalAlpha = 0.35;
    for (const i of [205, 425]) { const [x, y] = pt(i); ctx.beginPath(); ctx.ellipse(x, y + 20, 60, 34, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
    // teeth across the mouth
    const [ox, oy] = loopPath(ctx, CONTOURS.lipsOuter, 1.25);
    ctx.fillStyle = "#1b1713";
    ctx.fill();
    const lx = pt(61)[0] - 18, rx = pt(291)[0] + 18;
    ctx.fillStyle = "#efe9da";
    const n = 8, w = (rx - lx) / n;
    for (let k = 0; k < n; k++) {
      ctx.beginPath();
      ctx.roundRect(lx + k * w + 3, oy - 22, w - 6, 20, 5);
      ctx.roundRect(lx + k * w + 3, oy + 3, w - 6, 20, 5);
      ctx.fill();
    }
    void ox;
    cutHoles(ctx, { eyes: 1.0, mouth: 0 });
  },

  /** Polished gold statue (lighting comes from the live video). */
  gold(ctx) {
    const g = ctx.createLinearGradient(0, S * 0.1, S, S * 0.95);
    g.addColorStop(0, "#fff1b8");
    g.addColorStop(0.35, "#e2b33c");
    g.addColorStop(0.6, "#a8741a");
    g.addColorStop(0.85, "#f0cc62");
    g.addColorStop(1, "#7a5212");
    fillFace(ctx, g, 10);
    cutHoles(ctx, { eyes: 1.15, mouth: 1.0 });
  },

  /** Big-cat face paint: warm fur, white muzzle, dark stripes. */
  feline(ctx) {
    const g = ctx.createRadialGradient(S / 2, S * 0.55, 60, S / 2, S * 0.5, S * 0.5);
    g.addColorStop(0, "#f7a440");
    g.addColorStop(1, "#d8641c");
    fillFace(ctx, g);
    ctx.save();
    ctx.filter = "blur(10px)";
    ctx.fillStyle = "#fbf3e6";
    for (const i of [206, 426]) { const [x, y] = pt(i); ctx.beginPath(); ctx.ellipse(x, y, 92, 74, 0, 0, Math.PI * 2); ctx.fill(); }
    loopPath(ctx, CONTOURS.lipsOuter, 1.6); ctx.fill();
    ctx.restore();
    // stripes: tapered strokes from the oval inwards
    ctx.fillStyle = "#1d130c";
    const stripe = (i, len, angle, width) => {
      const [x, y] = pt(i);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(0, -width);
      ctx.quadraticCurveTo(len * 0.6, -width * 0.6, len, 0);
      ctx.quadraticCurveTo(len * 0.6, width * 0.6, 0, width);
      ctx.fill();
      ctx.restore();
    };
    for (const [i, a] of [[10, Math.PI / 2], [109, 1.2], [338, 1.94], [67, 0.9], [297, 2.24]]) stripe(i, 120, a, 14);
    for (const [i, a] of [[234, -0.1], [93, 0.15], [132, 0.35], [454, Math.PI + 0.1], [323, Math.PI - 0.15], [361, Math.PI - 0.35]]) stripe(i, 110, a, 13);
    // nose
    const [nx, ny] = pt(4);
    ctx.beginPath();
    ctx.moveTo(nx - 30, ny - 12); ctx.lineTo(nx + 30, ny - 12); ctx.lineTo(nx, ny + 22); ctx.closePath();
    ctx.fill();
    cutHoles(ctx, { eyes: 1.2, mouth: 1.0 });
  },

  /** Two bold paint stripes under the eyes + a forehead dot, in the chosen colour. */
  warpaint(ctx, color) {
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = color;
    ctx.filter = "blur(2px)";
    for (const [i, dir] of [[118, -1], [347, 1]]) {
      const [x, y] = pt(i);
      for (let k = 0; k < 2; k++) {
        ctx.beginPath();
        ctx.roundRect(x - 70 - dir * 10, y - 14 + k * 34, 140, 20, 10);
        ctx.fill();
      }
    }
    const [fx, fy] = pt(151);
    ctx.beginPath(); ctx.arc(fx, fy + 30, 18, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  },
};

export const MASKS = Object.keys(PAINTERS);

/** Paints a built-in mask. @returns {OffscreenCanvas|HTMLCanvasElement} */
export function paintMask(name, color = "#ff2d55") {
  const [c, ctx] = newCanvas();
  PAINTERS[name]?.(ctx, color);
  return c;
}

/**
 * A printable/paintable template: draw your own mask on top of it in any image
 * editor, keep eyes and mouth transparent, then load it with "Your mask".
 */
export async function templateBlob() {
  const [c, ctx] = newCanvas();
  ctx.fillStyle = "#f4f4f1";
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = "rgba(20,20,19,.18)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const [a, b] of edges()) { ctx.moveTo(...pt(a)); ctx.lineTo(...pt(b)); }
  ctx.stroke();
  for (const loop of [CONTOURS.oval, CONTOURS.eyeL, CONTOURS.eyeR, CONTOURS.lipsOuter, CONTOURS.lipsInner]) strokeLoop(ctx, loop, 3, "#141413");
  ctx.fillStyle = "#141413";
  ctx.font = "500 22px Urbanist, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("TrackED mask template · paint inside the face outline", S / 2, 34);
  ctx.fillText("Export as PNG with transparency (eyes and mouth see-through)", S / 2, S - 22);
  return c.convertToBlob ? c.convertToBlob({ type: "image/png" }) : new Promise((r) => c.toBlob(r, "image/png"));
}

/**
 * Per-vertex alpha for a face swap: fades to 0 at the face outline (seamless
 * edge) and is 0 on the eyes and inner lips so the live eyes and mouth show.
 */
export function swapAlpha(fadeWidth = 0.07) {
  const a = new Float32Array(468).fill(1);
  const oval = CONTOURS.oval.slice(0, -1);
  for (let i = 0; i < 468; i++) {
    let d = Infinity;
    for (const j of oval) d = Math.min(d, Math.hypot(UV[i * 2] - UV[j * 2], UV[i * 2 + 1] - UV[j * 2 + 1]));
    const t = Math.min(1, d / fadeWidth);
    a[i] = t * t * (3 - 2 * t);
  }
  for (const loop of [CONTOURS.eyeL, CONTOURS.eyeR, CONTOURS.lipsInner]) for (const i of loop) a[i] = 0;
  return a;
}
