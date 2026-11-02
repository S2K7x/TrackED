// Picks performance settings for the current device.
//
//   tier "high": desktop / laptop with plenty of cores
//   tier "mid" : recent phones, ordinary laptops
//   tier "low" : phones with few cores or little memory
//
// detectWidth   width of the frames sent to the models (smaller = faster; the
//               hand model works at ~224 px internally, so 320 px is still plenty)
// extrasEvery   run the face / segmentation models once every N camera frames
// cameraHeight  requested camera resolution (short side)

export function deviceProfile(nav = globalThis.navigator ?? {}, mq = (q) => globalThis.matchMedia?.(q).matches ?? false) {
  const ua = nav.userAgent || "";
  const mobile = mq("(pointer: coarse)") || /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  const cores = nav.hardwareConcurrency || 4;
  const memory = nav.deviceMemory || 4; // GB, Chromium only
  let tier = "mid";
  if (!mobile && cores >= 8) tier = "high";
  else if (mobile && (cores <= 4 || memory <= 3)) tier = "low";
  return {
    mobile,
    tier,
    detectWidth: { high: 480, mid: 384, low: 320 }[tier],
    extrasEvery: { high: 1, mid: 2, low: 3 }[tier],
    cameraHeight: tier === "low" ? 480 : 720,
  };
}
