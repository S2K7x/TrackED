// "Music basics" cards for people who have never played: short, friendly,
// practical. Shown in the shared guide dialog (same format as guides.js:
// sections with steps or tips; inline <b>, <em>, <kbd> only).

export const MUSIC_GUIDES = {
  start: {
    title: "Your first minute of music",
    intro: "No experience needed: TrackED keeps every note in key, so you can't play a wrong note with the default settings.",
    sections: [
      {
        heading: "Try this",
        steps: [
          "Pick <b>Keys</b> and pinch your thumb with each finger, one by one: you just played a scale.",
          "Open the <b>Band</b> tab and pick <b>Lo-fi</b>: drums and bass start playing in your key.",
          "Play anything on top: slow notes first, then little repeating patterns. That's improvising!",
          "Press <b>Record a loop</b>, play 4 notes, press again: your loop repeats and you can play over it.",
        ],
      },
      {
        heading: "Good habits",
        tips: [
          "Less is more: a few notes with space between them sound more musical than many fast ones.",
          "Repeat a short idea 2–3 times, then change one note. Songs are built that way.",
          "Start and end on the <b>root</b> (the key's name, e.g. C): it sounds like \"home\".",
        ],
      },
    ],
  },
  notes: {
    title: "Notes, scales and keys",
    intro: "Music uses 12 notes that repeat higher and lower: C, C#, D, D#, E, F, F#, G, G#, A, A#, B.",
    sections: [
      {
        heading: "The ideas",
        tips: [
          "A <b>scale</b> is a set of notes that sound good together. TrackED only lets you play the notes of the chosen scale.",
          "<b>Pentatonic</b> (5 notes) is the easiest: every combination sounds pleasant. That's why it's the default.",
          "<b>Major</b> sounds happy and bright, <b>Minor</b> sounds sad or mysterious, <b>Blues</b> sounds cool and gritty.",
          "The <b>key</b> (C, D, E…) moves everything up or down. Pick the key of a song to play along with it.",
          "An <b>octave</b> is the same note, higher or lower (C4 → C5). The <b>Range</b> setting moves your instrument by octaves.",
        ],
      },
    ],
  },
  chords: {
    title: "Chords and progressions",
    intro: "A chord is several notes played together. Most pop songs use just 4 chords, repeated.",
    sections: [
      {
        heading: "The ideas",
        tips: [
          "Chords are numbered by the scale note they start on: <b>I</b>, <b>IV</b>, <b>V</b> are major (bright), <b>vi</b> is minor (soft).",
          "<b>I–V–vi–IV</b> is the famous pop progression: thousands of songs use it.",
          "In <b>Chords</b> mode, your left hand's finger count picks the chord (1 to 4) and your right index strums.",
          "Change chord on the first beat of each bar: count \"1, 2, 3, 4\" with the band and switch on \"1\".",
        ],
      },
    ],
  },
  rhythm: {
    title: "Rhythm and beats",
    intro: "Rhythm is when notes happen. Most music counts in groups of 4 beats (a bar).",
    sections: [
      {
        heading: "The ideas",
        tips: [
          "<b>Tempo</b> (BPM) is the speed: 70 is relaxed, 120 makes people dance.",
          "The classic beat: <b>kick</b> on beats 1 and 3, <b>snare</b> on 2 and 4, hi-hat on every half beat.",
          "Turn on the <b>Metronome</b> (Band tab) and nod your head to it before you play.",
          "In <b>Beats</b> mode, the 8 columns are half beats: kicks on 1 and 5, snares on 3 and 7 make a basic beat.",
        ],
      },
    ],
  },
};

export const MUSIC_GUIDE_ORDER = ["start", "notes", "chords", "rhythm"];
