// Vision pipeline shared by the worker and the main-thread fallback.
// Hands always run; face mesh and person segmentation are loaded lazily the
// first time an effect needs them, and only run on frames that ask for them.
import { FilesetResolver, HandLandmarker, FaceLandmarker, ImageSegmenter, MP_BASE } from "./mediapipe.js";
import { summarizeFace } from "./faces.js";

const MODELS = {
  hand: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
  face: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  // 6 classes: background, hair, body-skin, face-skin, clothes, others
  seg: "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite",
};

const MAX_FACES = 4;

/**
 * In a module worker MediaPipe loads its WASM loader with `import()`. ES modules
 * are cached, so the loader only runs once and only the FIRST task finds
 * `self.ModuleFactory` ("ModuleFactory not set." for the next ones). MediaPipe
 * calls `self.import` when it exists: we import each loader once and hand the
 * same (reusable) Emscripten factory back to every later task.
 */
function installModuleFactoryCache() {
  if (self.import) return;
  const factories = new Map();
  self.import = async (url) => {
    if (!factories.has(url)) {
      await import(url);
      factories.set(url, self.ModuleFactory);
    }
    self.ModuleFactory = factories.get(url);
  };
}

export class VisionPipeline {
  constructor() {
    this.fileset = null;
    this.delegate = "GPU";
    this.hand = null;
    this.face = null; // Promise while loading, then the task
    this.seg = null;
    this.faceTask = null;
    this.segTask = null;
    this.stillFace = null; // IMAGE-mode face landmarker for uploaded photos
  }

  async init(delegate = "GPU") {
    const inWorker = typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope;
    if (inWorker) installModuleFactoryCache();
    this.fileset = await FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`, inWorker);
    this.delegate = delegate;
    this.hand = await this.#create(HandLandmarker, {
      baseOptions: { modelAssetPath: MODELS.hand },
      runningMode: "VIDEO",
      numHands: 2,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  }

  /** Creates a task on the preferred delegate, falling back to CPU. */
  async #create(Task, options) {
    try {
      return await Task.createFromOptions(this.fileset, {
        ...options, baseOptions: { ...options.baseOptions, delegate: this.delegate },
      });
    } catch (err) {
      if (this.delegate === "CPU") throw err;
      console.warn(`${Task.name}: GPU delegate unavailable, using CPU`, err);
      return Task.createFromOptions(this.fileset, {
        ...options, baseOptions: { ...options.baseOptions, delegate: "CPU" },
      });
    }
  }

  #ensureFace() {
    this.face ??= this.#create(FaceLandmarker, {
      baseOptions: { modelAssetPath: MODELS.face },
      runningMode: "VIDEO",
      numFaces: MAX_FACES,
      minFaceDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputFacialTransformationMatrixes: true, // head pose for 3D accessories
    }).then((t) => (this.faceTask = t), (err) => console.warn("face model failed to load:", err));
  }

  #ensureSeg() {
    this.seg ??= this.#create(ImageSegmenter, {
      baseOptions: { modelAssetPath: MODELS.seg },
      runningMode: "VIDEO",
      outputCategoryMask: true,
      outputConfidenceMasks: false,
    }).then((t) => (this.segTask = t), (err) => console.warn("segmentation model failed to load:", err));
  }

  /**
   * @param {TexImageSource} image
   * @param {number} ts  strictly increasing timestamp (ms)
   * @param {{face?: boolean, mesh?: boolean, pose?: boolean, seg?: boolean}} want
   *   mesh = also return the 468-point mesh, pose = the 4×4 head pose (canonical face → camera)
   * @returns {{hands: object[][], faces?: object[], mask?: {data: Uint8Array, width: number, height: number}}}
   */
  process(image, ts, want = {}) {
    const out = {};
    const res = this.hand.detectForVideo(image, ts);
    out.hands = (res.landmarks || []).map((lm) => lm.map((p) => ({ x: p.x, y: p.y })));

    const aspect = (image.width || image.videoWidth) / (image.height || image.videoHeight) || 1;
    if (want.face) {
      this.#ensureFace();
      if (this.faceTask) {
        const fr = this.faceTask.detectForVideo(image, ts);
        out.faces = (fr.faceLandmarks || []).map((lm, i) => {
          const f = summarizeFace(lm, aspect);
          if (want.mesh) f.mesh = meshXY(lm);
          const m = fr.facialTransformationMatrixes?.[i];
          if (want.pose && m) f.pose = Float32Array.from(m.data);
          return f;
        });
      }
    }
    if (want.seg) {
      this.#ensureSeg();
      if (this.segTask) {
        const sr = this.segTask.segmentForVideo(image, ts);
        const m = sr.categoryMask;
        if (m) out.mask = { data: m.getAsUint8Array().slice(), width: m.width, height: m.height };
        sr.close();
      }
    }
    return out;
  }

  /**
   * Finds the main face in a still image (face-swap source).
   * @returns {Promise<Float32Array|null>} 468 (x, y) pairs in [0, 1], or null when no face is found
   */
  async analyze(image) {
    this.stillFace ??= await this.#create(FaceLandmarker, {
      baseOptions: { modelAssetPath: MODELS.face },
      runningMode: "IMAGE",
      numFaces: 1,
      minFaceDetectionConfidence: 0.3,
    });
    const r = this.stillFace.detect(image);
    return r.faceLandmarks?.[0] ? meshXY(r.faceLandmarks[0]) : null;
  }
}

/** First 468 landmarks (the mesh; irises excluded) as a flat x, y array. */
function meshXY(lm) {
  const a = new Float32Array(468 * 2);
  for (let i = 0; i < 468; i++) { a[i * 2] = lm[i].x; a[i * 2 + 1] = lm[i].y; }
  return a;
}
