// WebGL2 renderer: the whole effect runs in one fragment shader on the GPU.
//
// Per pixel, the shader:
//   1. inverts the bilinear mapping of the frame quad → (u, v) inside the frame
//   2. evaluates the frame *shape* as a signed distance field in (u, v) space
//      (rectangle, rounded, ellipse, circle, heart, star, diamond) and converts
//      it to screen pixels with fwidth() → perfectly anti-aliased edges
//   3. inside the shape: warps faces (big eyes, swirl…), remaps UVs (loupe,
//      kaleidoscope, pixel), applies the colour effect, and restricts it to a
//      segmentation target (people, background, hair, clothes, skin)
//   4. draws the border (neon, thick, rainbow) and the outer glow

import { UV, TRIS } from "./face-mesh-data.js";
import { swapAlpha } from "./masks.js";

const MESH = { UV, TRIS, swapAlpha: swapAlpha() };

export const EFFECTS = ["none", "neon", "tint", "invert", "bw", "glitch", "thermal", "pixel", "cartoon", "kaleido", "loupe", "image"];
export const FACE_FX = ["none", "bigeyes", "bigmouth", "alien", "swirl", "balloon", "tiny", "anon", "laser"];
export const SHAPES = ["rect", "round", "ellipse", "circle", "heart", "star", "diamond"];
export const BORDERS = ["none", "neon", "thick", "rainbow"];
export const MAX_FACES = 4;

const VERT = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 vUv;
void main() {
  vec2 p = P[gl_VertexID];                       // one oversized triangle covers the screen
  vUv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);  // y down, like image/landmark coords
  gl_Position = vec4(p, 0.0, 1.0);
}`;

// Frame geometry shared by the main pass and the face-mask pass.
const FRAME_GLSL = `
uniform vec2  uQuad[4];
uniform int   uShape;
uniform float uFrameAspect;     // frame width / height, in pixels
float cross2(vec2 a, vec2 b) { return a.x * b.y - a.y * b.x; }
float dot2(vec2 v) { return dot(v, v); }

// Inverse bilinear interpolation (Inigo Quilez). Corners a,b,c,d map to
// (0,0),(1,0),(1,1),(0,1). Returns (-1,-1) when p has no solution.
vec2 invBilinear(vec2 p, vec2 a, vec2 b, vec2 c, vec2 d) {
  vec2 e = b - a, f = d - a, g = a - b + c - d, h = p - a;
  float k2 = cross2(g, f);
  float k1 = cross2(e, f) + cross2(h, g);
  float k0 = cross2(h, e);
  float v;
  if (abs(k2) < 1e-6) {
    v = -k0 / k1;
  } else {
    float w = k1 * k1 - 4.0 * k0 * k2;
    if (w < 0.0) return vec2(-1.0);
    w = sqrt(w);
    float ik2 = 0.5 / k2;
    v = (-k1 - w) * ik2;
    if (v < 0.0 || v > 1.0) v = (-k1 + w) * ik2;
  }
  vec2 den = e + g * v;
  float u = abs(den.x) > abs(den.y) ? (h.x - f.x * v) / den.x : (h.y - f.y * v) / den.y;
  return vec2(u, v);
}
vec2 bilinear(vec2 f) {
  return mix(mix(uQuad[0], uQuad[1], f.x), mix(uQuad[3], uQuad[2], f.x), f.y);
}

// ---------- shapes (2D SDFs, Inigo Quilez) ----------
float sdHeart(vec2 p) {
  p.x = abs(p.x);
  if (p.y + p.x > 1.0) return sqrt(dot2(p - vec2(0.25, 0.75))) - sqrt(2.0) / 4.0;
  return sqrt(min(dot2(p - vec2(0.0, 1.0)), dot2(p - 0.5 * max(p.x + p.y, 0.0)))) * sign(p.x - p.y);
}
float sdStar5(vec2 p, float r, float rf) {
  const vec2 k1 = vec2(0.809016994375, -0.587785252292);
  const vec2 k2 = vec2(-k1.x, k1.y);
  p.x = abs(p.x);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x);
  p.y -= r;
  vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}
// signed distance (any scale) of the frame shape; negative inside
float shapeSd(vec2 f) {
  float k = uFrameAspect;
  vec2 S = (f - 0.5) * 2.0;                                  // stretched to the frame: [-1, 1]²
  vec2 C = vec2((f.x - 0.5) * k, f.y - 0.5) / min(k, 1.0);   // undistorted, shorter side = 1
  if (uShape == 1) {                                          // rounded rectangle
    vec2 b = 0.5 * vec2(k, 1.0) / min(k, 1.0);
    float r = 0.15;
    vec2 q = abs(C) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }
  if (uShape == 2) return length(S) - 1.0;                    // ellipse
  if (uShape == 3) return length(C) - 0.5;                    // circle
  if (uShape == 4) return sdHeart(vec2(C.x, -C.y) * 1.2 + vec2(0.0, 0.6));
  if (uShape == 5) return sdStar5(vec2(C.x, -C.y + 0.04), 0.55, 0.42);
  return (abs(S.x) + abs(S.y) - 1.0);                         // diamond
}


// Distance (screen pixels, positive inside) from p to the frame shape's edge.
// fuv = position inside the frame, fw = its screen-space derivative.
float frameDist(vec2 p, out vec2 fuv, out vec2 fw) {
  fuv = invBilinear(p, uQuad[0], uQuad[1], uQuad[2], uQuad[3]);
  fw = max(fwidth(fuv), vec2(1e-6));
  if (uShape == 0) {
    vec2 d2 = min(fuv, 1.0 - fuv) / fw;
    return min(d2.x, d2.y);
  }
  float sd = shapeSd(fuv);
  return -sd / max(fwidth(sd), 1e-6);
}
`;

const FRAG = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 outColor;

#define MAX_FACES ${MAX_FACES}
const float PI = 3.14159265;

uniform sampler2D uVideo;
uniform sampler2D uOverlay;
uniform sampler2D uMask;        // R8 category mask (selfie_multiclass)
uniform sampler2D uFrozen;      // snapshot shown inside the frame while frozen
uniform bool  uFreeze;
uniform float uAlpha;           // 0 = no frame
uniform int   uEffect;
uniform int   uBorder;
uniform bool  uMirror;
uniform vec2  uTexel;           // 1 / video size
uniform float uAspect;          // video width / height
uniform float uTime;
uniform vec2  uCover;           // overlay "object-fit: cover" scale
uniform vec3  uColor;           // user colour (tint, neon, border, laser)
uniform int   uTargetBits;      // bitmask of mask categories; 0 = everything
uniform bool  uRefine;          // edge-aware mask refinement (off on low-end devices)
uniform int   uFaceFx;
uniform int   uFaceCount;
uniform vec2  uFacePts[MAX_FACES * 4]; // eyeL, eyeR, mouth, nose
uniform float uFaceR[MAX_FACES];       // face half-width (image-height units), 0 = skip

// ---------- helpers ----------
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec2 src(vec2 uv) { return vec2(uMirror ? 1.0 - uv.x : uv.x, uv.y); }   // display → camera texture
bool gInside = false;            // true while shading pixels inside the frame
vec3 cam(vec2 uv) { return (uFreeze && gInside) ? texture(uFrozen, src(uv)).rgb : texture(uVideo, src(uv)).rgb; }
vec3 hue(float h) { return clamp(abs(fract(h + vec3(0.0, 2.0, 1.0) / 3.0) * 6.0 - 3.0) - 1.0, 0.0, 1.0); }

${FRAME_GLSL}
// ---------- face warps ----------
vec2 bulge(vec2 uv, vec2 c, float R, float s) {   // s>0 magnify, s<0 shrink
  vec2 d = (uv - c) * vec2(uAspect, 1.0);
  float r = length(d) / R;
  if (r >= 1.0) return uv;
  float f = 1.0 - s * (1.0 - smoothstep(0.0, 1.0, r));
  return c + d * f / vec2(uAspect, 1.0);
}
vec2 swirl(vec2 uv, vec2 c, float R, float ang) {
  vec2 d = (uv - c) * vec2(uAspect, 1.0);
  float r = length(d) / R;
  if (r >= 1.0) return uv;
  float a = ang * (1.0 - r) * (1.0 - r);
  d = mat2(cos(a), -sin(a), sin(a), cos(a)) * d;
  return c + d / vec2(uAspect, 1.0);
}
vec2 pixelateIn(vec2 uv, vec2 c, float R, float block) {
  vec2 d = (uv - c) * vec2(uAspect, 1.0);
  if (length(d) > R) return uv;
  vec2 b = vec2(block / uAspect, block);
  return (floor(uv / b) + 0.5) * b;
}
vec2 faceWarp(vec2 uv) {
  if (uFaceFx == 0 || uFaceFx == 8) return uv;
  for (int i = 0; i < MAX_FACES; i++) {
    if (i >= uFaceCount) break;
    float R = uFaceR[i];
    if (R <= 0.0) continue;
    vec2 eL = uFacePts[i * 4], eR = uFacePts[i * 4 + 1], mo = uFacePts[i * 4 + 2], no = uFacePts[i * 4 + 3];
    if (uFaceFx == 1) { uv = bulge(uv, eL, R * 0.45, 0.55); uv = bulge(uv, eR, R * 0.45, 0.55); }
    else if (uFaceFx == 2) { uv = bulge(uv, mo, R * 0.65, 0.55); }
    else if (uFaceFx == 3) { uv = bulge(uv, eL, R * 0.55, 0.65); uv = bulge(uv, eR, R * 0.55, 0.65); uv = bulge(uv, mo, R * 0.9, -0.6); }
    else if (uFaceFx == 4) { uv = swirl(uv, no, R * 1.4, 2.8 * sin(uTime * 1.5)); }
    else if (uFaceFx == 5) { uv = bulge(uv, no, R * 1.6, 0.45); }
    else if (uFaceFx == 6) { uv = bulge(uv, no, R * 1.6, -0.9); }
    else if (uFaceFx == 7) { uv = pixelateIn(uv, no, R * 1.25, R * 0.16); }
  }
  return uv;
}
vec3 laserEyes(vec2 uv) {
  vec3 add = vec3(0.0);
  if (uFaceFx != 8) return add;
  for (int i = 0; i < MAX_FACES; i++) {
    if (i >= uFaceCount) break;
    float R = uFaceR[i];
    if (R <= 0.0) continue;
    for (int e = 0; e < 2; e++) {
      vec2 d = (uv - uFacePts[i * 4 + e]) * vec2(uAspect, 1.0);
      float r = length(d) / R;
      float flick = 0.85 + 0.15 * sin(uTime * 30.0 + float(i * 2 + e));
      add += uColor * (exp(-r * 18.0) * 2.5 + exp(-r * 5.0) * 0.6) * flick;
      add += vec3(1.0) * exp(-r * 40.0) * 1.5;                // white-hot core
    }
  }
  return add;
}

// ---------- colour effects ----------
float sobel(vec2 uv) {
  vec2 t = uTexel * 1.5;
  float tl = luma(cam(uv + vec2(-t.x, -t.y))), tc = luma(cam(uv + vec2(0.0, -t.y))), tr = luma(cam(uv + vec2(t.x, -t.y)));
  float ml = luma(cam(uv + vec2(-t.x, 0.0))),                                         mr = luma(cam(uv + vec2(t.x, 0.0)));
  float bl = luma(cam(uv + vec2(-t.x, t.y))), bc = luma(cam(uv + vec2(0.0, t.y))),  br = luma(cam(uv + vec2(t.x, t.y)));
  float gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
  float gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;
  return length(vec2(gx, gy));
}
vec3 thermal(float t) {
  t = clamp(t, 0.0, 1.0) * 5.0;
  vec3 c0 = vec3(0.0, 0.0, 0.1), c1 = vec3(0.1, 0.0, 0.8), c2 = vec3(0.9, 0.0, 0.6);
  vec3 c3 = vec3(1.0, 0.3, 0.0), c4 = vec3(1.0, 0.95, 0.2), c5 = vec3(1.0);
  if (t < 1.0) return mix(c0, c1, t);
  if (t < 2.0) return mix(c1, c2, t - 1.0);
  if (t < 3.0) return mix(c2, c3, t - 2.0);
  if (t < 4.0) return mix(c3, c4, t - 3.0);
  return mix(c4, c5, t - 4.0);
}
// UV remapping effects (applied before sampling)
vec2 remap(vec2 uv, vec2 fuv) {
  if (uEffect == 7) {                                       // pixel
    vec2 b = uTexel * 18.0;
    return (floor(uv / b) + 0.5) * b;
  }
  if (uEffect == 9) {                                       // kaleidoscope (6 segments, slowly turning)
    float k = uFrameAspect;
    vec2 p = vec2((fuv.x - 0.5) * k, fuv.y - 0.5);
    float r = length(p), a = atan(p.y, p.x) + uTime * 0.3;
    float seg = PI / 3.0;
    a = abs(mod(a, 2.0 * seg) - seg);
    p = r * vec2(cos(a), sin(a));
    return bilinear(clamp(vec2(p.x / k, p.y) + 0.5, 0.0, 1.0));
  }
  if (uEffect == 10) {                                      // magnifier ×2
    vec2 c = bilinear(vec2(0.5));
    return c + (uv - c) * 0.5;
  }
  return uv;
}
vec3 colorFx(vec3 c, vec2 uv, vec2 fuv) {
  if (uEffect == 1) {                                       // neon: posterized in the chosen colour + glowing edges
    float l = luma(c);
    float v = l > 0.6 ? 1.0 : l > 0.36 ? 0.75 : l > 0.2 ? 0.28 : 0.05;
    vec3 col = uColor * v;
    if (v > 0.9) col = mix(col, vec3(1.0), 0.2);
    float e = smoothstep(0.25, 0.6, sobel(uv));
    return mix(col, mix(uColor, vec3(1.0), 0.7), e * 0.8);
  }
  if (uEffect == 2) return uColor * smoothstep(0.0, 0.85, luma(c)) * 1.25;   // tint
  if (uEffect == 3) return 1.0 - c;                                          // invert
  if (uEffect == 4) return vec3(clamp((luma(c) - 0.5) * 1.6 + 0.5, 0.0, 1.0)); // mono
  if (uEffect == 5) {                                                         // glitch
    float shift = 0.006 + 0.004 * sin(uTime * 7.0 + uv.y * 40.0);
    float band = step(0.92, fract(sin(floor(uv.y * 30.0) * 12.9898 + floor(uTime * 8.0)) * 43758.5453));
    vec2 o = vec2(shift + band * 0.03, 0.0);
    vec3 g = vec3(cam(uv + o).r, c.g, cam(uv - o).b);
    float scan = 0.85 + 0.15 * sin(uv.y / uTexel.y * 1.5);
    return g * scan * vec3(0.9, 1.1, 1.2);
  }
  if (uEffect == 6) return thermal(luma(c));                                  // thermal
  if (uEffect == 8) {                                                         // cartoon
    vec3 q = floor(c * 4.0 + 0.5) / 4.0;
    float e = smoothstep(0.3, 0.7, sobel(uv));
    return mix(q * 1.1, vec3(0.05), e);
  }
  if (uEffect == 11) {                                                        // image
    vec2 ouv = (fuv - 0.5) / uCover + 0.5;
    vec3 img = texture(uOverlay, ouv).rgb;
    return mix(img, img * (0.6 + 0.6 * luma(c)), 0.35);
  }
  return c;                                                                   // none / pixel / kaleido / loupe
}

// ---------- segmentation target ----------
// Joint bilateral upsampling of the low-res category mask (as in Google Meet's
// background pipeline): 3×3 mask samples weighted by spatial distance AND by
// how similar the camera colour there is to this pixel's colour, so the mask
// edge snaps to real edges (hair, shoulders) instead of blocky mask texels.
float targetMask(vec2 uv) {
  if (uTargetBits == 0) return 1.0;
  vec2 ts = 1.0 / vec2(textureSize(uMask, 0));
  vec2 p = src(uv);
  if (!uRefine) {
    float m = 0.0;
    for (int i = 0; i < 4; i++) {
      vec2 o = (vec2(i & 1, i >> 1) - 0.5) * ts;
      m += float((uTargetBits >> int(texture(uMask, p + o).r * 255.0 + 0.5)) & 1);
    }
    return m * 0.25;
  }
  vec3 c0 = texture(uVideo, p).rgb;
  float sum = 0.0, wsum = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y)) * ts;
      float on = float((uTargetBits >> int(texture(uMask, p + o).r * 255.0 + 0.5)) & 1);
      vec3 c = texture(uVideo, p + o).rgb;
      float w = exp(-dot(c - c0, c - c0) * 40.0) * exp(-float(x * x + y * y) * 0.5);
      sum += on * w;
      wsum += w;
    }
  }
  return smoothstep(0.2, 0.8, sum / max(wsum, 1e-4));
}

vec3 borderColor(vec2 fuv) {
  if (uBorder == 3) return hue(fuv.x * 0.5 + fuv.y * 0.5 - uTime * 0.4);
  return uColor;
}

void main() {
  vec3 base = cam(vUv);
  if (uAlpha <= 0.0) { outColor = vec4(base, 1.0); return; }

  vec2 fuv, fw;
  float d = frameDist(vUv, fuv, fw);      // distance to the shape edge in screen pixels, positive inside
  float inside = clamp(d + 0.5, 0.0, 1.0);
  bool near = all(greaterThan(fuv, vec2(-0.3))) && all(lessThan(fuv, vec2(1.3))) && max(fw.x, fw.y) < 0.05;

  if (inside <= 0.0) {
    // soft outer glow. Only trust (u,v) near the frame: far away the inverse
    // mapping can pick a spurious root and fwidth blows up across it.
    float glow = (near && (uBorder == 1 || uBorder == 3)) ? exp(d * 0.35) * 0.55 : 0.0;
    outColor = vec4(mix(base, borderColor(fuv), glow * uAlpha), 1.0);
    return;
  }

  vec2 f = clamp(fuv, 0.0, 1.0);
  gInside = true;
  base = mix(base, cam(vUv), inside);       // frozen snapshot replaces the live view inside
  vec2 wuv = faceWarp(vUv);                 // faces are only modified inside the frame
  vec3 warped = cam(wuv);
  vec2 ruv = remap(wuv, f);
  vec3 fx = colorFx(cam(ruv), ruv, f);
  fx = mix(warped, fx, targetMask(wuv));    // restrict colour effect to people / background / …
  fx += laserEyes(vUv);

  if (uBorder == 1 || uBorder == 3) fx = mix(fx, borderColor(f), (1.0 - smoothstep(1.5, 3.0, d)) * 0.9);
  else if (uBorder == 2) fx = mix(fx, borderColor(f), 1.0 - smoothstep(7.0, 8.5, d));

  outColor = vec4(mix(base, fx, inside * uAlpha), 1.0);
}`;

// ---------- face-mask pass: the 468-point face mesh, textured in canonical UV space ----------
const MASK_VERT = `#version 300 es
in vec2 aPos;      // landmark position, display space [0,1], y down
in vec2 aTex;      // texture coordinate (canonical UV, or source-photo landmark for a face swap)
in float aAlpha;   // per-vertex fade (face-swap edges, eyes, mouth)
out vec2 vScreen;
out vec2 vTex;
out float vAlpha;
void main() {
  vScreen = aPos; vTex = aTex; vAlpha = aAlpha;
  gl_Position = vec4(aPos.x * 2.0 - 1.0, 1.0 - aPos.y * 2.0, 0.0, 1.0);
}`;

const MASK_FRAG = `#version 300 es
precision highp float;
precision highp int;
in vec2 vScreen;
in vec2 vTex;
in float vAlpha;
out vec4 outColor;
uniform sampler2D uVideo;
uniform sampler2D uMaskTex;
uniform bool  uMirror;
uniform vec2  uTexel;
uniform bool  uInFrame;    // only visible inside the hand frame
uniform float uAlpha;      // global fade
uniform float uShade;      // how much live lighting modulates the mask (0..1)
uniform float uFeather;    // use the per-vertex fade (face swap)
uniform bool  uSwap;       // colour-match a photo to the live face
${FRAME_GLSL}
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec2 src(vec2 uv) { return vec2(uMirror ? 1.0 - uv.x : uv.x, uv.y); }
// low-frequency live colour around p (lighting, skin tone)
vec3 liveLow(vec2 p) {
  vec2 t = uTexel * 9.0;
  return 0.25 * (texture(uVideo, src(p + vec2(t.x, t.y))).rgb + texture(uVideo, src(p - vec2(t.x, t.y))).rgb
               + texture(uVideo, src(p + vec2(t.x, -t.y))).rgb + texture(uVideo, src(p + vec2(-t.x, t.y))).rgb);
}
void main() {
  vec2 fuv, fw;
  float d = frameDist(vScreen, fuv, fw);   // evaluated in uniform control flow (uses fwidth)
  vec4 m = texture(uMaskTex, vTex);
  float a = m.a * mix(1.0, vAlpha, uFeather) * uAlpha;
  if (uInFrame) a *= clamp(d + 0.5, 0.0, 1.0);
  vec3 col = m.rgb;
  if (uSwap) {
    // local colour transfer: photo × (live low-pass / photo low-pass) carries the
    // live lighting and skin tone onto the photo, hiding most of the seam
    vec2 tx = dFdx(vTex) * 9.0, ty = dFdy(vTex) * 9.0;
    vec3 pl = 0.25 * (texture(uMaskTex, vTex + tx + ty).rgb + texture(uMaskTex, vTex - tx - ty).rgb
                    + texture(uMaskTex, vTex + tx - ty).rgb + texture(uMaskTex, vTex - tx + ty).rgb);
    col = clamp(col * clamp((liveLow(vScreen) + 0.03) / (pl + 0.03), 0.4, 2.2), 0.0, 1.0);
  } else if (uShade > 0.0) {
    col *= mix(1.0, clamp(luma(liveLow(vScreen)) / 0.5, 0.35, 1.7), uShade);
  }
  if (a < 0.004) discard;
  outColor = vec4(col, a);
}`;

// Composites the 3D layer (premultiplied alpha) with a global fade and,
// optionally, an anti-aliased clip to the frame shape.
const LAYER_FRAG = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uLayer;
uniform bool  uClip;
uniform float uFade;
${FRAME_GLSL}
void main() {
  vec2 fuv, fw;
  float d = frameDist(vUv, fuv, fw);
  vec4 c = texture(uLayer, vec2(vUv.x, 1.0 - vUv.y));   // render targets are stored bottom-up
  float k = uFade * (uClip ? clamp(d + 0.5, 0.0, 1.0) : 1.0);
  outColor = c * k;
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

function link(gl, vs, fs) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  return prog;
}

function makeTexture(gl, filter = gl.LINEAR) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

const UNIFORMS = [
  "uVideo", "uOverlay", "uMask", "uFrozen", "uFreeze", "uQuad", "uAlpha", "uEffect", "uShape", "uBorder", "uMirror", "uTexel",
  "uAspect", "uFrameAspect", "uTime", "uCover", "uColor", "uTargetBits", "uRefine", "uFaceFx", "uFaceCount", "uFacePts", "uFaceR",
];

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext("webgl2", {
      alpha: false, antialias: false, depth: false, stencil: false,  // the 3D layer has its own MSAA target
      preserveDrawingBuffer: false, powerPreference: "high-performance",
    });
    if (!gl) throw new Error("WebGL2 is not supported by this browser");
    this.gl = gl;
    this.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;
    this.canvas = canvas;

    const prog = link(gl, VERT, FRAG);
    this.prog = prog;
    gl.useProgram(prog);
    this.vao = gl.createVertexArray(); // attribute-less draw, but WebGL2 still wants a VAO bound
    gl.bindVertexArray(this.vao);

    this.u = {};
    for (const name of UNIFORMS) this.u[name] = gl.getUniformLocation(prog, name);
    this.videoTex = makeTexture(gl);
    this.overlayTex = makeTexture(gl);
    this.maskTex = makeTexture(gl, gl.NEAREST);
    this.frozenTex = makeTexture(gl);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); // complete until first freeze
    this.frozen = false;
    gl.uniform1i(this.u.uVideo, 0);
    gl.uniform1i(this.u.uFrozen, 3);
    gl.uniform1i(this.u.uOverlay, 1);
    gl.uniform1i(this.u.uMask, 2);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

    this.quadData = new Float32Array(8);
    this.scale = 1;   // internal render resolution (dynamic resolution on slow devices)
    this.facePts = new Float32Array(MAX_FACES * 8);
    this.faceR = new Float32Array(MAX_FACES);
    this.overlaySize = [1, 1];
    this.setOverlay(null);
    this.setMask(null);
    this.#initMaskPass();
    this.layerProg = link(gl, VERT, LAYER_FRAG);
    this.lu = {};
    for (const n of ["uLayer", "uClip", "uFade", "uQuad", "uShape", "uFrameAspect"]) this.lu[n] = gl.getUniformLocation(this.layerProg, n);
  }

  /**
   * Blends a premultiplied-alpha layer texture (the 3D accessories) over the picture.
   * @param {WebGLTexture} tex
   * @param {{clip: boolean, fade: number}} o  clip = only inside the frame shape (anti-aliased edge)
   */
  compositeLayer(tex, o) {
    const gl = this.gl, u = this.lu;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(this.layerProg);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(u.uLayer, 5);
    gl.uniform1i(u.uClip, o.clip ? 1 : 0);
    gl.uniform1f(u.uFade, o.fade);
    gl.uniform2fv(u.uQuad, this.quadData);
    gl.uniform1i(u.uShape, this.shapeIndex || 0);
    gl.uniform1f(u.uFrameAspect, this.frameAspect || 1);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);
  }

  /** three.js shares this context: put back the state our passes rely on. */
  #resetGL() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.depthMask(true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    const units = [this.videoTex, this.overlayTex, this.maskTex, this.frozenTex, this.faceMaskTex];
    units.forEach((t, i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t); });
  }

  #initMaskPass() {
    const gl = this.gl;
    const prog = link(gl, MASK_VERT, MASK_FRAG);
    this.maskProg = prog;
    this.mu = {};
    for (const n of ["uVideo", "uMaskTex", "uMirror", "uTexel", "uInFrame", "uAlpha", "uShade", "uFeather", "uSwap", "uQuad", "uShape", "uFrameAspect"]) {
      this.mu[n] = gl.getUniformLocation(prog, n);
    }
    this.maskVao = gl.createVertexArray();
    gl.bindVertexArray(this.maskVao);
    const attrib = (name, size, data, usage) => {
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, usage);
      const loc = gl.getAttribLocation(prog, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      return buf;
    };
    this.posBuf = attrib("aPos", 2, new Float32Array(468 * 2), gl.DYNAMIC_DRAW);
    this.texBuf = attrib("aTex", 2, MESH.UV, gl.STATIC_DRAW);
    this.alphaBuf = attrib("aAlpha", 1, MESH.swapAlpha, gl.STATIC_DRAW);
    const idx = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, MESH.TRIS, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.faceMaskTex = makeTexture(gl);
    this.maskOpts = null;
    // a front-facing triangle (contains the nose tip) tells us the on-screen winding
    let t = 0;
    while (t < MESH.TRIS.length && ![MESH.TRIS[t], MESH.TRIS[t + 1], MESH.TRIS[t + 2]].includes(1)) t += 3;
    this.refTri = [MESH.TRIS[t], MESH.TRIS[t + 1], MESH.TRIS[t + 2]];
  }

  /**
   * Sets the face mask.
   * @param {TexImageSource|null} image  RGBA texture (canonical UV layout, or a photo for a face swap)
   * @param {{shade?: number, swapUV?: Float32Array}} opts  swapUV = the photo's own landmarks (face swap)
   */
  setFaceMask(image, opts = {}) {
    const gl = this.gl;
    if (!image) { this.maskOpts = null; return; }
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.faceMaskTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.texBuf);
    gl.bufferData(gl.ARRAY_BUFFER, opts.swapUV || MESH.UV, gl.STATIC_DRAW);
    this.maskOpts = { shade: opts.shade ?? 0.6, swap: !!opts.swapUV };
  }

  /**
   * Draws the mask on each selected face (after draw()).
   * @param {{mesh: Float32Array, on?: boolean}[]} faces  meshes in display space
   * @param {{inFrame: boolean, alpha: number, mirror: boolean}} s
   */
  drawMasks(faces, s) {
    if (!this.maskOpts || !faces?.length) return;
    const gl = this.gl, u = this.mu, o = this.maskOpts;
    gl.useProgram(this.maskProg);
    gl.bindVertexArray(this.maskVao);
    gl.uniform1i(u.uVideo, 0);
    gl.uniform1i(u.uMaskTex, 4);
    gl.uniform1i(u.uMirror, s.mirror ? 1 : 0);
    gl.uniform2f(u.uTexel, ...(this.videoTexel || [1 / this.canvas.width, 1 / this.canvas.height]));
    gl.uniform1i(u.uInFrame, s.inFrame ? 1 : 0);
    gl.uniform1f(u.uAlpha, s.alpha);
    gl.uniform1f(u.uShade, o.shade);
    gl.uniform1f(u.uFeather, o.swap ? 1 : 0);
    gl.uniform1i(u.uSwap, o.swap ? 1 : 0);
    gl.uniform2fv(u.uQuad, this.quadData);
    gl.uniform1i(u.uShape, this.shapeIndex || 0);
    gl.uniform1f(u.uFrameAspect, this.frameAspect || 1);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    for (const f of faces) {
      if (!f.mesh || f.on === false || f.reveal === 0) continue;
      gl.uniform1f(u.uAlpha, s.alpha * (f.reveal ?? 1));
      gl.frontFace(frontWinding(f.mesh, this.refTri) ? gl.CCW : gl.CW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, f.mesh);
      gl.drawElements(gl.TRIANGLES, MESH.TRIS.length, gl.UNSIGNED_SHORT, 0);
    }
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  /** @param {TexImageSource|null} img */
  setOverlay(img) {
    const gl = this.gl;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.overlayTex);
    if (img) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      this.overlaySize = [img.naturalWidth || img.width, img.naturalHeight || img.height];
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
        new Uint8Array([255, 45, 85, 255, 94, 92, 230, 255])); // pink→indigo gradient placeholder
      this.overlaySize = [2, 1];
    }
  }

  /** @param {{data: Uint8Array, width: number, height: number}|null} mask  category mask */
  setMask(mask) {
    const gl = this.gl;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (mask) gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, mask.width, mask.height, 0, gl.RED, gl.UNSIGNED_BYTE, mask.data);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]));
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  }

  /** Freezes the picture inside the frame (snapshot of the current camera frame), or unfreezes. */
  setFrozen(video) {
    const gl = this.gl;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    this.frozen = !!video;
    if (!video) return;
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.frozenTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
  }

  /**
   * @param {HTMLVideoElement} video
   * @param {object} s  frame state: quad, alpha, effect, shape, border, color [r,g,b] 0..1,
   *                    mirror, time, targetBits, faceFx, faces [{eyeL,eyeR,mouth,nose,r,on}]
   */
  draw(video, s) {
    const gl = this.gl;
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return;
    const w = Math.round(vw * this.scale), h = Math.round(vh * this.scale);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.#resetGL();
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.videoTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);

    const u = this.u;
    gl.uniform1i(u.uFreeze, this.frozen ? 1 : 0);
    gl.uniform1f(u.uAlpha, s.quad ? s.alpha : 0);
    gl.uniform1i(u.uMirror, s.mirror ? 1 : 0);
    gl.uniform2f(u.uTexel, 1 / vw, 1 / vh);   // camera texel (independent of the render scale)
    gl.uniform1f(u.uAspect, vw / vh);
    this.videoTexel = [1 / vw, 1 / vh];
    gl.uniform1f(u.uTime, s.time);
    if (s.quad) {
      s.quad.forEach((p, i) => { this.quadData[i * 2] = p.x; this.quadData[i * 2 + 1] = p.y; });
      gl.uniform2fv(u.uQuad, this.quadData);
      const [fw, fh] = frameSize(s.quad, w, h);
      this.frameAspect = fh > 0 ? Math.max(0.05, Math.min(20, fw / fh)) : 1;
      this.shapeIndex = Math.max(0, SHAPES.indexOf(s.shape));
      gl.uniform1f(u.uFrameAspect, this.frameAspect);
      gl.uniform2fv(u.uCover, coverScale(fw, fh, this.overlaySize));
      gl.uniform1i(u.uEffect, Math.max(0, EFFECTS.indexOf(s.effect)));
      gl.uniform1i(u.uShape, Math.max(0, SHAPES.indexOf(s.shape)));
      gl.uniform1i(u.uBorder, Math.max(0, BORDERS.indexOf(s.border)));
      gl.uniform3fv(u.uColor, s.color);
      gl.uniform1i(u.uTargetBits, s.targetBits || 0);
      gl.uniform1i(u.uRefine, s.refineMask ? 1 : 0);
      this.#setFaces(s.faceFx, s.faces);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  #setFaces(faceFx, faces = []) {
    const gl = this.gl, u = this.u;
    const fx = Math.max(0, FACE_FX.indexOf(faceFx));
    const n = Math.min(MAX_FACES, faces.length);
    gl.uniform1i(u.uFaceFx, fx);
    gl.uniform1i(u.uFaceCount, fx ? n : 0);
    if (!fx || !n) return;
    for (let i = 0; i < n; i++) {
      const f = faces[i];
      [f.eyeL, f.eyeR, f.mouth, f.nose].forEach((p, j) => {
        this.facePts[i * 8 + j * 2] = p.x;
        this.facePts[i * 8 + j * 2 + 1] = p.y;
      });
      this.faceR[i] = f.on === false ? 0 : f.r;
    }
    gl.uniform2fv(u.uFacePts, this.facePts);
    gl.uniform1fv(u.uFaceR, this.faceR);
  }
}

/**
 * True when the reference (front-facing) triangle is counter-clockwise in clip
 * space; with back-face culling this hides the far side of a turned head.
 */
export function frontWinding(mesh, [a, b, c]) {
  const x = (i) => mesh[i * 2] * 2 - 1, y = (i) => 1 - mesh[i * 2 + 1] * 2;
  return (x(b) - x(a)) * (y(c) - y(a)) - (y(b) - y(a)) * (x(c) - x(a)) > 0;
}

/** Average width / height of the frame quad, in pixels. */
function frameSize(q, w, h) {
  const len = (a, b) => Math.hypot((a.x - b.x) * w, (a.y - b.y) * h);
  return [(len(q[0], q[1]) + len(q[3], q[2])) / 2, (len(q[0], q[3]) + len(q[1], q[2])) / 2];
}

/** Scale that makes the overlay image fill the frame like CSS object-fit: cover. */
function coverScale(fw, fh, [iw, ih]) {
  if (fw < 1 || fh < 1) return [1, 1];
  const frameAspect = fw / fh, imgAspect = iw / ih;
  return frameAspect > imgAspect ? [1, frameAspect / imgAspect] : [imgAspect / frameAspect, 1];
}
