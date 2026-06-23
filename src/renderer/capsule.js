const capsule = document.querySelector("#capsule");
const message = document.querySelector("#message");
const timer = document.querySelector("#timer");
const profile = document.querySelector("#profile");
const bars = [...document.querySelectorAll(".wave i")];

const profileLabels = {
  fast: "Small",
  standard: "Medium",
  accurate: "Turbo",
};

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
  profile.textContent = profileLabels[state.profile] || "Medium";
  const level = Math.max(0.04, Number(state.level) || 0);
  bars.forEach((bar, index) => {
    const variation = 0.45 + ((index * 7) % 10) / 16;
    bar.style.setProperty("--level", Math.min(1, level * variation));
  });
}

window.localFlow.onUiState(render);
window.localFlow.getUiState().then(render);
