// Module worker: runs the MediaPipe models off the main thread so rendering
// never stalls while a model is busy.
import { VisionPipeline } from "./vision.js";

const vision = new VisionPipeline();

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
    self.postMessage({ type: "result", result, timestamp }, transfer);
  }
};
