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
    this.canvas.toBlob((blob) => blob && save(blob, `tracked-${stamp()}.jpg`, this.notify), "image/jpeg", 0.92);
  }

  /** @returns {boolean} recording state after the toggle */
  toggleRecording() {
    if (this.recorder) {
      this.recorder.stop();
      return false;
    }
    if (!this.canvas.captureStream || typeof MediaRecorder === "undefined") {
      this.notify("Enregistrement vidéo non supporté sur ce navigateur");
      return false;
    }
    const mimeType = pickMime();
    const stream = this.canvas.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: mimeType || undefined, videoBitsPerSecond: 6_000_000 });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      this.recorder = null;
      const type = rec.mimeType || mimeType || "video/webm";
      const ext = type.includes("mp4") ? "mp4" : "webm";
      save(new Blob(chunks, { type }), `tracked-${stamp()}.${ext}`, this.notify);
    };
    rec.start(1000);
    this.recorder = rec;
    this.notify("Enregistrement…");
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
  notify(`Enregistré : ${name}`);
}
