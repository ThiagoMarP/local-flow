const capsule = document.querySelector("#capsule");
const message = document.querySelector("#message");
const timer = document.querySelector("#timer");
const wave = document.querySelector("#wave");
const discardButton = document.querySelector("#discardButton");
const confirmButton = document.querySelector("#confirmButton");

function formatDuration(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function render(state) {
  capsule.dataset.state = state.state;
  message.textContent = state.message || "Local Flow";
  timer.textContent = formatDuration(state.elapsedMs || 0);
  // Bars animate on their own in CSS; the live level only scales how far they
  // swing, eased through the registered --amp custom property.
  const level = Math.max(0, Math.min(1, Number(state.level) || 0));
  wave.style.setProperty("--amp", level.toFixed(3));
}

discardButton.addEventListener("click", () =>
  window.localFlow.capsuleAction("discard"),
);
confirmButton.addEventListener("click", () =>
  window.localFlow.capsuleAction("confirm"),
);

window.localFlow.onUiState(render);
window.localFlow.getUiState().then(render);
