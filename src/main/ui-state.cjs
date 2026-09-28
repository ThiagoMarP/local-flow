// "processing" and "revising" are the two halves of the post-recording work:
// whisper turning audio into text, then the local LLM cleaning that text. They
// are separate states so the capsule can show which one is running.
const VALID_STATES = new Set([
  "idle",
  "recording",
  "meeting",
  "processing",
  "revising",
  "success",
  "error",
]);
const VALID_PROFILES = new Set(["fast", "standard", "accurate", "parakeet"]);
// Extra line the capsule shows while a dictation records.
const VALID_HINTS = new Set(["esc", "silent", "countdown"]);

function normalizeUiState(payload = {}) {
  const state = VALID_STATES.has(payload.state) ? payload.state : "idle";
  const profile = VALID_PROFILES.has(payload.profile)
    ? payload.profile
    : "standard";
  return {
    state,
    profile,
    message: String(payload.message || "").slice(0, 160),
    elapsedMs: Math.max(0, Number(payload.elapsedMs) || 0),
    level: Math.max(0, Math.min(1, Number(payload.level) || 0)),
    // The text is only on the clipboard (copied only, or the paste failed), so
    // the capsule tells the user to press Ctrl+V instead of the plain pulse.
    manualPaste: payload.manualPaste === true,
    hint: VALID_HINTS.has(payload.hint) ? payload.hint : null,
    remainingMs: Math.max(0, Number(payload.remainingMs) || 0),
    // Locked recording (ends on the next gesture), not a held push-to-talk.
    locked: payload.locked === true,
  };
}

module.exports = { VALID_STATES, normalizeUiState };
