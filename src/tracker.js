// Vision front-end (hands, faces, segmentation). Prefers a module Web Worker (detection off the main
// thread); falls back to the main thread if workers/OffscreenCanvas don't work.
// Back-pressure: at most one frame is in flight; frames arriving meanwhile are
// dropped instead of queued, so latency never piles up.

export class HandTracker {
  /** @param {{detectWidth?: number}} opts  frames are downscaled to this width before detection */
  constructor({ detectWidth = 480 } = {}) {
    this.detectWidth = detectWidth;
    this.busy = false;
    this.onResult = () => {};
    this.mode = null;
  }

  async init() {
    try {
      await this.#initWorker();
      this.mode = "worker";
    } catch (err) {
      console.warn("Worker tracking unavailable, using main thread:", err);
      this.worker?.terminate();
      this.worker = null;
      await this.#initMain();
      this.mode = "main";
    }
    return this.mode;
  }

  #initWorker() {
    return new Promise((resolve, reject) => {
      if (typeof Worker === "undefined" || typeof createImageBitmap === "undefined") {
        reject(new Error("no worker support"));
        return;
      }
      const worker = new Worker(new URL("./tracker-worker.js", import.meta.url), { type: "module" });
      this.worker = worker;
      const timeout = setTimeout(() => reject(new Error("worker init timeout")), 30000);
      worker.onerror = (e) => { clearTimeout(timeout); reject(e.error || new Error(e.message || "worker error")); };
      worker.onmessage = ({ data }) => {
        if (data.type === "ready") {
          clearTimeout(timeout);
          worker.onmessage = ({ data }) => this.#onWorkerMessage(data);
          resolve();
        } else if (data.type === "error") {
          clearTimeout(timeout);
          reject(new Error(data.message));
        }
      };
      worker.postMessage({ type: "init", delegate: "GPU" });
    });
  }

  async #initMain() {
    const { VisionPipeline } = await import("./vision.js");
    this.vision = new VisionPipeline();
    await this.vision.init("GPU");
  }

  /** Loads models in the background before they're needed. */
  warm(list) {
    if (this.mode === "worker") this.worker.postMessage({ type: "warm", list });
    else this.vision?.warm(list);
  }

  /**
   * Detects the face in a still image (for face swap).
   * @param {ImageBitmap} bitmap  consumed (transferred / closed)
   * @returns {Promise<Float32Array|null>}
   */
  analyze(bitmap) {
    if (this.mode !== "worker") return this.vision.analyze(bitmap).finally(() => bitmap.close());
    const id = (this.nextId = (this.nextId || 0) + 1);
    this.pending ??= new Map();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type: "analyze", id, bitmap }, [bitmap]);
    });
  }

  #onWorkerMessage(data) {
    if (data.type === "analyzed") {
      const p = this.pending?.get(data.id);
      this.pending?.delete(data.id);
      if (data.error) p?.reject(new Error(data.error));
      else p?.resolve(data.mesh);
      return;
    }
    if (data.type === "result") {
      this.busy = false;
      this.onResult(data.result, data.timestamp);
    } else if (data.type === "error") {
      this.busy = false;
      console.warn("tracker:", data.message);
    }
  }

  /**
   * Submits a video frame; silently drops it if the previous one is still being processed.
   * @param {{face?: boolean, mesh?: boolean, seg?: boolean}} want  extra models to run on this frame
   */
  async submit(video, timestamp, want = {}) {
    if (this.busy || !video.videoWidth) return;
    this.busy = true;
    if (this.mode === "worker") {
      try {
        const scale = Math.min(1, this.detectWidth / Math.max(video.videoWidth, video.videoHeight));
        const bitmap = await createImageBitmap(video, {
          resizeWidth: Math.round(video.videoWidth * scale),
          resizeHeight: Math.round(video.videoHeight * scale),
          resizeQuality: "low",
        });
        this.worker.postMessage({ type: "frame", bitmap, timestamp, want }, [bitmap]);
      } catch (err) {
        this.busy = false;
        console.warn("frame capture failed:", err);
      }
    } else {
      try {
        this.onResult(this.vision.process(video, timestamp, want), timestamp);
      } finally {
        this.busy = false;
      }
    }
  }
}
