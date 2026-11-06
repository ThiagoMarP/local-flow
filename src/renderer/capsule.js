import { capsuleErrorLabel } from "./capsule-labels.js";
import { createCapsuleField } from "./capsule-field.js";

const capsule = document.querySelector("#capsule");
const message = document.querySelector("#message");
const timer = document.querySelector("#timer");
const field = createCapsuleField(document.querySelector("#field"));
const noticeText = document.querySelector("#noticeText");
const hint = document.querySelector("#hint");
const discardButton = document.querySelector("#discardButton");
const confirmButton = document.querySelector("#confirmButton");

let current = { state: "idle" };
// Tracked here instead of trusting :hover. Outside the notice states main
// stops forwarding mouse moves, so Chromium's hover state goes stale.
let pointerInside = false;

function formatDuration(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

// The two states the user may want to read or act on: a failure, and a
// dictation whose text is waiting on the clipboard for a manual Ctrl+V.
function showsNotice(state) {
  return state.state === "error" ||
    (state.state === "success" && state.manualPaste);
}

// Extra line beside the bars while a dictation records.
function hintText(state) {
  if (state.hint === "esc") return "Esc cancela";
  if (state.hint === "silent") return "Microfone sem som";
  if (state.hint === "countdown") return `${Math.ceil((state.remainingMs || 0) / 1000)} s`;
  return "";
}

function render(state) {
  current = state;
  capsule.dataset.state = state.state;
  capsule.dataset.manualPaste = String(Boolean(state.manualPaste));
  capsule.dataset.locked = String(state.state === "recording" && Boolean(state.locked));
  capsule.dataset.hint = state.state === "recording" && state.hint ? state.hint : "";
  hint.textContent = capsule.dataset.hint ? hintText(state) : "";
  message.textContent = state.message || "Local Flow";
  timer.textContent = formatDuration(state.elapsedMs || 0);
  noticeText.textContent = state.state === "error"
    ? capsuleErrorLabel(state.message)
    : state.manualPaste ? "Ctrl+V" : "";
  field.update({
    state: showsNotice(state) ? "idle" : state.state,
    level: state.level,
    hint: capsule.dataset.hint,
  });
  // Main resets its hover flag on every new state. A notice replacing another
  // notice under a resting cursor fires no mouseenter, so report it again.
  if (!showsNotice(state)) pointerInside = false;
  else if (pointerInside) window.localFlow.capsuleHover(true);
}

// Main keeps the window click-through and only accepts clicks while the
// cursor is over the pill, which the capsule reports here.
capsule.addEventListener("mouseenter", () => {
  pointerInside = true;
  if (showsNotice(current)) window.localFlow.capsuleHover(true);
});
capsule.addEventListener("mouseleave", () => {
  pointerInside = false;
  window.localFlow.capsuleHover(false);
});
// Clicking an error opens the dashboard with the full message; clicking the
// Ctrl+V notice just dismisses it.
capsule.addEventListener("click", () => {
  if (current.state === "error") window.localFlow.capsuleAction("open");
  else if (showsNotice(current)) window.localFlow.capsuleAction("confirm");
});
discardButton.addEventListener("click", (event) => {
  event.stopPropagation();
  window.localFlow.capsuleAction("discard");
});
confirmButton.addEventListener("click", (event) => {
  event.stopPropagation();
  window.localFlow.capsuleAction("confirm");
});

window.localFlow.onUiState(render);
window.localFlow.getUiState().then(render);
