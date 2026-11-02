import { MP_BASE } from "./mediapipe.js";

export const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

/**
 * Creates a VIDEO-mode hand landmarker. In VIDEO mode MediaPipe tracks hands from
 * the previous frame's landmarks and only re-runs the (costlier) palm detector
 * when tracking is lost, so a high tracking confidence keeps things fast.
 */
export async function createLandmarker(FilesetResolver, HandLandmarker, delegate = "GPU") {
  const inWorker = typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope;
  const fileset = await FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`, inWorker);
  const options = (d) => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate: d },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.6,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  try {
    return await HandLandmarker.createFromOptions(fileset, options(delegate));
  } catch (err) {
    if (delegate === "CPU") throw err;
    console.warn("GPU delegate unavailable, falling back to CPU:", err);
    return HandLandmarker.createFromOptions(fileset, options("CPU"));
  }
}
