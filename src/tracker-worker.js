// Module worker: runs the MediaPipe models off the main thread so rendering
// never stalls while a model is busy.
import { VisionPipeline } from "./vision.js";

const vision = new VisionPipeline();
vision.onLoading = (count) => self.postMessage({ type: "loading", count });

// surface async failures instead of dying silently (the main thread decides how to recover)
self.addEventListener("unhandledrejection", (e) => {
  e.preventDefault();
  self.postMessage({ type: "error", message: `worker: ${e.reason?.message || e.reason}` });
});

self.onmessage = async ({ data }) => {
  if (data.type === "init") {
    try {
      await vision.init(data.delegate);
      self.postMessage({ type: "ready" });
    } catch (err) {
      self.postMessage({ type: "error", message: String(err?.message || err) });
    }
    return;
  }

  if (data.type === "warm") {
    vision.warm(data.list);
    return;
  }

  if (data.type === "analyze") {
    let mesh = null, error = null;
    try { mesh = await vision.analyze(data.bitmap); } catch (err) { error = String(err?.message || err); }
    data.bitmap.close();
    self.postMessage({ type: "analyzed", id: data.id, mesh, error }, mesh ? [mesh.buffer] : []);
    return;
  }

  if (data.type === "frame") {
    const { bitmap, timestamp, want } = data;
    let result = { hands: [] };
    try {
      result = vision.process(bitmap, timestamp, want);
    } catch (err) {
      self.postMessage({ type: "error", message: String(err?.message || err) });
    } finally {
      bitmap.close();
    }
    const transfer = result.mask ? [result.mask.data.buffer] : [];
    for (const f of result.faces || []) {
      if (f.mesh) transfer.push(f.mesh.buffer);
      if (f.pose) transfer.push(f.pose.buffer);
    }
    self.postMessage({ type: "result", result, timestamp }, transfer);
  }
};
