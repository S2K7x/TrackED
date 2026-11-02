// Melodies for the "Learn a song" lessons. PUBLIC-DOMAIN melodies only (traditional
// tunes and 18th–19th-century compositions), stored as notes only (no lyrics).
// Notes are MIDI numbers in C major around middle C (C4 = 60), so they fit the
// 8 pinch keys (C4–C5) with Key = C, Scale = Major, Range = Middle.
//
// Format: [midi, beats]

const C4 = 60, D4 = 62, E4 = 64, F4 = 65, G4 = 67, A4 = 69, B4 = 71, C5 = 72;

export const SONGS = [
  {
    id: "twinkle",
    title: "Twinkle Twinkle",
    origin: "Traditional (18th-century French melody)",
    level: 1,
    notes: [[C4, 1], [C4, 1], [G4, 1], [G4, 1], [A4, 1], [A4, 1], [G4, 2], [F4, 1], [F4, 1], [E4, 1], [E4, 1], [D4, 1], [D4, 1], [C4, 2]],
  },
  {
    id: "mary",
    title: "Mary Had a Little Lamb",
    origin: "Traditional (19th century)",
    level: 1,
    notes: [[E4, 1], [D4, 1], [C4, 1], [D4, 1], [E4, 1], [E4, 1], [E4, 2], [D4, 1], [D4, 1], [D4, 2], [E4, 1], [G4, 1], [G4, 2]],
  },
  {
    id: "jacques",
    title: "Frère Jacques",
    origin: "Traditional (French round)",
    level: 1,
    notes: [[C4, 1], [D4, 1], [E4, 1], [C4, 1], [C4, 1], [D4, 1], [E4, 1], [C4, 1], [E4, 1], [F4, 1], [G4, 2], [E4, 1], [F4, 1], [G4, 2]],
  },
  {
    id: "ode",
    title: "Ode to Joy",
    origin: "Ludwig van Beethoven, 1824",
    level: 2,
    notes: [[E4, 1], [E4, 1], [F4, 1], [G4, 1], [G4, 1], [F4, 1], [E4, 1], [D4, 1], [C4, 1], [C4, 1], [D4, 1], [E4, 1], [E4, 1.5], [D4, 0.5], [D4, 2]],
  },
  {
    id: "saints",
    title: "When the Saints",
    origin: "Traditional spiritual",
    level: 2,
    notes: [[C4, 1], [E4, 1], [F4, 1], [G4, 4], [C4, 1], [E4, 1], [F4, 1], [G4, 4], [C4, 1], [E4, 1], [F4, 1], [G4, 2], [E4, 2], [C4, 2], [E4, 2], [D4, 4]],
  },
  {
    id: "scale",
    title: "The C major scale",
    origin: "Warm-up: every key, low to high and back",
    level: 1,
    notes: [[C4, 1], [D4, 1], [E4, 1], [F4, 1], [G4, 1], [A4, 1], [B4, 1], [C5, 2], [B4, 1], [A4, 1], [G4, 1], [F4, 1], [E4, 1], [D4, 1], [C4, 2]],
  },
];
