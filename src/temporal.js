// Temporal stabilisation of the category mask (segmentation flicker).
//
// Per-frame segmentation flickers at boundaries: a pixel flips class for a
// single frame and flips back. Classical real-time video segmentation keeps
// labels stable with change detection instead of costly motion estimation;
// here a 3-frame temporal vote does the same in one cheap pass: a pixel that
// differs from BOTH previous raw frames, while those two agree, is treated as
// a one-frame flip and keeps the previous class. A real change survives from
// the second frame on (the history holds raw masks, so it is never "locked").

export class MaskStabilizer {
  constructor() { this.prev = null; this.prev2 = null; }

  reset() { this.prev = this.prev2 = null; }

  /**
   * @param {Uint8Array} cur  raw category mask; corrected in place and returned
   */
  apply(cur) {
    const n = cur.length;
    if (this.prev && this.prev.length !== n) this.reset();
    const p1 = this.prev, p2 = this.prev2;
    if (p1 && p2) {
      // one pass: vote with the two previous RAW frames, then recycle p2 to store this raw frame
      for (let i = 0; i < n; i++) {
        const r = cur[i], a = p1[i];
        if (r !== a && a === p2[i]) cur[i] = a;
        p2[i] = r;
      }
      this.prev2 = p1;
      this.prev = p2;
    } else {
      this.prev2 = p1;
      this.prev = Uint8Array.from(cur);
    }
    return cur;
  }
}
