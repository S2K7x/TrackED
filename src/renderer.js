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
uniform vec2  uQuad[4];
uniform float uAlpha;           // 0 = no frame
uniform int   uEffect;
uniform int   uShape;
uniform int   uBorder;
uniform bool  uMirror;
uniform vec2  uTexel;           // 1 / video size
uniform float uAspect;          // video width / height
uniform float uFrameAspect;     // frame width / height, in pixels
uniform float uTime;
uniform vec2  uCover;           // overlay "object-fit: cover" scale
uniform vec3  uColor;           // user colour (tint, neon, border, laser)
uniform int   uTargetBits;      // bitmask of mask categories; 0 = everything
uniform int   uFaceFx;
uniform int   uFaceCount;
uniform vec2  uFacePts[MAX_FACES * 4]; // eyeL, eyeR, mouth, nose
uniform float uFaceR[MAX_FACES];       // face half-width (image-height units), 0 = skip

// ---------- helpers ----------
float cross2(vec2 a, vec2 b) { return a.x * b.y - a.y * b.x; }
float dot2(vec2 v) { return dot(v, v); }
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec2 src(vec2 uv) { return vec2(uMirror ? 1.0 - uv.x : uv.x, uv.y); }   // display → camera texture
vec3 cam(vec2 uv) { return texture(uVideo, src(uv)).rgb; }
vec3 hue(float h) { return clamp(abs(fract(h + vec3(0.0, 2.0, 1.0) / 3.0) * 6.0 - 3.0) - 1.0, 0.0, 1.0); }

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
  if (uEffect == 9) {                                       // kaléidoscope (6 segments, slowly turning)
    float k = uFrameAspect;
    vec2 p = vec2((fuv.x - 0.5) * k, fuv.y - 0.5);
    float r = length(p), a = atan(p.y, p.x) + uTime * 0.3;
    float seg = PI / 3.0;
    a = abs(mod(a, 2.0 * seg) - seg);
    p = r * vec2(cos(a), sin(a));
    return bilinear(clamp(vec2(p.x / k, p.y) + 0.5, 0.0, 1.0));
  }
  if (uEffect == 10) {                                      // loupe ×2
    vec2 c = bilinear(vec2(0.5));
    return c + (uv - c) * 0.5;
  }
  return uv;
}
vec3 colorFx(vec3 c, vec2 uv, vec2 fuv) {
  if (uEffect == 1) {                                       // néon: posterized in the chosen colour + glowing edges
    float l = luma(c);
    float v = l > 0.6 ? 1.0 : l > 0.36 ? 0.75 : l > 0.2 ? 0.28 : 0.05;
    vec3 col = uColor * v;
    if (v > 0.9) col = mix(col, vec3(1.0), 0.2);
    float e = smoothstep(0.25, 0.6, sobel(uv));
    return mix(col, mix(uColor, vec3(1.0), 0.7), e * 0.8);
  }
  if (uEffect == 2) return uColor * smoothstep(0.0, 0.85, luma(c)) * 1.25;   // teinte
  if (uEffect == 3) return 1.0 - c;                                          // négatif
  if (uEffect == 4) return vec3(clamp((luma(c) - 0.5) * 1.6 + 0.5, 0.0, 1.0)); // N&B
  if (uEffect == 5) {                                                         // glitch
    float shift = 0.006 + 0.004 * sin(uTime * 7.0 + uv.y * 40.0);
    float band = step(0.92, fract(sin(floor(uv.y * 30.0) * 12.9898 + floor(uTime * 8.0)) * 43758.5453));
    vec2 o = vec2(shift + band * 0.03, 0.0);
    vec3 g = vec3(cam(uv + o).r, c.g, cam(uv - o).b);
    float scan = 0.85 + 0.15 * sin(uv.y / uTexel.y * 1.5);
    return g * scan * vec3(0.9, 1.1, 1.2);
  }
  if (uEffect == 6) return thermal(luma(c));                                  // thermique
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
  return c;                                                                   // aucun / pixel / kaléido / loupe
}

// ---------- segmentation target ----------
float targetMask(vec2 uv) {
  if (uTargetBits == 0) return 1.0;
  vec2 ts = 1.0 / vec2(textureSize(uMask, 0));
  vec2 p = src(uv);
  float m = 0.0;
  for (int i = 0; i < 4; i++) {          // 4 taps → soft 1-texel edge on a hard category mask
    vec2 o = (vec2(i & 1, i >> 1) - 0.5) * ts;
    int cat = int(texture(uMask, p + o).r * 255.0 + 0.5);
    m += float((uTargetBits >> cat) & 1);
  }
  return m * 0.25;
}

vec3 borderColor(vec2 fuv) {
  if (uBorder == 3) return hue(fuv.x * 0.5 + fuv.y * 0.5 - uTime * 0.4);
  return uColor;
}

void main() {
  vec3 base = cam(vUv);
  if (uAlpha <= 0.0) { outColor = vec4(base, 1.0); return; }

  vec2 fuv = invBilinear(vUv, uQuad[0], uQuad[1], uQuad[2], uQuad[3]);
  // distance to the shape edge in screen pixels, positive inside
  vec2 fw = max(fwidth(fuv), vec2(1e-6));
  float d;
  if (uShape == 0) {
    vec2 d2 = min(fuv, 1.0 - fuv) / fw;
    d = min(d2.x, d2.y);
  } else {
    float sd = shapeSd(fuv);
    d = -sd / max(fwidth(sd), 1e-6);
  }
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

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
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
  "uVideo", "uOverlay", "uMask", "uQuad", "uAlpha", "uEffect", "uShape", "uBorder", "uMirror", "uTexel",
  "uAspect", "uFrameAspect", "uTime", "uCover", "uColor", "uTargetBits", "uFaceFx", "uFaceCount", "uFacePts", "uFaceR",
];

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext("webgl2", {
      alpha: false, antialias: false, depth: false, stencil: false,
      preserveDrawingBuffer: false, powerPreference: "high-performance",
    });
    if (!gl) throw new Error("WebGL2 non supporté par ce navigateur");
    this.gl = gl;
    this.canvas = canvas;

    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    this.vao = gl.createVertexArray(); // attribute-less draw, but WebGL2 still wants a VAO bound
    gl.bindVertexArray(this.vao);

    this.u = {};
    for (const name of UNIFORMS) this.u[name] = gl.getUniformLocation(prog, name);
    this.videoTex = makeTexture(gl);
    this.overlayTex = makeTexture(gl);
    this.maskTex = makeTexture(gl, gl.NEAREST);
    gl.uniform1i(this.u.uVideo, 0);
    gl.uniform1i(this.u.uOverlay, 1);
    gl.uniform1i(this.u.uMask, 2);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

    this.quadData = new Float32Array(8);
    this.facePts = new Float32Array(MAX_FACES * 8);
    this.faceR = new Float32Array(MAX_FACES);
    this.overlaySize = [1, 1];
    this.setOverlay(null);
    this.setMask(null);
  }

  /** @param {TexImageSource|null} img */
  setOverlay(img) {
    const gl = this.gl;
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
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (mask) gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, mask.width, mask.height, 0, gl.RED, gl.UNSIGNED_BYTE, mask.data);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]));
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  }

  /**
   * @param {HTMLVideoElement} video
   * @param {object} s  frame state: quad, alpha, effect, shape, border, color [r,g,b] 0..1,
   *                    mirror, time, targetBits, faceFx, faces [{eyeL,eyeR,mouth,nose,r,on}]
   */
  draw(video, s) {
    const gl = this.gl;
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.videoTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);

    const u = this.u;
    gl.uniform1f(u.uAlpha, s.quad ? s.alpha : 0);
    gl.uniform1i(u.uMirror, s.mirror ? 1 : 0);
    gl.uniform2f(u.uTexel, 1 / w, 1 / h);
    gl.uniform1f(u.uAspect, w / h);
    gl.uniform1f(u.uTime, s.time);
    if (s.quad) {
      s.quad.forEach((p, i) => { this.quadData[i * 2] = p.x; this.quadData[i * 2 + 1] = p.y; });
      gl.uniform2fv(u.uQuad, this.quadData);
      const [fw, fh] = frameSize(s.quad, w, h);
      gl.uniform1f(u.uFrameAspect, fh > 0 ? Math.max(0.05, Math.min(20, fw / fh)) : 1);
      gl.uniform2fv(u.uCover, coverScale(fw, fh, this.overlaySize));
      gl.uniform1i(u.uEffect, Math.max(0, EFFECTS.indexOf(s.effect)));
      gl.uniform1i(u.uShape, Math.max(0, SHAPES.indexOf(s.shape)));
      gl.uniform1i(u.uBorder, Math.max(0, BORDERS.indexOf(s.border)));
      gl.uniform3fv(u.uColor, s.color);
      gl.uniform1i(u.uTargetBits, s.targetBits || 0);
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
