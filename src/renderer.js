// WebGL2 renderer: the whole effect runs in one fragment shader on the GPU.
// The camera frame is uploaded as a texture; for each pixel the shader inverts
// the bilinear mapping of the frame quad to get (u, v) inside the frame. That
// gives a perfectly anti-aliased edge, a glowing border, and lets an overlay
// image be warped onto the (non-rectangular) frame — with zero CPU pixel work.

export const EFFECTS = ["neon", "violet", "jaune", "invert", "bw", "glitch", "image"];

const VERT = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 vUv;
void main() {
  vec2 p = P[gl_VertexID];          // one oversized triangle covers the screen
  vUv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); // y down, like image/landmark coords
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;

uniform sampler2D uVideo;
uniform sampler2D uOverlay;
uniform vec2  uQuad[4];
uniform float uAlpha;     // 0 = no frame
uniform int   uEffect;
uniform bool  uMirror;
uniform vec2  uTexel;     // 1 / video size
uniform float uTime;
uniform vec2  uCover;     // overlay "object-fit: cover" scale
uniform vec3  uBorder;    // border colour

float cross2(vec2 a, vec2 b) { return a.x * b.y - a.y * b.x; }

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

vec3 cam(vec2 uv) {
  return texture(uVideo, vec2(uMirror ? 1.0 - uv.x : uv.x, uv.y)).rgb;
}
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

float sobel(vec2 uv) {
  vec2 t = uTexel * 1.5;
  float tl = luma(cam(uv + vec2(-t.x, -t.y))), tc = luma(cam(uv + vec2(0.0, -t.y))), tr = luma(cam(uv + vec2(t.x, -t.y)));
  float ml = luma(cam(uv + vec2(-t.x, 0.0))),                                         mr = luma(cam(uv + vec2(t.x, 0.0)));
  float bl = luma(cam(uv + vec2(-t.x, t.y))), bc = luma(cam(uv + vec2(0.0, t.y))),  br = luma(cam(uv + vec2(t.x, t.y)));
  float gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
  float gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;
  return length(vec2(gx, gy));
}

vec3 tint(vec3 c, vec3 col) { return col * smoothstep(0.0, 0.85, luma(c)) * 1.25; }

vec3 applyEffect(vec3 c, vec2 uv, vec2 fuv) {
  if (uEffect == 0) {            // neon red: posterized red/black + glowing edges
    float l = luma(c);
    float v = l > 0.6 ? 1.0 : l > 0.36 ? 0.75 : l > 0.2 ? 0.25 : 0.05;
    vec3 col = vec3(v, v > 0.9 ? 0.18 : 0.0, v > 0.9 ? 0.18 : 0.0);
    float e = smoothstep(0.25, 0.6, sobel(uv));
    return mix(col, vec3(1.0, 0.85, 0.85), e * 0.8);
  }
  if (uEffect == 1) return tint(c, vec3(0.6, 0.2, 1.0));   // violet
  if (uEffect == 2) return tint(c, vec3(1.0, 0.85, 0.15)); // jaune
  if (uEffect == 3) return 1.0 - c;                        // négatif
  if (uEffect == 4) {                                      // N&B contrasté
    float l = clamp((luma(c) - 0.5) * 1.6 + 0.5, 0.0, 1.0);
    return vec3(l);
  }
  if (uEffect == 5) {                                      // glitch: RGB split + scanlines
    float shift = 0.006 + 0.004 * sin(uTime * 7.0 + uv.y * 40.0);
    vec3 g = vec3(cam(uv + vec2(shift, 0.0)).r, c.g, cam(uv - vec2(shift, 0.0)).b);
    float scan = 0.85 + 0.15 * sin(uv.y / uTexel.y * 1.5);
    return g * scan * vec3(0.9, 1.1, 1.2);
  }
  // 6: overlay image warped onto the frame, blended with the camera
  vec2 ouv = (fuv - 0.5) / uCover + 0.5;
  vec3 img = texture(uOverlay, ouv).rgb;
  return mix(img, img * (0.6 + 0.6 * luma(c)), 0.35);
}

void main() {
  vec3 base = cam(vUv);
  if (uAlpha <= 0.0) { outColor = vec4(base, 1.0); return; }

  vec2 fuv = invBilinear(vUv, uQuad[0], uQuad[1], uQuad[2], uQuad[3]);
  // distance to the nearest frame edge, in screen pixels (fwidth = per-pixel rate)
  vec2 fw = max(fwidth(fuv), vec2(1e-6));
  vec2 d2 = min(fuv, 1.0 - fuv) / fw;
  float d = min(d2.x, d2.y);
  float inside = clamp(d + 0.5, 0.0, 1.0);          // 1px anti-aliased edge
  if (inside <= 0.0) {
    // soft outer glow just outside the frame. Only trust (u,v) close to the frame:
    // far away the inverse mapping can pick a spurious root, and fwidth blows up
    // across root discontinuities — both would draw stray lines across the screen.
    bool near = all(greaterThan(fuv, vec2(-0.3))) && all(lessThan(fuv, vec2(1.3))) && max(fw.x, fw.y) < 0.05;
    float glow = near ? exp(d * 0.35) * 0.55 : 0.0;
    outColor = vec4(mix(base, uBorder, glow * uAlpha), 1.0);
    return;
  }
  vec3 fx = applyEffect(base, vUv, clamp(fuv, 0.0, 1.0));
  float border = 1.0 - smoothstep(1.5, 3.0, d);      // ~2px bright rim
  fx = mix(fx, uBorder, border * 0.9);
  outColor = vec4(mix(base, fx, inside * uAlpha), 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

function makeTexture(gl) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

const BORDERS = {
  neon: [1, 0.25, 0.3], violet: [0.75, 0.5, 1], jaune: [1, 0.95, 0.5],
  invert: [1, 1, 1], bw: [1, 1, 1], glitch: [0.3, 1, 1], image: [1, 1, 1],
};

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext("webgl2", {
      alpha: false, antialias: false, depth: false, stencil: false,
      preserveDrawingBuffer: false, powerPreference: "high-performance",
      desynchronized: true,
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
    for (const name of ["uVideo", "uOverlay", "uQuad", "uAlpha", "uEffect", "uMirror", "uTexel", "uTime", "uCover", "uBorder"]) {
      this.u[name] = gl.getUniformLocation(prog, name);
    }
    this.videoTex = makeTexture(gl);
    this.overlayTex = makeTexture(gl);
    gl.uniform1i(this.u.uVideo, 0);
    gl.uniform1i(this.u.uOverlay, 1);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    this.overlaySize = [1, 1];
    this.setOverlay(null);
    this.quadData = new Float32Array(8);
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

  /**
   * @param {HTMLVideoElement} video
   * @param {{quad: {x:number,y:number}[]|null, alpha:number, effect:string, mirror:boolean, time:number}} s
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

    const alpha = s.quad ? s.alpha : 0;
    gl.uniform1f(this.u.uAlpha, alpha);
    gl.uniform1i(this.u.uEffect, Math.max(0, EFFECTS.indexOf(s.effect)));
    gl.uniform1i(this.u.uMirror, s.mirror ? 1 : 0);
    gl.uniform2f(this.u.uTexel, 1 / w, 1 / h);
    gl.uniform1f(this.u.uTime, s.time);
    gl.uniform3fv(this.u.uBorder, BORDERS[s.effect] || BORDERS.image);
    if (s.quad) {
      s.quad.forEach((p, i) => { this.quadData[i * 2] = p.x; this.quadData[i * 2 + 1] = p.y; });
      gl.uniform2fv(this.u.uQuad, this.quadData);
      gl.uniform2fv(this.u.uCover, coverScale(s.quad, w, h, this.overlaySize));
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

/** Scale that makes the overlay image fill the frame like CSS object-fit: cover. */
function coverScale(q, w, h, [iw, ih]) {
  const len = (a, b) => Math.hypot((a.x - b.x) * w, (a.y - b.y) * h);
  const fw = (len(q[0], q[1]) + len(q[3], q[2])) / 2;
  const fh = (len(q[0], q[3]) + len(q[1], q[2])) / 2;
  if (fw < 1 || fh < 1) return [1, 1];
  const frameAspect = fw / fh, imgAspect = iw / ih;
  return frameAspect > imgAspect ? [1, frameAspect / imgAspect] : [imgAspect / frameAspect, 1];
}
