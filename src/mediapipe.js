// Single place that pins the MediaPipe version (shared by main thread and worker).
export const MP_VERSION = "1.1.1";
export const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
export {
  FilesetResolver,
  HandLandmarker,
  FaceLandmarker,
  ImageSegmenter,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/vision_bundle.mjs";
