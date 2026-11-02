// 3D accessories anchored to the head, rendered with three.js into the SAME
// WebGL canvas as the 2D effects (so photos and recordings include them).
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
  constructor(canvas, gl) {
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
    this.stencil = false;
    this.poseSmooth = Array.from({ length: MAX_FACES }, () => new PoseSmoother());
  }

  /** Built-in accessory by name (null = none). */
  setAccessory(name, color) {
    this.#setTemplate(name ? buildAccessory(THREE, name, new THREE.Color(color)) : null);
  }

  /**
   * Loads a user .glb / .gltf and fits it to the head.
   * @param {ArrayBuffer} data
   * @param {"top"|"eyes"|"head"} anchor  hat, glasses/face, or helmet
   */
  async loadModel(data, anchor = "top", scale = 1) {
    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/");
    loader.setDRACOLoader(draco);
    const gltf = await loader.parseAsync(data, "");
    draco.dispose();
    this.userModel = gltf.scene;
    this.fitUserModel(anchor, scale);
  }

  /** Re-fits the loaded model (anchor / size changed). */
  fitUserModel(anchor = "top", scale = 1) {
    if (!this.userModel) return;
    this.#setTemplate(fitToHead(THREE, this.userModel, anchor, scale));
  }

  #setTemplate(obj) {
    for (const head of this.heads) {
      if (head.userData.acc) { head.remove(head.userData.acc); head.userData.acc = null; }
    }
    this.template = obj;
    if (!obj) return;
    this.heads.forEach((head, i) => {
      const acc = i === 0 ? obj : obj.clone(true);
      head.add(acc);
      head.userData.acc = acc;
    });
    this.#applyStencil();
  }

  #applyStencil() {
    // clip to the hand frame: only draw where the frame pass wrote stencil = 1
    this.template?.parent && this.heads.forEach((h) => h.traverse((o) => {
      for (const m of [].concat(o.material || [])) {
        m.stencilWrite = this.stencil;
        m.stencilRef = 1;
        m.stencilFunc = THREE.EqualStencilFunc;
        m.stencilZPass = THREE.KeepStencilOp;
        m.needsUpdate = true;
      }
    }));
  }

  get active() { return !!this.template; }

  /**
   * @param {{pose?: Float32Array, on?: boolean}[]} faces
   * @param {{width: number, height: number, mirror: boolean, inFrame: boolean, time: number}} s
   */
  render(faces, s) {
    if (!this.template) return;
    if (s.inFrame !== this.stencil) { this.stencil = s.inFrame; this.#applyStencil(); }
    this.camera.aspect = s.width / s.height;
    this.camera.updateProjectionMatrix();
    this.root.scale.x = s.mirror ? -1 : 1;
    let any = false;
    this.heads.forEach((head, i) => {
      const f = faces[i];
      const show = !!(f && f.pose && f.on !== false);
      head.visible = show;
      if (!show) { this.poseSmooth[i].reset(); return; }
      this.poseSmooth[i].apply(f.pose, head.matrix, s.time);
      head.matrixWorldNeedsUpdate = true;
      any = true;
    });
    if (!any) return;
    this.template.userData.animate?.(s.time);
    this.heads.forEach((h) => h.userData.acc?.userData.animate?.(s.time));

    const r = this.r;
    r.resetState();                 // the 2D renderer changed GL state behind three's back
    r.setViewport(0, 0, s.width, s.height);
    r.clearDepth();
    r.render(this.scene, this.camera);
  }

  /** Projects a canonical-space point with a pose (used to calibrate / test). */
  project(pose, x, y, z) {
    const m = new THREE.Matrix4().fromArray(pose);
    const p = new THREE.Vector3(x, y, z).applyMatrix4(m).project(this.camera);
    return { x: (p.x + 1) / 2, y: (1 - p.y) / 2 };
  }
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
 */
export function fitToHead(THREE, model, anchor, scale = 1) {
  const obj = model.clone(true);
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const width = { top: 17, eyes: 15, head: 21 }[anchor] * scale;
  const k = width / Math.max(size.x, 1e-6);
  const wrap = new THREE.Group();
  obj.position.sub(center);                 // centre at origin
  wrap.add(obj);
  wrap.scale.setScalar(k);
  if (anchor === "top") wrap.position.set(0, 9.6 + (size.y * k) / 2, -1.5);
  else if (anchor === "eyes") wrap.position.set(0, 2.7, 4.5);
  else wrap.position.set(0, 1.5, -2.2);
  const g = new THREE.Group();
  g.add(wrap);
  return g;
}
