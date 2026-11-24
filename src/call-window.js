// "Call window": a separate, clean window that shows only the rendered picture
// (no buttons, no hold rings, no hints), to bring TrackED into a video call:
//  - share that window in Meet / Zoom / Teams, or
//  - capture it in OBS (Window Capture) and start OBS's virtual camera.
//
// The picture is copied into the window's own 2D canvas right after each draw
// (the WebGL drawing buffer isn't preserved, so the copy must happen then).
// While the call window is open, the main page keeps rendering even when it is
// hidden: a tiny worker ticks ~30 times a second, because a hidden page gets no
// video-frame or animation callbacks and its timers are throttled.

const TITLE = "TrackED call output";

/** Output size for a source canvas: at most `max` pixels on the long side, even numbers. */
export function outputSize(w, h, max = 1280) {
  const k = Math.min(1, max / Math.max(w, h, 1));
  return { width: Math.max(2, Math.round((w * k) / 2) * 2), height: Math.max(2, Math.round((h * k) / 2) * 2) };
}

export class CallWindow {
  /**
   * @param {HTMLCanvasElement} source  the rendered picture
   * @param {{onHiddenTick?: () => void, onClose?: () => void}} o
   */
  constructor(source, { onHiddenTick, onClose } = {}) {
    this.source = source;
    this.onHiddenTick = onHiddenTick;
    this.onClose = onClose;
    this.win = null;
    this.ctx = null;
    this.mirror = false;   // true view by default: what a normal webcam sends
    this.ticker = null;
  }

  get isOpen() { return !!this.win && !this.win.closed; }

  /** @returns {boolean} false when the browser blocked the window */
  open() {
    if (this.isOpen) { this.win.focus(); return true; }
    const w = window.open("", "tracked-call", "popup,width=960,height=540");
    if (!w) return false;
    const d = w.document;
    d.title = TITLE;
    d.body.replaceChildren();
    d.documentElement.style.cssText = "height:100%;background:#000";
    d.body.style.cssText = "margin:0;height:100%;background:#000;overflow:hidden;cursor:none";
    const c = d.createElement("canvas");
    c.style.cssText = "display:block;width:100%;height:100%;object-fit:contain";
    d.body.append(c);
    this.win = w;
    this.canvas = c;
    this.ctx = c.getContext("2d", { alpha: false });
    w.addEventListener("pagehide", () => this.#closed());
    this.#startTicker();
    return true;
  }

  close() {
    if (this.isOpen) this.win.close();
    this.#closed();
  }

  #closed() {
    if (!this.win) return;
    this.win = null;
    this.ctx = null;
    this.ticker?.terminate();
    this.ticker = null;
    this.onClose?.();
  }

  /**
   * Call right after each draw of the source canvas.
   * @param {boolean} selfie  the source is drawn mirrored (front camera)
   */
  push(selfie = true) {
    if (!this.win) return;
    if (this.win.closed) { this.#closed(); return; }
    const src = this.source, c = this.canvas;
    const { width, height } = outputSize(src.width, src.height);
    if (c.width !== width || c.height !== height) { c.width = width; c.height = height; }
    const g = this.ctx;
    // the app draws a selfie (mirrored) picture; a call wants the true view unless asked otherwise
    if (selfie && !this.mirror) g.setTransform(-1, 0, 0, 1, width, 0);
    else g.setTransform(1, 0, 0, 1, 0, 0);
    try { g.drawImage(src, 0, 0, width, height); } catch { /* source not ready yet */ }
  }

  #startTicker() {
    if (this.ticker || typeof Worker === "undefined") return;
    try {
      const url = URL.createObjectURL(new Blob(["setInterval(() => postMessage(0), 33);"], { type: "text/javascript" }));
      this.ticker = new Worker(url);
      URL.revokeObjectURL(url);
      this.ticker.onmessage = () => { if (document.hidden && this.isOpen) this.onHiddenTick?.(); };
    } catch (err) {
      console.warn("call window: no background ticker", err);
    }
  }
}
