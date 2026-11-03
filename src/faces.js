// Face helpers (pure functions, unit-tested).
// MediaPipe Face Landmarker returns 478 points; we only keep a few anchors.

export const FACE = {
  NOSE_TIP: 1,
  UPPER_LIP: 13,
  LOWER_LIP: 14,
  CHEEK_RIGHT: 234, // image-left side of the face oval
  CHEEK_LEFT: 454,  // image-right side of the face oval
  IRIS_A: 468,      // iris centers (present in the 478-point model)
  IRIS_B: 473,
  EYE_A: [33, 133], // eye corners, used if iris points are missing
  EYE_B: [362, 263],
};

const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * Reduces a face mesh to the anchors the shader needs.
 * @param {{x:number,y:number}[]} lm  normalized landmarks
 * @param {number} aspect             image width / height
 * @returns {{eyeL:{x,y}, eyeR:{x,y}, mouth:{x,y}, nose:{x,y}, r:number}}
 *   r = half face width, in units of image height
 */
export function summarizeFace(lm, aspect = 1) {
  const eyeA = lm[FACE.IRIS_A] ?? mid(lm[FACE.EYE_A[0]], lm[FACE.EYE_A[1]]);
  const eyeB = lm[FACE.IRIS_B] ?? mid(lm[FACE.EYE_B[0]], lm[FACE.EYE_B[1]]);
  const [eyeL, eyeR] = eyeA.x <= eyeB.x ? [eyeA, eyeB] : [eyeB, eyeA];
  const a = lm[FACE.CHEEK_RIGHT], b = lm[FACE.CHEEK_LEFT];
  const r = Math.hypot((a.x - b.x) * aspect, a.y - b.y) / 2;
  const up = lm[FACE.UPPER_LIP], lo = lm[FACE.LOWER_LIP];
  return {
    eyeL: { x: eyeL.x, y: eyeL.y },
    eyeR: { x: eyeR.x, y: eyeR.y },
    mouth: mid(up, lo),
    nose: { x: lm[FACE.NOSE_TIP].x, y: lm[FACE.NOSE_TIP].y },
    r,
    // lip gap / face half-width: ~0.02 closed, ~0.4 wide open (laser vision trigger)
    open: r > 0 ? Math.hypot((up.x - lo.x) * aspect, up.y - lo.y) / r : 0,
  };
}

export function mirrorFace(f) {
  const m = (p) => ({ x: 1 - p.x, y: p.y });
  // mirroring swaps which eye is on the left
  // the head pose stays in camera space; the 3D layer mirrors the whole scene instead
  const out = { eyeL: m(f.eyeR), eyeR: m(f.eyeL), mouth: m(f.mouth), nose: m(f.nose), r: f.r, open: f.open, pose: f.pose };
  if (f.mesh) {
    out.mesh = new Float32Array(f.mesh);
    for (let i = 0; i < out.mesh.length; i += 2) out.mesh[i] = 1 - out.mesh[i];
  }
  return out;
}

/**
 * Which faces get the face effect: "all", "me" (the biggest face — the one
 * closest to the camera) or "others" (everyone else, e.g. friends next to you).
 * @returns {boolean[]}
 */
export function selectFaces(faces, who) {
  if (who === "all" || faces.length === 0) return faces.map(() => true);
  let big = 0;
  faces.forEach((f, i) => { if (f.r > faces[big].r) big = i; });
  return faces.map((_, i) => (who === "me" ? i === big : i !== big));
}

/** Segmentation targets → bitmask over the selfie_multiclass categories. */
export const SEG = { BACKGROUND: 0, HAIR: 1, BODY_SKIN: 2, FACE_SKIN: 3, CLOTHES: 4, OTHERS: 5 };
export const TARGETS = {
  all: null, // no mask needed
  people: (1 << SEG.HAIR) | (1 << SEG.BODY_SKIN) | (1 << SEG.FACE_SKIN) | (1 << SEG.CLOTHES) | (1 << SEG.OTHERS),
  background: 1 << SEG.BACKGROUND,
  skin: (1 << SEG.BODY_SKIN) | (1 << SEG.FACE_SKIN),
  hair: 1 << SEG.HAIR,
  clothes: 1 << SEG.CLOTHES,
};
