// 3D accessories anchored to the head, rendered with three.js in the SAME WebGL
// context as the 2D effects, into an anti-aliased (MSAA) render target. The 2D
// renderer then composites that layer with a smooth fade and an anti-aliased
// frame clip, so photos and recordings include the 3D.
//
// Pose: MediaPipe Face Landmarker returns, per face, a 4×4 matrix that maps the
// canonical face model (centimetres, y up, z towards the camera, origin near the
// centre of the head) into camera space. A perspective camera that matches
// MediaPipe's virtual camera turns that into screen positions.
//
// Loaded lazily (three.js is ~650 kB) the first time a 3D option is picked.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { buildAccessory } from "./accessories.js";

export const CAMERA_FOV = 63; // MediaPipe face-geometry virtual camera (vertical FOV, degrees)
const MAX_FACES = 4;

export class ThreeLayer {
  /** @param {HTMLCanvasElement} canvas  @param {WebGL2RenderingContext} gl  shared context */
  /** @param {{samples?: number}} opts  MSAA samples for the 3D layer (0 on low-end phones) */
  constructor(canvas, gl, { samples = 4 } = {}) {
    this.r = new THREE.WebGLRenderer({ canvas, context: gl, antialias: false, alpha: false });
    this.r.autoClear = false;
    this.r.outputColorSpace = THREE.SRGBColorSpace;
    this.r.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(CAMERA_FOV, 16 / 9, 1, 10000);

    // soft studio reflections so metals and plastics look real
    const pmrem = new THREE.PMREMGenerator(this.r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x8a7a66, 0.9);
    this.key = new THREE.DirectionalLight(0xffffff, 1.6);
    this.key.position.set(20, 40, 60);
    this.scene.add(this.hemi, this.key);

    this.root = new THREE.Group();           // mirrored for the selfie camera
    this.scene.add(this.root);
    this.heads = [];
    for (let i = 0; i < MAX_FACES; i++) {
      const head = new THREE.Group();
      head.matrixAutoUpdate = false;
      head.visible = false;
      head.add(makeOccluder());
      this.root.add(head);
      this.heads.push(head);
    }
    this.template = null; // accessory shown on every head
    this.builtins = new Map(); // url → Promise<THREE.Object3D>, ready-made .glb accessories
    this.target = new THREE.WebGLRenderTarget(16, 16, { samples, depthBuffer: true });
    this.target.texture.colorSpace = THREE.SRGBColorSpace;
    this.poseSmooth = Array.from({ length: MAX_FACES }, () => new PoseSmoother());
  }

  /** Built-in accessory by name (null = none). */
  setAccessory(name, color) {
    this.#setTemplate(name ? buildAccessory(THREE, name, new THREE.Color(color)) : null);
  }

  /**
   * Ready-made .glb accessory, modelled around the reference head (anchor "As modelled").
   * Downloaded once per layer; returns false if `isCurrent()` turned false meanwhile (user picked something else).
   */
  async setBuiltinModel(url, isCurrent = () => true) {
    if (!this.builtins.has(url)) {
      const p = fetch(url)
        .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.arrayBuffer(); })
        .then((buf) => parseGlb(buf));
      p.then((scene) => { p.resolved = scene; }, () => this.builtins.delete(url)); // failed: allow a retry
      this.builtins.set(url, p);
    }
    const scene = await this.builtins.get(url);
    if (!isCurrent()) return false;
    this.#setTemplate(fitToHead(THREE, scene, "ref", 1, null));
    return true;
  }

  /**
   * Loads a user .glb / .gltf and fits it to the head.
   * @param {ArrayBuffer} data
   * @param {"top"|"eyes"|"head"|"ref"} anchor  hat, glasses/face, helmet, or as modelled on the Blender reference head
   */
  async loadModel(data, anchor = "top", scale = 1, fit = null) {
    this.userModel = stripReference(await parseGlb(data));
    this.fitUserModel(anchor, scale, fit);
  }

  /** Re-fits the loaded model (anchor / size changed). */
  fitUserModel(anchor = "top", scale = 1, fit = null) {
    if (!this.userModel) return;
    this.#setTemplate(fitToHead(THREE, this.userModel, anchor, scale, fit));
  }

  /** Live fine adjustment of the user model (offsets in cm, rotations in degrees), no rebuild. */
  setUserFit(fit) {
    for (const head of this.heads) {
      const adj = head.userData.acc?.getObjectByName("fit");
      if (adj) applyFit(adj, fit);
    }
  }

  #setTemplate(obj) {
    for (const head of this.heads) {
      if (head.userData.acc) { head.remove(head.userData.acc); head.userData.acc = null; }
    }
    // free GPU memory of the previous accessory (clones share geometry / materials, so once is enough);
    // a user model's originals stay alive in this.userModel and are reused by fitUserModel
    if (this.template && this.template !== obj) disposeTree(this.template, this.userModel, ...this.#loadedBuiltins());
    this.template = obj;
    if (!obj) return;
    this.heads.forEach((head, i) => {
      const acc = i === 0 ? obj : obj.clone(true);
      head.add(acc);
      head.userData.acc = acc;
    });
  }

  /** Already-parsed built-in scenes (their GPU data is reused, never disposed). */
  #loadedBuiltins() { return [...this.builtins.values()].map((p) => p.resolved).filter(Boolean); }

  get active() { return !!this.template; }

  /**
   * @param {{pose?: Float32Array, on?: boolean}[]} faces
   * @param {{width: number, height: number, mirror: boolean, time: number}} s
   * @returns {WebGLTexture|null} the rendered layer (premultiplied alpha), or null when nothing is visible
   */
  render(faces, s) {
    if (!this.template) return null;
    this.camera.aspect = s.width / s.height;
    this.camera.updateProjectionMatrix();
    this.root.scale.x = s.mirror ? -1 : 1;
    let any = false;
    this.heads.forEach((head, i) => {
      const f = faces[i];
      const show = !!(f && f.pose && f.on !== false && (f.reveal ?? 1) > 0);
      head.visible = show;
      if (!show) { if (!f?.pose) this.poseSmooth[i].reset(); return; }
      // pop-in: the accessory grows from 40% with a little overshoot as it's revealed
      const acc = head.userData.acc;
      if (acc) acc.scale.setScalar(Math.max(0.001, easeOutBack(f.reveal ?? 1)));
      this.poseSmooth[i].apply(f.pose, head.matrix, s.time);
      head.matrixWorldNeedsUpdate = true;
      any = true;
    });
    if (!any) return null;
    this.template.userData.animate?.(s.time);
    this.heads.forEach((h) => h.userData.acc?.userData.animate?.(s.time));

    const r = this.r;
    r.resetState();                 // the 2D renderer changed GL state behind three's back
    if (this.target.width !== s.width || this.target.height !== s.height) this.target.setSize(s.width, s.height);
    r.setRenderTarget(this.target);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, true);
    r.render(this.scene, this.camera);
    r.setRenderTarget(null);        // resolves MSAA into the texture
    return r.properties.get(this.target.texture).__webglTexture;
  }

  /** Projects a canonical-space point with a pose (used to calibrate / test). */
  project(pose, x, y, z) {
    const m = new THREE.Matrix4().fromArray(pose);
    const p = new THREE.Vector3(x, y, z).applyMatrix4(m).project(this.camera);
    return { x: (p.x + 1) / 2, y: (1 - p.y) / 2 };
  }
}

async function parseGlb(data) {
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/");
  loader.setDRACOLoader(draco);
  try {
    return (await loader.parseAsync(data, "")).scene;
  } finally {
    draco.dispose();
  }
}

function disposeTree(root, ...keep) {
  const kept = new Set();
  for (const k of keep) k?.traverse((o) => { if (o.geometry) kept.add(o.geometry); for (const m of [].concat(o.material || [])) kept.add(m); });
  root.traverse((o) => {
    if (o.geometry && !kept.has(o.geometry)) o.geometry.dispose();
    for (const m of [].concat(o.material || [])) {
      if (kept.has(m)) continue;
      for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
      m.dispose();
    }
  });
}

function easeOutBack(t) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 0.4 + 0.6 * (1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2));
}

/** Invisible head that only writes depth, so the back of hats / glasses arms hide behind the head. */
function makeOccluder() {
  const geo = new THREE.SphereGeometry(1, 32, 24);
  const mat = new THREE.MeshBasicMaterial({ colorWrite: false });
  const m = new THREE.Mesh(geo, mat);
  m.scale.set(7.4, 10.6, 9.6);     // canonical face: ±7.7 cm wide, chin at y = -9.4, nose at z = 7.5
  m.position.set(0, 1.2, -2.6);
  m.renderOrder = -1;
  return m;
}

/** Smooths a head pose: One-Euro-like on position, adaptive slerp on rotation. */
class PoseSmoother {
  constructor() { this.reset(); this.tmp = new THREE.Matrix4(); this.p = new THREE.Vector3(); this.q = new THREE.Quaternion(); this.sc = new THREE.Vector3(); }
  reset() { this.pos = null; this.rot = null; this.t = 0; }
  apply(pose, out, t) {
    this.tmp.fromArray(pose).decompose(this.p, this.q, this.sc);
    if (!this.pos) {
      this.pos = this.p.clone(); this.rot = this.q.clone(); this.t = t;
    } else {
      const dt = Math.max(1e-3, t - this.t);
      this.t = t;
      // faster motion → follow more closely (less lag); slow motion → smoother (less jitter)
      const speed = this.p.distanceTo(this.pos) / dt;                 // cm / s
      const a = 1 - Math.exp(-dt * (8 + speed * 0.6));
      this.pos.lerp(this.p, Math.min(1, a));
      const ang = this.rot.angleTo(this.q) / dt;                       // rad / s
      this.rot.slerp(this.q, Math.min(1, 1 - Math.exp(-dt * (10 + ang * 4))));
    }
    out.compose(this.pos, this.rot, this.sc);
  }
}

/**
 * Scales and places a user model on the canonical head.
 * top: bottom of the model sits on the top of the head (hats, hair)
 * eyes: centred on the eyes, in front of the face (glasses, masks)
 * head: centred on the whole head, slightly larger than it (helmets)
 * ref: as modelled around the Blender reference head (metres, y up, face towards +z), no auto fit
 * `fit` (optional) is the user's fine adjustment, applied around the model's centre.
 *
 * Hierarchy: g (reveal pop-in scale) > adj "fit" (anchor + offset, rotation, scale) > wrap (auto size) > model (centred)
 */
export function fitToHead(THREE, model, anchor, scale = 1, fit = null) {
  const obj = model.clone(true);
  if (anchor === "ref") {
    const wrap = new THREE.Group();
    wrap.add(obj);
    wrap.scale.setScalar(100 * scale);      // metres → canonical centimetres
    return wrapFit(THREE, wrap, [0, 0, 0], fit);
  }
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const width = { top: 17, eyes: 15, head: 21 }[anchor] * scale;
  const k = width / Math.max(size.x, 1e-6);
  const wrap = new THREE.Group();
  obj.position.sub(center);                 // centre at origin
  wrap.add(obj);
  wrap.scale.setScalar(k);
  const base = anchor === "top" ? [0, 9.6 + (size.y * k) / 2, -1.5]
    : anchor === "eyes" ? [0, 2.7, 4.5]
      : [0, 1.5, -2.2];
  return wrapFit(THREE, wrap, base, fit);
}

function wrapFit(THREE, wrap, base, fit) {
  const adj = new THREE.Group();
  adj.name = "fit";
  adj.userData.base = base;
  adj.add(wrap);
  applyFit(adj, fit);
  const g = new THREE.Group();
  g.add(adj);
  return g;
}

/**
 * Drops the Blender reference head (objects named TrackED_Reference*) when users
 * export it along with their accessory. A file with nothing else keeps it, so the
 * reference .glb itself can be previewed.
 */
export function stripReference(scene) {
  const ref = [];
  scene.traverse((o) => { if (o.name.startsWith("TrackED_Reference")) ref.push(o); });
  let other = false;
  scene.traverse((o) => { if (o.isMesh && !ref.some((r) => r === o || isInside(o, r))) other = true; });
  if (other) for (const o of ref) o.removeFromParent();
  return scene;
}
function isInside(o, root) { for (let p = o.parent; p; p = p.parent) if (p === root) return true; return false; }

const DEG = Math.PI / 180;
function applyFit(adj, fit) {
  const [bx, by, bz] = adj.userData.base;
  const f = fit || {};
  adj.position.set(bx + (f.x || 0), by + (f.y || 0), bz + (f.z || 0));
  adj.rotation.set((f.rx || 0) * DEG, (f.ry || 0) * DEG, (f.rz || 0) * DEG, "YXZ");
  adj.scale.setScalar(f.scale || 1);
}
