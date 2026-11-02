// Hand-sign recognition from the 21 MediaPipe hand landmarks: pure geometry,
// no extra model (MediaPipe's Gesture Recognizer would add a second network
// for the same landmarks). Signs are only read when ONE hand is visible, so
// they never clash with the two-handed frame gesture.
//
// Landmarks: 0 wrist; thumb 1-4; index 5-8; middle 9-12; ring 13-16; pinky 17-20.

const FINGERS = { index: [5, 6, 7, 8], middle: [9, 10, 11, 12], ring: [13, 14, 15, 16], pinky: [17, 18, 19, 20] };

function v(a, b, aspect) { return { x: (b.x - a.x) * aspect, y: b.y - a.y }; }
function len(p) { return Math.hypot(p.x, p.y); }
function dist(a, b, aspect) { return len(v(a, b, aspect)); }
/** Angle at b (degrees) in the polyline a-b-c. */
function angle(a, b, c, aspect) {
  const u = v(b, a, aspect), w = v(b, c, aspect);
  const cos = (u.x * w.x + u.y * w.y) / (len(u) * len(w) || 1);
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

/** A finger is extended when it is nearly straight and its tip is far from the wrist. */
export function fingerExtended(lm, [mcp, pip, dip, tip], aspect = 1) {
  const straight = angle(lm[mcp], lm[pip], lm[dip], aspect) > 155 && angle(lm[pip], lm[dip], lm[tip], aspect) > 145;
  return straight && dist(lm[0], lm[tip], aspect) > dist(lm[0], lm[pip], aspect) * 1.15;
}

export function thumbExtended(lm, aspect = 1) {
  const straight = angle(lm[2], lm[3], lm[4], aspect) > 150;
  const handSize = dist(lm[0], lm[9], aspect);
  return straight && dist(lm[4], lm[5], aspect) > handSize * 0.55;
}

/**
 * @returns {"thumbs_up"|"victory"|"open_palm"|null}
 */
export function classifySign(lm, aspect = 1) {
  const ext = Object.fromEntries(Object.entries(FINGERS).map(([k, f]) => [k, fingerExtended(lm, f, aspect)]));
  const thumb = thumbExtended(lm, aspect);
  const n = Object.values(ext).filter(Boolean).length;
  if (thumb && n === 4) return "open_palm";
  if (ext.index && ext.middle && !ext.ring && !ext.pinky) {
    // victory: the two fingers are spread apart
    const spread = dist(lm[8], lm[12], aspect) > dist(lm[5], lm[9], aspect) * 1.2;
    return spread ? "victory" : null;
  }
  if (thumb && n === 0) {
    // thumbs up: thumb tip clearly above the knuckles (y grows downwards)
    const up = lm[4].y < Math.min(lm[5].y, lm[9].y) - dist(lm[0], lm[9], aspect) * 0.35;
    return up ? "thumbs_up" : null;
  }
  return null;
}

/**
 * Debounces signs: a sign fires once after being held for `hold` seconds, and
 * can only fire again after the hand changes sign.
 */
export class SignHold {
  constructor(hold = 0.6) { this.hold = hold; this.reset(); }
  reset() { this.sign = null; this.since = 0; this.fired = false; }
  /** @returns {{sign: string|null, progress: number, fire: boolean}} */
  update(sign, t) {
    if (sign !== this.sign) { this.sign = sign; this.since = t; this.fired = false; }
    if (!sign) return { sign: null, progress: 0, fire: false };
    const progress = Math.min(1, (t - this.since) / this.hold);
    const fire = progress >= 1 && !this.fired;
    if (fire) this.fired = true;
    return { sign, progress: this.fired && !fire ? 1 : progress, fire };
  }
}
