// Interactive first-run tutorial ("learn by doing") + contextual hints.
//
// Follows hand-tracking onboarding guidance (Meta, Ultraleap): a neutral hand
// animation shows each gesture, the prompt stays until the user actually
// succeeds, steps validate themselves from live tracking, and the whole thing
// can be replayed from the help button. Pure logic here; the DOM is in main.js.

export const STEPS = [
  {
    id: "hands",
    title: "Show both hands",
    text: "Hold your hands up in front of the camera, a bit away from your face.",
    art: "hands",
    done: (c) => c.hands >= 2,
  },
  {
    id: "frame",
    title: "Make an L with each hand",
    text: "Thumb and index out, like framing a photo. A frame appears between your hands.",
    art: "frame",
    done: (c) => c.frameShownFor >= 0.8,
  },
  {
    id: "switch",
    title: "Change the effect",
    text: "Pinch the frame shut and open it again quickly, swipe the video, or pick an effect below.",
    art: "pinch",
    done: (c) => c.effectChanges >= 1,
  },
  {
    id: "signs",
    title: "Hands-free shortcuts",
    text: "With one hand: hold 👍 for a photo, ✌️ for the next effect, 🖐 to freeze the frame.",
    art: "signs",
    done: (c) => c.signsFired >= 1,
    optional: true,
  },
];

/** Tutorial state machine. Feed it a context every frame; it tells you what to show. */
export class Tutorial {
  constructor(steps = STEPS) {
    this.steps = steps;
    this.index = 0;
    this.active = false;
    this.completedAt = -Infinity;   // time the current step was completed (for the ✓ beat)
  }

  start() { this.index = 0; this.active = true; this.completedAt = -Infinity; }
  stop() { this.active = false; }
  get step() { return this.steps[this.index]; }
  get finished() { return this.index >= this.steps.length; }

  /**
   * @param {{hands: number, frameShownFor: number, effectChanges: number, signsFired: number}} ctx
   * @param {number} t  seconds
   * @returns {{changed: boolean, celebrating: boolean}}
   */
  update(ctx, t) {
    if (!this.active || this.finished) return { changed: false, celebrating: false };
    // a short "✓ Nice!" beat before moving to the next step
    if (this.completedAt > -Infinity) {
      if (t - this.completedAt < 0.9) return { changed: false, celebrating: true };
      this.completedAt = -Infinity;
      this.index++;
      if (this.finished) this.active = false;
      return { changed: true, celebrating: false };
    }
    if (this.step.done(ctx)) {
      this.completedAt = t;
      return { changed: true, celebrating: true };
    }
    return { changed: false, celebrating: false };
  }

  next() {
    this.completedAt = -Infinity;
    this.index++;
    if (this.finished) this.active = false;
  }
}

/**
 * Contextual hints after the tutorial: one at a time, only when relevant,
 * never repeated more than once every `cooldown` seconds.
 * @returns {string|null}
 */
export function pickHint(c, lastShown = {}, t = 0, cooldown = 25) {
  const ready = (id) => t - (lastShown[id] ?? -Infinity) > cooldown;
  if (c.brightness != null && c.brightness < 0.18 && ready("dark")) return "dark";
  if (c.noHandsFor > 6 && ready("nohands")) return "nohands";
  if (c.oneHandFor > 5 && ready("onehand")) return "onehand";
  if (c.handsTooClose && ready("close")) return "close";
  return null;
}

export const HINTS = {
  dark: "It's a bit dark. Face a window or a lamp so tracking works better.",
  nohands: "Can't see your hands. Step back a little so both hands fit in the picture.",
  onehand: "Only one hand visible. Bring the other one into view to make the frame.",
  close: "You're very close. Lean back a bit for a steadier frame.",
};
