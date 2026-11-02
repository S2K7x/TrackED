// Vision front-end (hands, faces, segmentation). Prefers a module Web Worker
// (detection off the main thread) and falls back to the main thread if workers
// / OffscreenCanvas don't work.
//
// Back-pressure: at most one frame is in flight; frames arriving meanwhile are
// dropped instead of queued, so latency never piles up.
//
// Robustness:
//  - timestamps passed to MediaPipe are strictly increasing (VIDEO mode requires it)
//  - a watchdog frees the pipeline if a frame never comes back (worker stall)
//  - a crashed / stalled worker is restarted; after repeated failures we fall
//    back to the main thread for the rest of the session
//  - createImageBitmap resize options missing (older Safari) → OffscreenCanvas downscale

const FRAME_TIMEOUT_MS = 6000;   // a frame taking longer than this is considered lost (unless a model is loading)
const MAX_RESTARTS = 2;          // worker restarts before giving up on the worker

export class HandTracker {
  /** @param {{detectWidth?: number}} opts  frames are downscaled to this size (long side) */
  constructor({ detectWidth = 480 } = {}) {
    this.detectWidth = detectWidth;
    this.busy = false;
    this.busySince = 0;
    this.lastTs = 0;
    this.restarts = 0;
    this.onResult = () => {};
    this.onStatus = () => {};    // (message) => void, for user-facing notices
    this.mode = null;
    this.pending = new Map();
    this.warmed = new Set();
    this.resizeOK = true;        // createImageBitmap supports resize options
    this.modelsLoading = 0;      // the worker is compiling / loading a model: slow frames are expected
  }

  async init() {
    try {
      await this.#initWorker();
      this.mode = "worker";
    } catch (err) {
      console.warn("Worker tracking unavailable, using main thread:", err);
      this.#killWorker();
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
      const timeout = setTimeout(() => reject(new Error("worker init timeout")), 45000);
      worker.onerror = (e) => { clearTimeout(timeout); reject(e.error || new Error(e.message || "worker error")); };
      worker.onmessage = ({ data }) => {
        if (data.type === "ready") {
          clearTimeout(timeout);
          worker.onmessage = ({ data }) => this.#onWorkerMessage(data);
          // a crash after init (e.g. GPU process reset): restart the worker
          worker.onerror = (e) => { e.preventDefault?.(); this.#recover(`worker crashed: ${e.message || "unknown error"}`); };
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
    for (const list of this.warmed) this.vision.warm([list]);
  }

  #killWorker() {
    try { this.worker?.terminate(); } catch { /* already gone */ }
    this.worker = null;
    for (const p of this.pending.values()) p.reject(new Error("tracker restarted"));
    this.pending.clear();
  }

  /** Restarts the worker (or switches to the main thread) after a crash or a stall. */
  async #recover(reason) {
    if (this.recovering) return;
    this.recovering = true;
    console.warn("tracker:", reason);
    this.#killWorker();
    this.busy = false;
    try {
      if (this.restarts++ < MAX_RESTARTS) {
        this.onStatus("Restarting hand tracking…");
        await this.#initWorker();
        this.mode = "worker";
        for (const list of this.warmed) this.worker.postMessage({ type: "warm", list: [list] });
      } else {
        this.onStatus("Switching to compatibility mode…");
        await this.#initMain();
        this.mode = "main";
      }
      this.onStatus("");
    } catch (err) {
      console.error("tracker recovery failed:", err);
      this.mode = null;
      this.onStatus("Hand tracking stopped. Reload the page to try again.");
    } finally {
      this.recovering = false;
    }
  }

  /** Loads models in the background before they're needed. */
  warm(list) {
    list.forEach((x) => this.warmed.add(x));
    if (this.mode === "worker") this.worker?.postMessage({ type: "warm", list });
    else this.vision?.warm(list);
  }

  /**
   * Detects the face in a still image (for face swap).
   * @param {ImageBitmap} bitmap  consumed (transferred / closed)
   * @returns {Promise<Float32Array|null>}
   */
  analyze(bitmap) {
    if (this.mode !== "worker") {
      if (!this.vision) { bitmap.close(); return Promise.reject(new Error("tracking is not running")); }
      return this.vision.analyze(bitmap).finally(() => bitmap.close());
    }
    const id = (this.nextId = (this.nextId || 0) + 1);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("face analysis timed out")); }, 60000);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.worker.postMessage({ type: "analyze", id, bitmap }, [bitmap]);
    });
  }

  #onWorkerMessage(data) {
    if (data.type === "analyzed") {
      const p = this.pending.get(data.id);
      this.pending.delete(data.id);
      if (data.error) p?.reject(new Error(data.error));
      else p?.resolve(data.mesh);
      return;
    }
    if (data.type === "loading") {
      this.modelsLoading = data.count;
      if (!data.count) this.busySince = performance.now(); // restart the watchdog clock after a load
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

  /** Strictly increasing timestamps (ms): MediaPipe VIDEO mode rejects repeated / older ones. */
  #nextTimestamp(t) {
    this.lastTs = Math.max(t, this.lastTs + 1);
    return this.lastTs;
  }

  async #grab(video) {
    const scale = Math.min(1, this.detectWidth / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));
    if (this.resizeOK) {
      try {
        return await createImageBitmap(video, { resizeWidth: width, resizeHeight: height, resizeQuality: "low" });
      } catch (err) {
        if (!(err instanceof TypeError)) throw err;
        this.resizeOK = false;        // resize options unsupported: downscale ourselves from now on
      }
    }
    if (typeof OffscreenCanvas !== "undefined") {
      this.scratch ??= new OffscreenCanvas(width, height);
      if (this.scratch.width !== width || this.scratch.height !== height) { this.scratch.width = width; this.scratch.height = height; }
      this.scratch.getContext("2d").drawImage(video, 0, 0, width, height);
      return createImageBitmap(this.scratch);
    }
    return createImageBitmap(video);
  }

  /**
   * Submits a video frame; silently drops it if the previous one is still being processed.
   * @param {{face?: boolean, mesh?: boolean, pose?: boolean, seg?: boolean}} want  extra models to run on this frame
   */
  async submit(video, timestamp, want = {}) {
    if (!this.mode || this.recovering || !video.videoWidth || video.readyState < 2) return;
    if (this.busy) {
      // watchdog: a frame that never came back would block tracking forever
      if (!this.modelsLoading && performance.now() - this.busySince > FRAME_TIMEOUT_MS) {
        if (this.mode === "worker") this.#recover("frame timed out (worker stalled)");
        else this.busy = false;
      }
      return;
    }
    this.busy = true;
    this.busySince = performance.now();
    const ts = this.#nextTimestamp(timestamp);
    if (this.mode === "worker") {
      try {
        const bitmap = await this.#grab(video);
        if (!this.worker) { bitmap.close(); this.busy = false; return; }
        this.worker.postMessage({ type: "frame", bitmap, timestamp: ts, want }, [bitmap]);
      } catch (err) {
        this.busy = false;
        console.warn("frame capture failed:", err);
      }
    } else {
      try {
        this.onResult(this.vision.process(video, ts, want), ts);
      } catch (err) {
        console.warn("tracking failed on this frame:", err);
      } finally {
        this.busy = false;
      }
    }
  }
}
