// Photo + video capture of the rendered canvas.
// Photo: the WebGL drawing buffer is not preserved (faster), so the snapshot is
// taken synchronously right after a draw call (toBlob snapshots immediately).
// Video: canvas.captureStream() + MediaRecorder, MP4 when supported (Safari,
// recent Chrome) so it can be posted directly, WebM otherwise.

const MIME_CANDIDATES = [
  "video/mp4;codecs=avc1.42E01E",
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

export function pickMime(isSupported = (t) => globalThis.MediaRecorder?.isTypeSupported?.(t)) {
  return MIME_CANDIDATES.find((t) => isSupported(t)) || "";
}

export class Capture {
  constructor(canvas, notify = () => {}) {
    this.canvas = canvas;
    this.notify = notify;
    this.wantPhoto = false;
    this.recorder = null;
  }

  photo() {
    this.wantPhoto = true;
  }

  /** Call right after each draw. */
  afterDraw() {
    if (!this.wantPhoto) return;
    this.wantPhoto = false;
    try {
      this.canvas.toBlob((blob) => {
        if (blob) save(blob, `tracked-${stamp()}.jpg`, this.notify).catch((err) => this.#fail("save the photo", err));
        else this.notify("Couldn't take the photo. Please try again.");
      }, "image/jpeg", 0.92);
    } catch (err) {
      this.#fail("take the photo", err);
    }
  }

  #fail(what, err) {
    console.error(err);
    this.notify(`Couldn't ${what}. ${err?.name === "QuotaExceededError" ? "Your device storage is full." : "Please try again."}`);
  }

  /** Stops a running recording (page hidden, camera lost…); the clip is saved. */
  stopRecording() {
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
  }

  /** @returns {boolean} recording state after the toggle */
  toggleRecording() {
    if (this.recorder) {
      this.recorder.stop();
      return false;
    }
    if (!this.canvas.captureStream || typeof MediaRecorder === "undefined") {
      this.notify("Video recording is not supported in this browser");
      return false;
    }
    const mimeType = pickMime();
    let stream, rec;
    try {
      stream = this.canvas.captureStream(30);
      rec = new MediaRecorder(stream, { mimeType: mimeType || undefined, videoBitsPerSecond: 6_000_000 });
    } catch (err) {
      stream?.getTracks().forEach((t) => t.stop());
      this.#fail("start recording", err);
      return false;
    }
    rec.onerror = (e) => {
      console.error("recorder:", e.error || e);
      this.notify("Recording failed. What was captured so far will be saved.");
      if (rec.state !== "inactive") rec.stop();
    };
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      this.recorder = null;
      const type = rec.mimeType || mimeType || "video/webm";
      const ext = type.includes("mp4") ? "mp4" : "webm";
      const blob = new Blob(chunks, { type });
      if (!blob.size) { this.notify("The recording is empty. Record for at least a second."); return; }
      save(blob, `tracked-${stamp()}.${ext}`, this.notify).catch((err) => this.#fail("save the video", err));
    };
    try {
      rec.start(1000);
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      this.#fail("start recording", err);
      return false;
    }
    this.recorder = rec;
    return true;
  }
}

function stamp() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

/** Share sheet on mobile (save to gallery / post), download elsewhere. */
async function save(blob, name, notify) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (err) {
      if (err?.name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  notify(`Saved: ${name}`);
}
