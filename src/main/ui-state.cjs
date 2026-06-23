const VALID_STATES = new Set([
  "idle",
  "recording",
  "processing",
  "success",
  "error",
]);
const VALID_PROFILES = new Set(["fast", "standard", "accurate"]);

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
  };
}

module.exports = { VALID_STATES, normalizeUiState };

