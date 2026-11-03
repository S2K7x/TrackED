// WebGL2 rendering of the superpowers, on the app's existing context and
// camera texture. Per frame (only the passes the current power needs):
//
//   1. plate    (when a new person mask arrives) learns the room behind you: a
//               running average of the camera wherever the mask says "not a
//               person". Alpha = "this pixel has been seen" (ping-pong FBOs).
//   2. history  (speedster, clones) writes camera + mask into one layer of a
//               ring of past frames (TEXTURE_2D_ARRAY, half resolution).
//   3. world    one full-screen pass: shockwaves, gravity lenses and black
//               holes (UV warps), time stop, invisibility, afterimages, clones,
//               portals and the aura, then the flash.
//   4. glow     every particle, beam, bolt, orb and ring in ONE instanced draw,
//               blended with "screen" (src + dst·(1 − src)) so colours stay
//               visible over bright rooms instead of clipping to white.
//
// Camera, mask, plate and history live in camera space (not mirrored); the
// world pass maps display → camera with src() like the main renderer.
// Textures rendered into FBOs are stored bottom-up: fbo() flips v when reading.

import { STRIDE } from "./particles.js";

const HIST_LAYERS = 10;

const VERT = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 vUv;
void main() {
  vec2 p = P[gl_VertexID];
  vUv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

// running average of the room wherever no person is seen
const PLATE_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uVideo;
uniform sampler2D uPerson;
uniform sampler2D uPrev;
uniform float uRate;
void main() {
  vec3 c = texture(uVideo, vUv).rgb;
  // conservative: anything near a person (blurred mask) is not learned, so no halo of you sticks to the room
  float m = max(texture(uPerson, vUv).r, textureLod(uPerson, vUv, 2.5).r * 1.6);
  float bg = 1.0 - smoothstep(0.04, 0.25, m);
  vec4 p = texture(uPrev, vec2(vUv.x, 1.0 - vUv.y));
  float k = bg * (p.a < 0.5 ? 1.0 : uRate);     // never-seen pixels are taken at once, known ones adapt slowly
  o = vec4(mix(p.rgb, c, k), max(p.a, step(0.5, bg)));
}`;

// camera + person mask snapshot (history layers, the time-stop still)
const SNAP_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uVideo;
uniform sampler2D uPerson;
uniform float uHasMask;
void main() { o = vec4(texture(uVideo, vUv).rgb, uHasMask * texture(uPerson, vUv).r); }`;

const WORLD_FRAG = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;
in vec2 vUv;
out vec4 o;
uniform sampler2D uVideo;
uniform sampler2D uPerson;
uniform sampler2D uPlate;
uniform sampler2D uFreeze;
uniform sampler2DArray uHist;
uniform bool  uMirror;
uniform float uAspect;
uniform float uTime;
uniform vec3  uColor;
uniform vec2  uShake;
uniform float uHasMask;
uniform float uInvis;
uniform int   uCloak;
uniform float uFrozen;
uniform float uEcho;
uniform int   uHistN;
uniform int   uHistHead;
uniform int   uClones;
uniform float uCloneAmt;
uniform float uAura;
uniform vec4  uWaves[4];     // x, y, radius, strength
uniform int   uWaveN;
uniform vec4  uWells[3];     // x, y, radius, strength (> 0 lens, < 0 black hole)
uniform int   uWellN;
uniform vec4  uPortals[2];   // x, y, radius, open 0..1
uniform int   uPortalN;
uniform float uFlash;

const int LAYERS = ${HIST_LAYERS};
vec2 src(vec2 uv) { return vec2(uMirror ? 1.0 - uv.x : uv.x, uv.y); }
vec3 cam(vec2 uv) { return texture(uVideo, src(uv)).rgb; }
float person(vec2 uv, float lod) { return uHasMask * textureLod(uPerson, src(uv), lod).r; }
vec4 fbo(sampler2D t, vec2 uv) { vec2 s = src(uv); return texture(t, vec2(s.x, 1.0 - s.y)); }
vec4 hist(int age, vec2 uv) {
  int layer = (uHistHead - age + LAYERS * 4) % LAYERS;
  vec2 s = src(uv);
  return texture(uHist, vec3(s.x, 1.0 - s.y, float(layer)));
}
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + 1.0), f.x), f.y);
}
float fbm(vec2 p) { return 0.55 * noise(p) + 0.3 * noise(p * 2.03 + 7.1) + 0.15 * noise(p * 4.1 + 3.3); }
vec3 hue(float h) { return clamp(abs(fract(h + vec3(0.0, 2.0, 1.0) / 3.0) * 6.0 - 3.0) - 1.0, 0.0, 1.0); }

void main() {
  vec2 uv = vUv + uShake;
  vec2 A = vec2(uAspect, 1.0);
  float hole = 0.0;

  // ---- space distortions (sample elsewhere = the picture bends) ----
  for (int i = 0; i < 4; i++) {
    if (i >= uWaveN) break;
    vec4 w = uWaves[i];
    vec2 d = (uv - w.xy) * A;
    float r = length(d), band = (r - w.z) / 0.05;
    uv -= (r > 1e-4 ? d / r : vec2(0.0)) / A * exp(-band * band) * w.w * 0.04;
  }
  for (int i = 0; i < 3; i++) {
    if (i >= uWellN) break;
    vec4 w = uWells[i];
    vec2 d = (uv - w.xy) * A;
    float r = length(d), R = w.z, s = abs(w.w);
    float f = exp(-(r * r) / (R * R));
    float ang = (w.w < 0.0 ? 3.0 : 0.8) * s * f;
    d = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * d;
    d *= w.w < 0.0 ? 1.0 + 1.1 * s * f : 1.0 - 0.45 * s * f;   // black hole pushes the light out, lens magnifies
    if (w.w < 0.0) hole = max(hole, s * smoothstep(R * 0.3, R * 0.16, r));
    uv = w.xy + d / A;
  }

  vec3 live = cam(uv);
  float m = smoothstep(0.3, 0.7, person(uv, 0.0));
  vec3 col = live;

  // ---- time stop: the room freezes and goes cold, you stay live ----
  if (uFrozen > 0.001) {
    vec4 fz = fbo(uFreeze, uv), pl = fbo(uPlate, uv);
    vec3 still = (fz.a > 0.5 && pl.a > 0.5) ? pl.rgb : fz.rgb;   // where you stood when it froze: the room
    vec3 cold = mix(vec3(luma(still)), still, 0.25) * vec3(0.8, 0.92, 1.18) + vec3(0.02, 0.03, 0.07);
    col = mix(mix(live, cold, uFrozen), live, m);
  }

  // ---- afterimages (oldest first, behind you) ----
  if (uEcho > 0.001) {
    for (int i = LAYERS - 1; i >= 1; i--) {
      if (i >= uHistN) continue;
      vec4 h = hist(i, uv);
      float k = float(i) / float(uHistN);
      vec3 tint = mix(uColor, hue(k * 0.6 + uTime * 0.1), 0.35);
      col = mix(col, mix(h.rgb, tint, 0.45 + 0.35 * k), smoothstep(0.45, 0.75, h.a) * (1.0 - k) * uEcho * (1.0 - m));
    }
  }

  // ---- clones: delayed copies of you on both sides (far ones first) ----
  if (uClones > 0 && uCloneAmt > 0.001) {
    for (int k = 3; k >= 0; k--) {
      if (k >= uClones) continue;
      float ring = float(k / 2 + 1), side = (k % 2 == 0) ? -1.0 : 1.0;
      vec2 off = vec2(side * 0.26 * ring, 0.0);
      vec4 h = hist(min(int(ring) * 3 + k % 2, uHistN - 1), uv - off);
      float appear = smoothstep(0.0, 0.25, uCloneAmt - 0.75 * noise((uv - off) * A * 30.0));
      col = mix(col, h.rgb * (1.0 - 0.07 * ring), smoothstep(0.45, 0.75, h.a) * appear * (1.0 - m));
    }
  }

  // ---- portals (behind you) ----
  for (int i = 0; i < 2; i++) {
    if (i >= uPortalN) break;
    vec4 p = uPortals[i];
    float R = p.z * p.w;
    vec2 d = (uv - p.xy) * A;
    float r = length(d) / max(R, 1e-4);
    if (r < 1.0) {
      float ang = atan(d.y, d.x) + uTime * 0.7 + (1.0 - r) * 4.0;
      vec2 q = vec2(cos(ang), sin(ang)) * pow(r, 0.6);
      float neb = fbm(q * 3.5 + uTime * 0.15);
      vec3 deep = vec3(0.12, 0.03, 0.3);
      vec3 world = mix(deep * 0.4, mix(deep * 2.5, uColor, neb), neb);
      float star = step(0.985, hash(floor(q * 60.0))) * (0.5 + 0.5 * sin(uTime * 5.0 + hash(floor(q * 60.0)) * 30.0));
      world += vec3(star) + vec3(1.0, 0.95, 0.9) * pow(1.0 - r, 3.0) * 0.8;
      col = mix(col, world, smoothstep(1.0, 0.93, r) * (1.0 - m));
    }
  }

  // ---- invisibility ----
  if (uInvis > 0.001 && uHasMask > 0.5) {
    float soft = person(uv, 2.0);
    float mi = smoothstep(0.15, 0.5, max(person(uv, 0.0), soft * 1.25));   // dilated: hair and edges vanish too
    float e = 0.008;
    vec2 g = vec2(person(uv + vec2(e, 0.0), 2.0) - person(uv - vec2(e, 0.0), 2.0),
                  person(uv + vec2(0.0, e), 2.0) - person(uv - vec2(0.0, e), 2.0));
    float n = noise(uv * A * 16.0 + uTime * 1.3);
    vec2 refr = g * 0.05 + (n - 0.5) * 0.008;
    vec4 pl = fbo(uPlate, uv);
    float bend = uCloak == 1 ? 1.0 : 0.15;
    vec3 room = pl.a > 0.5 ? fbo(uPlate, uv + refr * bend).rgb
      // never seen behind you: heat-haze of the live picture (a "cloaked" shimmer instead of a hole)
      : mix(cam(uv + refr * 3.0 + vec2(0.012, -0.01)), vec3(luma(live)), 0.3);
    float edge = clamp(length(g) * 6.0, 0.0, 1.0);
    vec3 cloak = room;
    if (uCloak == 1) cloak += (uColor * 0.5 + 0.2) * edge * (0.5 + 0.5 * sin(uTime * 6.0 + n * 6.0)) * 0.6;
    if (uCloak == 2) cloak = mix(room, live, 0.28) + uColor * edge * 0.5;
    // dissolve: noise threshold sweeps with the fade, with a glowing front
    float th = fbm(uv * A * 9.0);
    float amount = smoothstep(th - 0.08, th + 0.08, uInvis * 1.16 - 0.08);
    float front = (1.0 - abs(uInvis * 1.16 - 0.08 - th) / 0.06) * step(0.01, uInvis) * step(uInvis, 0.99);
    col = mix(col, cloak, mi * amount) + uColor * clamp(front, 0.0, 1.0) * mi * 1.2;
  }

  // ---- aura: flames licking up from your silhouette ----
  if (uAura > 0.001 && uHasMask > 0.5) {
    float n = fbm(vec2(uv.x * uAspect * 7.0, uv.y * 5.0 + uTime * 2.4));
    float halo = max(person(uv + vec2(0.0, 0.03 + 0.08 * n) * uAura, 3.5), person(uv + vec2(0.0, 0.02 * n), 2.5));
    float body = smoothstep(0.3, 0.7, person(uv, 1.0));
    float outer = clamp(halo * 2.0, 0.0, 1.0) * (1.0 - body);       // only around you, never over you
    float flame = outer * smoothstep(0.35, 0.85, n + outer * 0.35);
    col += (uColor * 1.2 + 0.15) * flame * uAura + vec3(pow(flame, 4.0)) * 0.6 * uAura;
    col = mix(col, col + uColor * 0.25, body * uAura * 0.5 * (0.6 + 0.4 * sin(uTime * 9.0)));   // pulsing inner glow
  }

  col *= 1.0 - hole;
  col += uFlash * (0.75 + 0.25 * uColor);
  o = vec4(col, 1.0);
}`;

// one instanced quad per glow; see KIND in particles.js
const GLOW_VERT = `#version 300 es
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 iSeg;
layout(location = 2) in vec4 iCol;
layout(location = 3) in vec4 iPar;     // width, kind, p1, p2
uniform float uAspect;
uniform vec2 uShake;
out vec2 vP;
out vec4 vSeg;
out vec4 vCol;
out vec4 vPar;
void main() {
  vec2 a = iSeg.xy * vec2(uAspect, 1.0), b = iSeg.zw * vec2(uAspect, 1.0);
  float w = iPar.x, kind = iPar.y;
  float pad = kind == 3.0 ? w + iPar.z * 4.0 : kind == 2.0 ? w * 2.6 : w * 3.2;   // room for the halo
  vec2 dir = b - a;
  float L = length(dir);
  vec2 t = L > 1e-6 ? dir / L : vec2(1.0, 0.0), n = vec2(-t.y, t.x);
  vec2 p = (kind == 3.0 ? a : mix(a, b, aCorner.x * 0.5 + 0.5)) + t * aCorner.x * pad + n * aCorner.y * pad;
  vP = p; vSeg = vec4(a, b); vCol = iCol; vPar = iPar;
  vec2 s = vec2(p.x / uAspect, p.y) - uShake;
  gl_Position = vec4(s.x * 2.0 - 1.0, 1.0 - s.y * 2.0, 0.0, 1.0);
}`;

const GLOW_FRAG = `#version 300 es
precision highp float;
in vec2 vP;
in vec4 vSeg;
in vec4 vCol;
in vec4 vPar;
out vec4 o;
uniform float uTime;
uniform float uGlow;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + 1.0), f.x), f.y);
}
float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
  return length(pa - ba * h);
}
void main() {
  float w = vPar.x, kind = vPar.y;
  vec3 c = vCol.rgb;
  float I = 0.0, core = 0.0;
  if (kind == 2.0) {                                  // ORB: swirling plasma ball
    vec2 d = vP - vSeg.xy;
    float r = length(d) / w;
    float a = atan(d.y, d.x);
    float swirl = noise(vec2(a * 3.0 + uTime * 4.0 + r * 6.0, r * 5.0 - uTime * 3.0 + vPar.z));
    float body = smoothstep(1.0, 0.55, r) * (0.55 + 0.6 * swirl);
    I = body + exp(-max(r - 0.9, 0.0) * 2.2) * 0.45 * uGlow;
    core = smoothstep(0.55, 0.0, r) * (0.8 + 0.2 * swirl);
  } else if (kind == 3.0) {                           // RING: radius w, half-thickness p1
    float d = abs(length(vP - vSeg.xy) - w) / max(vPar.z, 1e-4);
    float ripple = 0.75 + 0.25 * noise(vec2(atan(vP.y - vSeg.y, vP.x - vSeg.x) * 6.0 + uTime * 3.0 + vPar.w, uTime));
    I = (exp(-d * d * 1.5) + exp(-d) * 0.35 * uGlow) * ripple;
    core = exp(-d * d * 6.0) * 0.6;
  } else if (kind == 4.0) {                           // BEAM: wide turbulent beam with a white-hot core
    vec2 ba = vSeg.zw - vSeg.xy;
    float along = dot(vP - vSeg.xy, ba) / max(dot(ba, ba), 1e-9);
    float wob = 1.0 + 0.18 * sin(along * 60.0 - uTime * 40.0) + 0.12 * (noise(vec2(along * 30.0 - uTime * 25.0, vPar.z)) - 0.5);
    float d = sdSeg(vP, vSeg.xy, vSeg.zw) / (w * wob);
    I = smoothstep(1.0, 0.6, d) * 0.9 + exp(-max(d - 0.8, 0.0) * 1.8) * 0.5 * uGlow;
    core = smoothstep(0.55, 0.1, d);
  } else {                                            // DOT / LINE: gaussian glow around a segment
    float d = sdSeg(vP, vSeg.xy, vSeg.zw) / w;
    I = exp(-d * d * 1.2) + exp(-d * 1.3) * 0.3 * uGlow;
    core = kind == 1.0 ? exp(-d * d * 5.0) : 0.0;
  }
  vec3 rgb = (c * I + vec3(core)) * vCol.a;
  o = vec4(min(rgb, vec3(1.0)), 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

function program(gl, vs, fs, uniforms) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  for (const n of uniforms) u[n] = gl.getUniformLocation(p, n);
  return { p, u };
}

function texture(gl, filter = gl.LINEAR, target = gl.TEXTURE_2D) {
  // create on a spare unit: binding a new render target to a unit a pass samples
  // (e.g. the camera on unit 0) would form a feedback loop on the next draw
  gl.activeTexture(gl.TEXTURE0 + SPARE_UNIT);
  const t = gl.createTexture();
  gl.bindTexture(target, t);
  gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

// texture units used here (0 = the main renderer's camera texture)
const U = { video: 0, person: 6, plate: 7, hist: 8, freeze: 9 };
const SPARE_UNIT = 15;

export class PowerRenderer {
  /** @param {import("../renderer.js").Renderer} renderer  shares its GL context and camera texture */
  constructor(renderer) {
    this.r = renderer;
    const gl = (this.gl = renderer.gl);
    this.vao = gl.createVertexArray();
    this.plateProg = program(gl, VERT, PLATE_FRAG, ["uVideo", "uPerson", "uPrev", "uRate"]);
    this.snapProg = program(gl, VERT, SNAP_FRAG, ["uVideo", "uPerson", "uHasMask"]);
    this.world = program(gl, VERT, WORLD_FRAG, [
      "uVideo", "uPerson", "uPlate", "uFreeze", "uHist", "uMirror", "uAspect", "uTime", "uColor", "uShake", "uHasMask",
      "uInvis", "uCloak", "uFrozen", "uEcho", "uHistN", "uHistHead", "uClones", "uCloneAmt", "uAura",
      "uWaves", "uWaveN", "uWells", "uWellN", "uPortals", "uPortalN", "uFlash",
    ]);
    this.glowProg = program(gl, GLOW_VERT, GLOW_FRAG, ["uAspect", "uShake", "uTime", "uGlow"]);

    // person mask: R8, mipmapped (textureLod = free blur for halos, edges and the aura)
    this.personTex = texture(gl, gl.LINEAR_MIPMAP_LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]));
    gl.generateMipmap(gl.TEXTURE_2D);
    this.hasMask = false;
    // stand-in for a buffer that doesn't exist yet: transparent = "never seen"
    this.blank = texture(gl);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    this.fbo = gl.createFramebuffer();
    this.plates = null;      // [tex, tex] ping-pong, allocated on first use
    this.hist = null;
    this.freezeTex = null;
    this.histHead = 0;
    this.histCount = 0;

    // glow instances
    this.glowVao = gl.createVertexArray();
    gl.bindVertexArray(this.glowVao);
    const corners = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.instBuf = gl.createBuffer();
    this.instCap = 0;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    for (let i = 0; i < 3; i++) {
      gl.enableVertexAttribArray(1 + i);
      gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, STRIDE * 4, i * 16);
      gl.vertexAttribDivisor(1 + i, 1);
    }
    gl.bindVertexArray(null);
  }

  #reset() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  }

  /** Uploads the camera frame and sizes the canvas (like Renderer.draw). @returns {boolean} */
  begin(video) {
    const gl = this.gl, vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return false;
    const w = Math.round(vw * this.r.scale), h = Math.round(vh * this.r.scale);
    const canvas = this.r.canvas;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    this.#reset();
    gl.activeTexture(gl.TEXTURE0 + U.video);
    gl.bindTexture(gl.TEXTURE_2D, this.r.videoTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    this.vw = vw; this.vh = vh;
    return true;
  }

  /** @param {{data: Uint8Array, width: number, height: number}} mask  soft person mask, camera space */
  setPerson(mask) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + U.person);
    gl.bindTexture(gl.TEXTURE_2D, this.personTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, mask.width, mask.height, 0, gl.RED, gl.UNSIGNED_BYTE, mask.data);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    this.hasMask = true;
  }

  #bindPerson() {
    this.gl.activeTexture(this.gl.TEXTURE0 + U.person);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.personTex);
  }

  #target(tex, w, h, layer = -1) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    if (layer >= 0) gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, tex, 0, layer);
    else gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, w, h);
  }

  #alloc2D(w, h) {
    const gl = this.gl, t = texture(gl);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return t;
  }

  /** Size of the learned room / time-stop still (capped: 1280 px on the long side). */
  #fullSize() {
    const k = Math.min(1, 1280 / Math.max(this.vw, this.vh));
    return [Math.round(this.vw * k), Math.round(this.vh * k)];
  }

  #ensurePlate() {
    const [w, h] = this.#fullSize();
    if (this.plates && this.plateSize[0] === w && this.plateSize[1] === h) return;
    for (const t of this.plates ?? []) this.gl.deleteTexture(t);
    this.plates = [this.#alloc2D(w, h), this.#alloc2D(w, h)];
    this.plateSize = [w, h];
    this.plateCur = 0;
    this.resetPlate();
  }

  /** Forgets the learned room (e.g. the camera moved). */
  resetPlate() {
    if (!this.plates) return;
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 0);
    for (const t of this.plates) { this.#target(t, ...this.plateSize); gl.clear(gl.COLOR_BUFFER_BIT); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Learns the room from the current frame (call when a fresh mask arrived). */
  updatePlate(rate = 0.06) {
    if (!this.hasMask) return;
    this.#ensurePlate();
    const gl = this.gl, { p, u } = this.plateProg;
    const prev = this.plates[this.plateCur], next = this.plates[1 - this.plateCur];
    gl.useProgram(p);
    gl.bindVertexArray(this.vao);
    this.#bindPerson();
    gl.activeTexture(gl.TEXTURE0 + U.plate);
    gl.bindTexture(gl.TEXTURE_2D, prev);
    gl.uniform1i(u.uVideo, U.video);
    gl.uniform1i(u.uPerson, U.person);
    gl.uniform1i(u.uPrev, U.plate);
    gl.uniform1f(u.uRate, rate);
    this.#target(next, ...this.plateSize);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.plateCur = 1 - this.plateCur;
  }

  #snap(tex, w, h, layer = -1) {
    const gl = this.gl, { p, u } = this.snapProg;
    gl.useProgram(p);
    gl.bindVertexArray(this.vao);
    this.#bindPerson();
    gl.uniform1i(u.uVideo, U.video);
    gl.uniform1i(u.uPerson, U.person);
    gl.uniform1f(u.uHasMask, this.hasMask ? 1 : 0);
    this.#target(tex, w, h, layer);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Stores this frame (camera + mask) as the newest afterimage / clone source. */
  pushHistory() {
    const gl = this.gl;
    const k = Math.min(1, 640 / Math.max(this.vw, this.vh));
    const w = Math.round(this.vw * k), h = Math.round(this.vh * k);
    if (!this.hist || this.histSize[0] !== w || this.histSize[1] !== h) {
      if (this.hist) gl.deleteTexture(this.hist);
      this.hist = texture(gl, gl.LINEAR, gl.TEXTURE_2D_ARRAY);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, w, h, HIST_LAYERS);
      this.histSize = [w, h];
      this.histCount = 0;
    }
    this.histHead = (this.histHead + 1) % HIST_LAYERS;
    this.#snap(this.hist, w, h, this.histHead);
    this.histCount = Math.min(HIST_LAYERS, this.histCount + 1);
  }

  clearHistory() { this.histCount = 0; }

  /** Takes the time-stop still (camera + where you stood). */
  captureFreeze() {
    const [w, h] = this.#fullSize();
    if (!this.freezeTex || this.freezeSize[0] !== w || this.freezeSize[1] !== h) {
      if (this.freezeTex) this.gl.deleteTexture(this.freezeTex);
      this.freezeTex = this.#alloc2D(w, h);
      this.freezeSize = [w, h];
    }
    this.#snap(this.freezeTex, w, h);
  }

  /**
   * The world pass, drawn on the canvas.
   * @param {object} s  {mirror, time, aspect, color [r,g,b], shake {x,y}, invis, cloak, frozen, echo,
   *                     clones, cloneAmt, aura, waves [{x,y,r,s}], wells [{x,y,r,s}], portals [{x,y,r,open}], flash}
   */
  drawWorld(s) {
    const gl = this.gl, { p, u } = this.world, c = this.r.canvas;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, c.width, c.height);
    gl.useProgram(p);
    gl.bindVertexArray(this.vao);
    const bind = (unit, target, tex) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(target, tex); };
    bind(U.person, gl.TEXTURE_2D, this.personTex);
    bind(U.plate, gl.TEXTURE_2D, this.plates ? this.plates[this.plateCur] : this.blank);
    bind(U.freeze, gl.TEXTURE_2D, this.freezeTex ?? this.blank);
    bind(U.hist, gl.TEXTURE_2D_ARRAY, this.hist ?? this.#emptyArray());
    gl.uniform1i(u.uVideo, U.video);
    gl.uniform1i(u.uPerson, U.person);
    gl.uniform1i(u.uPlate, U.plate);
    gl.uniform1i(u.uFreeze, U.freeze);
    gl.uniform1i(u.uHist, U.hist);
    gl.uniform1i(u.uMirror, s.mirror ? 1 : 0);
    gl.uniform1f(u.uAspect, s.aspect);
    gl.uniform1f(u.uTime, s.time);
    gl.uniform3fv(u.uColor, s.color);
    gl.uniform2f(u.uShake, s.shake?.x ?? 0, s.shake?.y ?? 0);
    gl.uniform1f(u.uHasMask, this.hasMask ? 1 : 0);
    gl.uniform1f(u.uInvis, this.hasMask ? s.invis || 0 : 0);
    gl.uniform1i(u.uCloak, s.cloak || 0);
    gl.uniform1f(u.uFrozen, this.freezeTex ? s.frozen || 0 : 0);
    gl.uniform1f(u.uEcho, this.hist ? s.echo || 0 : 0);
    gl.uniform1i(u.uHistN, this.histCount);
    gl.uniform1i(u.uHistHead, this.histHead);
    gl.uniform1i(u.uClones, this.hist && this.histCount > 1 ? s.clones || 0 : 0);
    gl.uniform1f(u.uCloneAmt, s.cloneAmt || 0);
    gl.uniform1f(u.uAura, s.aura || 0);
    const vec4s = (list, n, f) => {
      const a = new Float32Array(n * 4);
      list.slice(0, n).forEach((x, i) => a.set(f(x), i * 4));
      return a;
    };
    const waves = s.waves ?? [], wells = s.wells ?? [], portals = s.portals ?? [];
    gl.uniform4fv(u.uWaves, vec4s(waves, 4, (w) => [w.x, w.y, w.r, w.s]));
    gl.uniform1i(u.uWaveN, Math.min(4, waves.length));
    gl.uniform4fv(u.uWells, vec4s(wells, 3, (w) => [w.x, w.y, w.r, w.s]));
    gl.uniform1i(u.uWellN, Math.min(3, wells.length));
    gl.uniform4fv(u.uPortals, vec4s(portals, 2, (q) => [q.x, q.y, q.r, q.open]));
    gl.uniform1i(u.uPortalN, Math.min(2, portals.length));
    gl.uniform1f(u.uFlash, s.flash || 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  #emptyArray() {
    const gl = this.gl;
    if (!this.empty) {
      this.empty = texture(gl, gl.LINEAR, gl.TEXTURE_2D_ARRAY);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, 1, 1, 1);
    }
    return this.empty;
  }

  /**
   * All glows in one instanced draw.
   * @param {import("./particles.js").GlowBatch} batch
   * @param {{aspect: number, time: number, shake?: {x, y}, glow?: number}} s
   */
  drawGlow(batch, s) {
    if (!batch.count) return;
    const gl = this.gl, { p, u } = this.glowProg, c = this.r.canvas;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, c.width, c.height);
    gl.useProgram(p);
    gl.bindVertexArray(this.glowVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    const bytes = batch.count * STRIDE * 4;
    if (bytes > this.instCap) {
      this.instCap = Math.max(bytes, batch.max * STRIDE * 4);
      gl.bufferData(gl.ARRAY_BUFFER, this.instCap, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, batch.view);
    gl.uniform1f(u.uAspect, s.aspect);
    gl.uniform2f(u.uShake, s.shake?.x ?? 0, s.shake?.y ?? 0);
    gl.uniform1f(u.uTime, s.time);
    gl.uniform1f(u.uGlow, s.glow ?? 1);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);    // "screen"
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, batch.count);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  dispose() {
    const gl = this.gl;
    for (const t of [this.personTex, this.blank, ...(this.plates ?? []), this.hist, this.freezeTex, this.empty]) if (t) gl.deleteTexture(t);
    gl.deleteFramebuffer(this.fbo);
    gl.deleteBuffer(this.instBuf);
  }
}
