// Hand tracking front-end. Prefers a module Web Worker (detection off the main
// thread); falls back to the main thread if workers/OffscreenCanvas don't work.
// Back-pressure: at most one frame is in flight; frames arriving meanwhile are
// dropped instead of queued, so latency never piles up.

const DETECT_WIDTH = 480; // the model runs at ~224px internally; no need to ship 720p frames

export class HandTracker {
  constructor() {
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
    const [{ FilesetResolver, HandLandmarker }, { createLandmarker }] = await Promise.all([
      import("./mediapipe.js"),
      import("./landmarker.js"),
    ]);
    this.landmarker = await createLandmarker(FilesetResolver, HandLandmarker, "GPU");
  }

  #onWorkerMessage(data) {
    if (data.type === "result") {
      this.busy = false;
      this.onResult(data.hands, data.timestamp);
    } else if (data.type === "error") {
      this.busy = false;
      console.warn("tracker:", data.message);
    }
  }

  /** Submits a video frame; silently drops it if the previous one is still being processed. */
  async submit(video, timestamp) {
    if (this.busy || !video.videoWidth) return;
    this.busy = true;
    if (this.mode === "worker") {
      try {
        const scale = Math.min(1, DETECT_WIDTH / video.videoWidth);
        const bitmap = await createImageBitmap(video, {
          resizeWidth: Math.round(video.videoWidth * scale),
          resizeHeight: Math.round(video.videoHeight * scale),
          resizeQuality: "low",
        });
        this.worker.postMessage({ type: "frame", bitmap, timestamp }, [bitmap]);
      } catch (err) {
        this.busy = false;
        console.warn("frame capture failed:", err);
      }
    } else {
      try {
        const res = this.landmarker.detectForVideo(video, timestamp);
        this.onResult(res.landmarks || [], timestamp);
      } finally {
        this.busy = false;
      }
    }
  }
}
