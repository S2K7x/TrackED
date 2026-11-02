// Free-length loop recorder (pure). Records timestamped events while recording;
// on stop, the loop length is the recording length and the events replay forever.

export class Looper {
  constructor() { this.clear(); }

  clear() {
    this.state = "idle";      // idle | recording | playing
    this.events = [];          // {at: seconds from loop start, ev}
    this.length = 0;
    this.start = 0;
    this.cursor = 0;           // last loop position already played
  }

  record(t) {
    this.clear();
    this.state = "recording";
    this.start = t;
  }

  /** Adds an event while recording (ignored otherwise). */
  add(ev, t) {
    if (this.state === "recording") this.events.push({ at: t - this.start, ev });
  }

  /** Stops recording and starts playback. Too-short loops (< 0.25 s) are discarded. */
  play(t) {
    if (this.state !== "recording") return false;
    this.length = t - this.start;
    if (this.length < 0.25 || !this.events.length) { this.clear(); return false; }
    this.state = "playing";
    this.start = t;
    this.cursor = 0;
    return true;
  }

  /** Position in the loop, 0..1 (for the progress ring). */
  progress(t) {
    if (this.state === "recording") return 0;
    if (this.state !== "playing") return 0;
    return ((t - this.start) % this.length) / this.length;
  }

  /**
   * Events due between the previous call and now (handles wrap-around). After a
   * gap longer than the loop (hidden tab, stalled frame) it jumps to the present
   * instead of replaying the missed events in a burst.
   * @returns {any[]}
   */
  due(t) {
    if (this.state !== "playing") return [];
    const elapsed = t - this.start;
    const from = this.cursor, to = elapsed;
    this.cursor = to;
    if (to - from > this.length) return [];
    const out = [];
    const pass = (a, b, offset) => {
      for (const e of this.events) if (e.at + offset > a && e.at + offset <= b) out.push(e.ev);
    };
    const k0 = Math.floor(from / this.length), k1 = Math.floor(to / this.length);
    for (let k = k0; k <= k1; k++) pass(from, to, k * this.length);
    return out;
  }
}
