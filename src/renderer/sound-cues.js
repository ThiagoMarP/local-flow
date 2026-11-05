// Short tones for the edges of a dictation, in the spirit of Discord's mic
// open/close: a bright rising pair says "listening", a softer falling pair
// says "done". Synthesized here, so no audio files ship with the app.
const START_NOTES = [
  { frequency: 880, at: 0, duration: 0.09 },
  { frequency: 1318.5, at: 0.065, duration: 0.13 },
];
const STOP_NOTES = [
  { frequency: 659.3, at: 0, duration: 0.09 },
  { frequency: 440, at: 0.065, duration: 0.15 },
];
const VOLUME = 0.1;
const IDLE_SUSPEND_MS = 600;

let context = null;
let suspendTimer = null;

async function play(notes) {
  try {
    if (!context || context.state === "closed") {
      context = new AudioContext({ latencyHint: "interactive" });
    }
    window.clearTimeout(suspendTimer);
    if (context.state === "suspended") await context.resume();
    const begin = context.currentTime + 0.005;
    const output = context.createGain();
    output.gain.value = VOLUME;
    output.connect(context.destination);
    let end = begin;
    for (const note of notes) {
      const startAt = begin + note.at;
      const stopAt = startAt + note.duration;
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = note.frequency;
      // A few milliseconds of attack and an exponential tail keep the tone
      // from clicking at either end.
      const envelope = context.createGain();
      envelope.gain.setValueAtTime(0, startAt);
      envelope.gain.linearRampToValueAtTime(1, startAt + 0.006);
      envelope.gain.exponentialRampToValueAtTime(0.0001, stopAt);
      oscillator.connect(envelope);
      envelope.connect(output);
      oscillator.start(startAt);
      oscillator.stop(stopAt + 0.02);
      end = Math.max(end, stopAt);
    }
    // Park the output device once the tone is over.
    const tail = (end - context.currentTime) * 1000 + IDLE_SUSPEND_MS;
    suspendTimer = window.setTimeout(() => {
      context?.suspend().catch(() => {});
    }, tail);
  } catch {
    // A missing output device must never get in the way of a dictation.
  }
}

export function playStartCue() {
  return play(START_NOTES);
}

export function playStopCue() {
  return play(STOP_NOTES);
}
