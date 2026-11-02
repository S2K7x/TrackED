// Pure geometry helpers. All points are in normalized image space [0..1].

export const LM = { THUMB_TIP: 4, INDEX_TIP: 8 };

function cross(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

export function segmentsIntersect(p1, p2, p3, p4) {
  const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
  return (d1 > 0) !== (d2 > 0) && (d3 > 0) !== (d4 > 0);
}

/**
 * Builds the frame quad between two hands, ordered [q0, q1, q2, q3] so that
 * q0→q1 is the "index" edge, q3→q2 the "thumb" edge, and the quad never
 * self-intersects (its diagonals q0–q2 and q1–q3 always cross).
 * Hands are sorted left→right, so the result is stable whichever hand comes first.
 */
export function quadFromHands(handA, handB) {
  let hands = [handA, handB].map(lm => ({
    index: lm[LM.INDEX_TIP],
    thumb: lm[LM.THUMB_TIP],
  }));
  hands.sort((a, b) => a.index.x + a.thumb.x - (b.index.x + b.thumb.x));
  const [A, B] = hands;
  const q = [A.index, B.index, B.thumb, A.thumb];
  if (!segmentsIntersect(q[0], q[2], q[1], q[3])) return [A.index, B.thumb, B.index, A.thumb];
  return q;
}

/** Signed area (shoelace). Used to fade out degenerate (collapsed) frames. */
export function quadArea(q, aspect = 1) {
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    s += a.x * aspect * b.y - b.x * aspect * a.y;
  }
  return Math.abs(s) / 2;
}

export function mirrorLandmarks(lm) {
  return lm.map(p => ({ x: 1 - p.x, y: p.y }));
}

/** True when p lies inside the frame quad (tested as two triangles, works for convex and mildly concave quads). */
export function pointInQuad(p, q) {
  const inTri = (a, b, c) => {
    const d1 = cross(a, b, p), d2 = cross(b, c, p), d3 = cross(c, a, p);
    const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
  };
  return inTri(q[0], q[1], q[2]) || inTri(q[0], q[2], q[3]);
}

/** A face counts as "in the frame" when at least 2 of its eyes / nose are inside it. */
export function faceInFrame(face, q) {
  if (!q) return false;
  return [face.eyeL, face.eyeR, face.nose].filter((p) => pointInQuad(p, q)).length >= 2;
}
