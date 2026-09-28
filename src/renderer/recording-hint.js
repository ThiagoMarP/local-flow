const ESC_HINT_MS = 2500;
const SILENT_AFTER_MS = 3000;
const COUNTDOWN_MS = 10_000;

// What the capsule should say while a dictation records, beyond the bars. The
// most urgent wins: the recording is about to be cut, then the microphone has
// captured nothing at all (muted or the wrong device; a pause mid-speech does
// not count), then a first-seconds reminder that Esc cancels.
export function recordingHint({ elapsedMs, limitMs, heardSound, showEscHint }) {
  if (limitMs > 0 && limitMs - elapsedMs <= COUNTDOWN_MS) {
    return { hint: "countdown", remainingMs: Math.max(0, limitMs - elapsedMs) };
  }
  if (!heardSound && elapsedMs >= SILENT_AFTER_MS) {
    return { hint: "silent", remainingMs: 0 };
  }
  if (showEscHint && elapsedMs < ESC_HINT_MS) {
    return { hint: "esc", remainingMs: 0 };
  }
  return { hint: null, remainingMs: 0 };
}
