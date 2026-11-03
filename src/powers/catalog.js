// The superpowers: plain data (checked by tests). Original designs only: these
// are generic comic-book powers (energy blasts, lightning, invisibility…), never
// a recreation of a specific character's move, name or look.
//
// needs: which extra models / GPU buffers a power uses
//   person  = body segmentation (the light selfie segmenter)
//   face    = face landmarks (eye positions, mouth opening)
//   plate   = the learned background behind you ("clean plate")
//   history = a short ring of past frames (afterimages, clones)
// toggle: powers that can stay on (the "Always on" activation)

export const POWERS = [
  {
    id: "wave", label: "Energy wave", icon: "☄️",
    tile: "radial-gradient(circle at 40% 50%,#fff 0 9%,var(--pick) 20%,transparent 46%),linear-gradient(90deg,transparent 40%,var(--pick) 40% 60%,transparent 60%) 0 50%/100% 30% no-repeat,#0d1220",
    needs: [],
    hint: "Bring your hands together, a little apart, to charge. Then throw them sideways, or open them at the camera!",
    how: [
      "Hold both hands close together, fingers open, as if holding a ball: energy gathers between your palms.",
      "Keep charging: the ball grows and crackles. A full charge takes under 2 seconds.",
      "<b>Throw</b> both hands sideways together to fire a beam in that direction.",
      "Or simply <b>open your hands</b> wide: the blast comes straight at the camera.",
    ],
  },
  {
    id: "lightning", label: "Lightning", icon: "⚡",
    tile: "linear-gradient(115deg,transparent 46%,#fff 47% 49%,transparent 50%),linear-gradient(65deg,transparent 47%,var(--pick) 48% 51%,transparent 52%),#141428",
    needs: [],
    hint: "Spread your fingers: arcs jump between them. Bring both hands closer for a storm. Pinch to strike!",
    how: [
      "Open a hand: small arcs crackle between your fingertips.",
      "Show both hands: lightning arcs jump from one hand to the other. The closer, the wilder.",
      "<b>Pinch</b> thumb and index to throw a bolt where your index finger points.",
    ],
  },
  {
    id: "fire", label: "Pyro", icon: "🔥",
    tile: "radial-gradient(ellipse 40% 60% at 50% 70%,#fff3b0 0 15%,#ffb02e 35%,#e8461a 60%,transparent 75%),#1d0c06",
    needs: [],
    hint: "Open your hand to light it up. Flick it fast to throw a fireball. A fist keeps glowing embers.",
    how: [
      "Open a hand: flames rise from your fingertips.",
      "Close it into a fist: the fire calms down to embers.",
      "<b>Flick</b> an open hand quickly: a fireball flies off and explodes at the edge of the picture.",
    ],
  },
  {
    id: "frost", label: "Frost", icon: "❄️",
    tile: "radial-gradient(circle at 30% 30%,#fff 0 8%,transparent 9%),conic-gradient(from 10deg,#dff4ff,#9fd3f2,#e9f8ff,#86c4ea,#dff4ff)",
    needs: [],
    hint: "Hold an open palm still: frost spreads around it. Both palms still: the whole screen freezes over. Flick to throw an ice shard.",
    how: [
      "Open a hand: icy mist rolls off your fingers.",
      "Hold the palm <b>still</b>: frost crystals grow on the picture around it, then slowly melt.",
      "Hold <b>both palms</b> still: frost creeps in from every edge of the screen.",
      "<b>Flick</b> an open hand: an ice shard flies off and shatters, leaving frost where it lands.",
    ],
  },
  {
    id: "force", label: "Force", icon: "✋",
    tile: "radial-gradient(circle,#05060a 0 16%,var(--pick) 20%,transparent 23%,transparent 34%,rgba(255,255,255,.5) 36%,transparent 39%),#26232e",
    needs: [],
    hint: "Open palm: space bends around it. Push your palm at the camera for a shockwave. Pinch to make a black hole.",
    how: [
      "Show an open palm: the picture bends around it like a lens.",
      "<b>Push</b> your palm quickly towards the camera: a shockwave ripples through the room.",
      "<b>Pinch</b> thumb and index: a black hole swallows the light around your fingers.",
    ],
  },
  {
    id: "shield", label: "Shield", icon: "🛡️",
    tile: "radial-gradient(circle,transparent 0 52%,var(--pick) 56% 60%,transparent 62%),repeating-conic-gradient(from 30deg,rgba(255,255,255,.18) 0 60deg,rgba(255,255,255,.05) 0 120deg),#14202b",
    needs: [],
    hint: "Raise an open palm towards the camera: a hexagonal force field appears. Poke it with your other hand, push it to blast.",
    how: [
      "Raise an open hand, palm towards the camera: a force field of glowing hexagons opens in front of it.",
      "Poke it with a finger of your other hand: it ripples.",
      "<b>Push</b> the palm towards the camera: the shield releases a shockwave.",
      "In Training, targets that touch the shield are destroyed.",
    ],
  },
  {
    id: "warp", label: "Reality warp", icon: "🫳",
    tile: "radial-gradient(ellipse 30% 50% at 60% 50%,transparent 60%,rgba(255,255,255,.6) 62%,transparent 66%),repeating-linear-gradient(100deg,#2d3b55 0 10px,#4f6a99 10px 20px)",
    needs: [],
    hint: "Pinch the picture and pull: the world stretches like putty. Let go and it springs back.",
    how: [
      "<b>Pinch</b> anywhere with thumb and index: you grab the picture there.",
      "Move your hand: the room stretches and bends like putty. Use both hands to grab two spots.",
      "Let go: it springs back into place with a wobble.",
    ],
  },
  {
    id: "invisible", label: "Invisibility", icon: "👻", needs: ["person", "plate"], toggle: true,
    tile: "radial-gradient(ellipse 22% 34% at 50% 58%,rgba(255,255,255,.55),transparent 70%),radial-gradient(circle at 50% 30%,rgba(255,255,255,.5) 0 10%,transparent 12%),linear-gradient(160deg,#7d93a8,#c6d3d9)",
    hint: "Hold an open palm still for a second to vanish. Do it again to come back.",
    how: [
      "First, let TrackED learn the room: step out of view for 2–3 seconds (or tap <b>Learn the background</b>). The camera must not move.",
      "Come back and <b>hold an open palm</b> still for a second: you fade away and the room shows through you.",
      "Hold the palm again to reappear. Pick the look in <b>Style</b>: clear, shimmer or ghost.",
      "Spots the camera has never seen behind you shimmer like heat haze. Move around a little and they fill in.",
    ],
  },
  {
    id: "freeze", label: "Time stop", icon: "⏸️", needs: ["person", "plate"], toggle: true,
    tile: "radial-gradient(circle,transparent 0 30%,#a9c7ff 32% 35%,transparent 37%),linear-gradient(135deg,#3b4a63,#8aa0bf)",
    hint: "Clap your hands to stop time. Everything freezes except you. Clap again to restart it.",
    how: [
      "<b>Clap</b> (bring your hands together quickly): the world freezes and turns cold, you keep moving.",
      "Frozen drops hang in the air: touch them with your fingers to push them.",
      "Clap again to let time run. Works best when TrackED has seen the room without you.",
    ],
  },
  {
    id: "speed", label: "Speedster", icon: "💨", needs: ["person", "history"], toggle: true,
    tile: "linear-gradient(90deg,transparent,var(--pick) 30%,transparent 31%,transparent 45%,var(--pick) 70%,transparent 71%),#1b1f27",
    hint: "Move! Afterimages of you trail behind. The faster you move, the brighter they get.",
    how: [
      "Move your body or your hands: colourful afterimages trail behind you.",
      "Fast moves make the trail brighter, streaks fly from your hands.",
    ],
  },
  {
    id: "clones", label: "Clones", icon: "👯", needs: ["person", "history"], toggle: true,
    tile: "radial-gradient(circle at 20% 45%,#9aa3ad 0 12%,transparent 13%),radial-gradient(circle at 50% 45%,#f4f4f1 0 12%,transparent 13%),radial-gradient(circle at 80% 45%,#9aa3ad 0 12%,transparent 13%),#2b313a",
    hint: "Hold up ✌️ for a moment: copies of you appear on each side and follow you. Again to dismiss them.",
    how: [
      "Hold a ✌️ sign still for a moment: copies of you pop up on both sides with a puff.",
      "They copy your moves a split second later. Pick 2 or 4 clones in <b>Play</b>.",
      "Hold ✌️ again to dismiss them. Stand in the middle of the picture so they have room.",
    ],
  },
  {
    id: "teleport", label: "Teleport", icon: "💫", needs: ["person", "plate"],
    tile: "linear-gradient(90deg,transparent 18%,rgba(255,255,255,.25) 18% 22%,transparent 22% 62%,#f4f4f1 62% 78%,transparent 78%),radial-gradient(circle at 30% 50%,var(--pick) 0 6%,transparent 18%),#1b1d2b",
    hint: "Point left or right and hold still: you blink across the room. Point up to come back.",
    how: [
      "First let TrackED learn the room: step out of view for 2–3 seconds (the camera must not move).",
      "Point your index finger to the left or right and hold still: you vanish and reappear a third of the picture away.",
      "Do it again to blink further. Point <b>up</b> and hold to come back to your real spot.",
    ],
  },
  {
    id: "size", label: "Size shift", icon: "🔍", needs: ["person", "plate"],
    tile: "radial-gradient(ellipse 12% 22% at 30% 70%,#f4f4f1 98%,transparent),radial-gradient(ellipse 22% 40% at 68% 55%,#f4f4f1 98%,transparent),#2a2f3a",
    hint: "Pinch with both hands and spread them apart to grow, bring them together to shrink. Two fists: back to normal.",
    how: [
      "First let TrackED learn the room: step out of view for 2–3 seconds (the camera must not move).",
      "<b>Pinch with both hands</b>, then spread them apart: you grow, like zooming a photo.",
      "Bring them together to shrink, down to a third of your size. You stay standing where your feet are.",
      "Make <b>two fists</b> to go back to your normal size.",
    ],
  },
  {
    id: "eyes", label: "Laser vision", icon: "👀", needs: ["face"],
    tile: "radial-gradient(circle at 35% 50%,#fff 0 6%,var(--pick) 12%,transparent 20%),radial-gradient(circle at 65% 50%,#fff 0 6%,var(--pick) 12%,transparent 20%),#1a1012",
    hint: "Open your mouth wide to fire your eyes. Turn your head to aim the beams.",
    how: [
      "Face the camera and <b>open your mouth</b>: beams shoot out of your eyes.",
      "Turn or tilt your head to sweep the beams across the room. Look straight at the camera to blast it.",
      "Close your mouth to stop.",
    ],
  },
  {
    id: "portal", label: "Portal", icon: "🌀", needs: ["person"],
    tile: "radial-gradient(circle,#2b0d4d 0 30%,var(--pick) 34%,#ffb347 38%,transparent 42%),#15121c",
    hint: "Point your index finger and draw a circle in the air: a portal opens behind you. Make a fist inside it to close it.",
    how: [
      "Point with your index finger (other fingers folded) and <b>draw a circle</b> in the air.",
      "A portal to another world opens there, behind you. Up to 2 at a time.",
      "Make a <b>fist</b> inside a portal to close it. They also close by themselves after a while.",
    ],
  },
  {
    id: "aura", label: "Power up", icon: "💥", needs: ["person"], toggle: true,
    tile: "radial-gradient(ellipse 26% 40% at 50% 60%,#fff 0 30%,transparent 32%),radial-gradient(ellipse 40% 60% at 50% 55%,var(--pick) 0 40%,transparent 70%),#140d10",
    hint: "Clench both fists and hold: your aura flares up and the ground shakes. Relax to calm down.",
    how: [
      "Clench <b>both fists</b> and hold: an aura of energy flares around your body.",
      "The longer you hold, the bigger it gets: sparks rise and the picture shakes.",
      "Open your hands and it slowly calms down.",
    ],
  },
];

export const POWER_IDS = POWERS.map((p) => p.id);
export const powerById = (id) => POWERS.find((p) => p.id === id) ?? POWERS[0];

/** Extra models a power needs from the tracker. */
export function powerWants(id) {
  const n = powerById(id).needs;
  return { person: n.includes("person"), face: n.includes("face") };
}

/** "Make it yours" style guide for the shared guide dialog (same format as guides.js). */
export const POWER_GUIDE = {
  title: "How to use your powers",
  intro: "Pick a power, then use your hands (and face) to trigger it. Everything runs on your device.",
  sections: [
    ...POWERS.map((p) => ({ heading: `${p.icon} ${p.label}`, steps: p.how })),
    {
      heading: "For the best results",
      tips: [
        "Keep the camera still: invisibility, time stop, teleport and size shift use the room behind you, learned while you weren't in front of it.",
        "Hold 👍 for a moment to switch to the next power without touching anything.",
        "Stand back so your hands and upper body are in view, in good light.",
        "Turn on <b>Training</b> in the Play tab: 60-second rounds of targets to hit with your power. Golden ones are worth triple.",
        "Every power lights up the real room around it. Try it in a dim room for the best look, and pick <b>Cinematic</b> in Style.",
        "Record a video (<kbd>R</kbd>): the effects and their sounds are in the clip.",
      ],
    },
  ],
};
