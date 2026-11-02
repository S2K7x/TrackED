// Musical clock with look-ahead scheduling ("A tale of two clocks", C. Wilson):
// a JavaScript timer wakes up often (every ~25 ms) and schedules every step
// that falls inside the next ~120 ms on the AUDIO clock (AudioContext.currentTime),
// which is sample-accurate. Timer jitter therefore never reaches the sound.
// This class is pure (time is passed in) so it can be unit-tested.

export class StepClock {
  /** @param {{bpm?: number, stepsPerBeat?: number}} o  16th notes by default */
  constructor({ bpm = 100, stepsPerBeat = 4 } = {}) {
    this.bpm = bpm;
    this.stepsPerBeat = stepsPerBeat;
    this.running = false;
  }

  get stepDur() { return 60 / this.bpm / this.stepsPerBeat; }

  start(now, delay = 0.05) {
    this.running = true;
    this.next = now + delay;     // audio time of the next step
    this.step = 0;               // index of the next step (counts forever)
  }

  stop() { this.running = false; }

  /** Changes tempo without a jump: the next step keeps its time. */
  setBpm(bpm) { this.bpm = Math.max(40, Math.min(220, bpm)); }

  /**
   * Steps to schedule now: every step whose time is before now + ahead.
   * If the page was frozen (time jumped far ahead), it resyncs instead of
   * firing a burst of late steps.
   * @returns {{step: number, time: number}[]}
   */
  collect(now, ahead = 0.12) {
    if (!this.running) return [];
    if (this.next < now - 0.25) {
      const skip = Math.ceil((now - this.next) / this.stepDur);
      this.step += skip;
      this.next += skip * this.stepDur;
    }
    const out = [];
    while (this.next < now + ahead) {
      out.push({ step: this.step, time: this.next });
      this.step++;
      this.next += this.stepDur;
    }
    return out;
  }

  /** Musical position of the audio time t: {bar, beat, step} (16 steps per bar). */
  position(t) {
    const s = Math.max(0, Math.floor(this.step - (this.next - t) / this.stepDur));
    return { bar: Math.floor(s / 16), beat: Math.floor((s % 16) / 4), step: s % 16 };
  }
}
