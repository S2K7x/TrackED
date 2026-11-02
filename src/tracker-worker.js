// Module worker: runs MediaPipe Hand Landmarker off the main thread so
// rendering never stalls while the model is busy.
import { FilesetResolver, HandLandmarker } from "./mediapipe.js";
import { createLandmarker } from "./landmarker.js";

let landmarker = null;

self.onmessage = async ({ data }) => {
  if (data.type === "init") {
    try {
      landmarker = await createLandmarker(FilesetResolver, HandLandmarker, data.delegate);
      self.postMessage({ type: "ready" });
    } catch (err) {
      self.postMessage({ type: "error", message: String(err?.message || err) });
    }
    return;
  }

  if (data.type === "frame") {
    const { bitmap, timestamp } = data;
    let hands = [];
    try {
      const res = landmarker.detectForVideo(bitmap, timestamp);
      // keep only x/y: smaller message, nothing else is needed
      hands = (res.landmarks || []).map(lm => lm.map(p => ({ x: p.x, y: p.y })));
    } catch (err) {
      self.postMessage({ type: "error", message: String(err?.message || err) });
    } finally {
      bitmap.close();
    }
    self.postMessage({ type: "result", hands, timestamp });
  }
};
