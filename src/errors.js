// Error handling helpers (pure, unit-tested).

/**
 * Maps a getUserMedia failure to a user-facing message and a recovery strategy.
 * Matches both the standard DOMException names and the legacy Chrome ones
 * (PermissionDeniedError, DevicesNotFoundError, TrackStartError, ConstraintNotSatisfiedError).
 * @returns {{title: string, hint: string, retry: boolean, relax: boolean}}
 *   retry: offer a "Try again" button; relax: retry automatically with simpler constraints
 */
export function describeCameraError(err) {
  const name = err?.name || "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return { title: "Camera access was blocked", hint: "Allow the camera for this site in your browser settings (the camera icon in the address bar), then try again.", retry: true, relax: false };
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return { title: "No camera found", hint: "Connect a camera, or open TrackED on a phone or laptop with one.", retry: true, relax: false };
  }
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") {
    return { title: "The camera is busy", hint: "Another app (a video call, the camera app) is using it. Close it and try again.", retry: true, relax: true };
  }
  if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
    return { title: "This camera doesn't support the requested mode", hint: "Retrying with default settings…", retry: true, relax: true };
  }
  if (name === "NotSupportedError") {
    return { title: "This browser can't use the camera here", hint: "Try a recent Chrome, Safari, Edge or Firefox, and allow camera access when asked.", retry: true, relax: false };
  }
  if (name === "SecurityError" || name === "TypeError") {
    return { title: "The camera needs a secure page", hint: "Open TrackED over https:// (or localhost).", retry: false, relax: false };
  }
  return { title: "Couldn't start the camera", hint: String(err?.message || err || "Unknown error"), retry: true, relax: true };
}

/**
 * Camera constraint ladder: from the ideal request down to "any camera".
 * Each step drops what most often fails (exact resolution, frame rate, facing mode).
 */
export function constraintLadder({ facing, width, height }) {
  return [
    { facingMode: facing, width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: 30 } },
    { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 } },
    { facingMode: facing },
    true,
  ];
}

export const LIMITS = {
  image: 25 * 1024 * 1024,   // 25 MB
  model: 60 * 1024 * 1024,   // 60 MB
};

/**
 * Validates an uploaded file before decoding it.
 * @param {{name?: string, type?: string, size: number}} file
 * @param {"image"|"model"} kind
 * @returns {string|null} error message, or null when acceptable
 */
export function checkUpload(file, kind) {
  if (!file) return "No file selected.";
  if (!file.size) return "That file is empty.";
  const mb = (n) => `${Math.round(n / 1024 / 1024)} MB`;
  if (kind === "image") {
    if (file.type && !file.type.startsWith("image/")) return "Please pick an image (PNG, JPG, WebP…).";
    if (file.size > LIMITS.image) return `That image is too large (max ${mb(LIMITS.image)}).`;
  } else if (kind === "model") {
    const name = (file.name || "").toLowerCase();
    if (!name.endsWith(".glb") && !name.endsWith(".gltf")) return "Please pick a .glb 3D model.";
    if (file.size > LIMITS.model) return `That model is too large (max ${mb(LIMITS.model)}).`;
  }
  return null;
}

/** Size to decode an image at so it fits the GPU's max texture size (keeps aspect). */
export function fitTextureSize(w, h, max) {
  const k = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.floor(w * k)), height: Math.max(1, Math.floor(h * k)), scaled: k < 1 };
}

/**
 * Retries an async operation with exponential backoff (network hiccups while
 * downloading models). Gives up immediately on errors marked non-retryable.
 */
export async function withRetry(fn, { attempts = 3, baseMs = 800, retryable = () => true, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn(i);
    } catch (err) {
      last = err;
      if (i === attempts - 1 || !retryable(err)) break;
      await sleep(baseMs * 2 ** i);
    }
  }
  throw last;
}

/** Network-ish failures worth retrying (fetch failures, aborted downloads, 5xx). */
export function isNetworkError(err) {
  const msg = String(err?.message || err || "");
  return err?.name === "TypeError" || /fetch|network|load|download|timeout|5\d\d/i.test(msg);
}

/**
 * Counts consecutive failures; trips after `limit` in a row, resets on success.
 * Used to stop a broken frame loop from spinning on the same exception.
 */
export class FailureBudget {
  constructor(limit = 30) { this.limit = limit; this.count = 0; }
  ok() { this.count = 0; }
  /** @returns {boolean} true when the budget is exhausted */
  fail() { return ++this.count >= this.limit; }
}
