import { joinAndEncode } from "./audio.js";
import { createSettingsController } from "./settings-controller.js";

const recordButton = document.querySelector("#recordButton");
const stopButton = document.querySelector("#stopButton");
const copyButton = document.querySelector("#copyButton");
const profileSelect = document.querySelector("#profileSelect");
const vocabularyInput = document.querySelector("#vocabularyInput");
const statusElement = document.querySelector("#status");
const timerElement = document.querySelector("#timer");
const meterFill = document.querySelector("#meterFill");
const resultText = document.querySelector("#resultText");
const resultMeta = document.querySelector("#resultMeta");
const shortcutKey = document.querySelector("#shortcutKey");
const shortcutStatus = document.querySelector("#shortcutStatus");
const shortcutDescription = document.querySelector(
  "#shortcutDescription",
);
const microphoneSelect = document.querySelector("#microphoneSelect");
const shortcutSelect = document.querySelector("#shortcutSelect");
const maxDurationSelect = document.querySelector("#maxDurationSelect");
const autoPasteInput = document.querySelector("#autoPasteInput");
const restoreClipboardInput = document.querySelector(
  "#restoreClipboardInput",
);
const launchAtLoginInput = document.querySelector(
  "#launchAtLoginInput",
);
const startMinimizedInput = document.querySelector(
  "#startMinimizedInput",
);
const settingsSaveStatus = document.querySelector(
  "#settingsSaveStatus",
);
const settingsController = createSettingsController({
  profileSelect,
  vocabularyInput,
  microphoneSelect,
  shortcutSelect,
  maxDurationSelect,
  autoPasteInput,
  restoreClipboardInput,
  launchAtLoginInput,
  startMinimizedInput,
  shortcutKey,
  shortcutStatus,
  settingsSaveStatus,
});

let audioContext;
let sourceNode;
let processorNode;
let silentGain;
let microphoneStream;
let chunks = [];
let recordingStartedAt = 0;
let timerInterval;
let state = "booting";
let lastLevelPublish = 0;
let recordingSource = "manual";
let pendingShortcutStop = false;
let maxDurationStopRequested = false;

function capsuleState(nextState) {
  if (nextState === "requesting") return "processing";
  if (
    ["idle", "recording", "processing", "success", "error"].includes(
      nextState,
    )
  ) {
    return nextState;
  }
  return "idle";
}

function publishUiState(overrides = {}) {
  window.localFlow.updateUiState({
    state: capsuleState(state),
    message: statusElement.textContent,
    profile: profileSelect.value,
    elapsedMs:
      state === "recording" ? Date.now() - recordingStartedAt : 0,
    level: 0,
    ...overrides,
  });
}

function setStatus(nextState, message) {
  state = nextState;
  statusElement.textContent = message;
  const isIdle =
    state === "idle" || state === "success" || state === "error";
  recordButton.disabled = !isIdle;
  stopButton.disabled = state !== "recording";
  profileSelect.disabled =
    state === "recording" || state === "processing";
  vocabularyInput.disabled =
    state === "recording" || state === "processing";
  settingsController.setDisabled(
    state === "recording" || state === "processing",
  );
  publishUiState();
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function updateTimer() {
  const elapsedMs = Date.now() - recordingStartedAt;
  timerElement.textContent = formatDuration(elapsedMs);
  publishUiState({ elapsedMs });
  if (
    state === "recording" &&
    !maxDurationStopRequested &&
    settingsController.get()?.maxRecordingSeconds &&
    elapsedMs >= settingsController.get().maxRecordingSeconds * 1000
  ) {
    maxDurationStopRequested = true;
    stopAndTranscribe(recordingSource);
  }
}

function buildWav() {
  return joinAndEncode(chunks, audioContext.sampleRate, 16000);
}

async function startRecording(source = "manual") {
  try {
    recordingSource = source;
    maxDurationStopRequested = false;
    setStatus("requesting", "Solicitando acesso ao microfone…");
    const audioOptions = {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };
    if (
      settingsController.get()?.microphoneId &&
      settingsController.get().microphoneId !== "default"
    ) {
      audioOptions.deviceId = {
        exact: settingsController.get().microphoneId,
      };
    }
    try {
      microphoneStream = await navigator.mediaDevices.getUserMedia({
        audio: audioOptions,
      });
    } catch (error) {
      if (error.name !== "OverconstrainedError") throw error;
      microphoneStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    }

    audioContext = new AudioContext();
    sourceNode = audioContext.createMediaStreamSource(microphoneStream);
    processorNode = audioContext.createScriptProcessor(4096, 1, 1);
    silentGain = audioContext.createGain();
    silentGain.gain.value = 0;
    chunks = [];

    processorNode.onaudioprocess = (event) => {
      if (state !== "recording") return;
      const input = event.inputBuffer.getChannelData(0);
      const copy = new Float32Array(input);
      chunks.push(copy);
      let peak = 0;
      for (const value of copy) {
        peak = Math.max(peak, Math.abs(value));
      }
      const level = Math.min(1, peak * 3.2);
      meterFill.style.width = `${Math.min(100, 4 + peak * 250)}%`;
      const now = Date.now();
      if (now - lastLevelPublish > 80) {
        lastLevelPublish = now;
        publishUiState({
          elapsedMs: now - recordingStartedAt,
          level,
        });
      }
    };

    sourceNode.connect(processorNode);
    processorNode.connect(silentGain);
    silentGain.connect(audioContext.destination);

    recordingStartedAt = Date.now();
    timerElement.textContent = "00:00";
    timerInterval = window.setInterval(updateTimer, 250);
    setStatus("recording", "Ouvindo…");
    window.localFlow.reportDictationEvent({
      type: "started",
      source: recordingSource,
    });
    if (pendingShortcutStop) {
      pendingShortcutStop = false;
      await stopAndTranscribe("shortcut");
    }
  } catch (error) {
    await stopAudioGraph();
    setStatus(
      "error",
      `Não foi possível acessar o microfone: ${error.message}`,
    );
    window.localFlow.reportDictationEvent({
      type: "error",
      source: recordingSource,
      message: error.message,
    });
  }
}

async function stopAudioGraph() {
  window.clearInterval(timerInterval);
  processorNode?.disconnect();
  sourceNode?.disconnect();
  silentGain?.disconnect();
  microphoneStream?.getTracks().forEach((track) => track.stop());
  if (audioContext && audioContext.state !== "closed") {
    await audioContext.close();
  }
  meterFill.style.width = "0";
}

async function cancelRecording(reason = "cancelled") {
  pendingShortcutStop = false;
  maxDurationStopRequested = false;
  await stopAudioGraph();
  chunks = [];
  timerElement.textContent = "00:00";
  setStatus("idle", "Pronto para gravar.");
  window.localFlow.reportDictationEvent({
    type: "cancelled",
    source: reason,
  });
}

async function stopAndTranscribe(source = recordingSource) {
  if (state !== "recording") return;
  setStatus("processing", "Preparando o áudio…");
  const wav = buildWav();
  await stopAudioGraph();

  if (wav.byteLength <= 44) {
    setStatus("error", "Nenhum áudio foi capturado.");
    return;
  }

  try {
    setStatus("processing", "Transcrevendo localmente…");
    const vocabulary = vocabularyInput.value
      .split(",")
      .map((term) => term.trim())
      .filter(Boolean);
    const result = await window.localFlow.transcribe({
      audio: wav,
      profile: profileSelect.value,
      vocabulary,
    });
    resultText.value = result.text;
    copyButton.disabled = false;
    resultMeta.textContent =
      `${result.durationSeconds.toFixed(1)} s de áudio · ` +
      `${(result.elapsedMs / 1000).toFixed(1)} s para transcrever · ` +
      (result.autoPasted
        ? "inserido no aplicativo ativo"
        : "copiado para o clipboard");
    setStatus(
      "success",
      result.autoPasted
        ? "Texto inserido no aplicativo ativo."
        : "Transcrição concluída e copiada.",
    );
    window.localFlow.reportDictationEvent({
      type: "completed",
      source,
      autoPasted: result.autoPasted,
    });
  } catch (error) {
    setStatus("error", `Falha na transcrição: ${error.message}`);
    window.localFlow.reportDictationEvent({
      type: "error",
      source,
      message: error.message,
    });
  } finally {
    chunks = [];
  }
}

recordButton.addEventListener("click", () => startRecording("manual"));
stopButton.addEventListener("click", () =>
  stopAndTranscribe(recordingSource),
);
copyButton.addEventListener("click", async () => {
  if (!resultText.value) return;
  await window.localFlow.copyText(resultText.value);
  resultMeta.textContent = "Texto copiado novamente.";
});
profileSelect.addEventListener("change", () => publishUiState());

for (const button of document.querySelectorAll("[data-demo-state]")) {
  button.addEventListener("click", () => {
    const demoState = button.dataset.demoState;
    window.localFlow.updateUiState({
      state: demoState,
      message: {
        recording: "Ouvindo…",
        processing: "Transcrevendo…",
        success: "Texto copiado",
        error: "Não foi possível transcrever",
      }[demoState],
      profile: profileSelect.value,
      elapsedMs: demoState === "recording" ? 8400 : 0,
      level: demoState === "recording" ? 0.68 : 0,
    });
  });
}

window.addEventListener("beforeunload", () => {
  microphoneStream?.getTracks().forEach((track) => track.stop());
});

window.localFlow.onDictationCommand(async (command) => {
  if (command?.action === "start") {
    if (["idle", "success", "error"].includes(state)) {
      await startRecording("shortcut");
    }
    return;
  }
  if (command?.action === "stop" && state === "recording") {
    await stopAndTranscribe("shortcut");
    return;
  }
  if (command?.action === "stop" && state === "requesting") {
    pendingShortcutStop = true;
    return;
  }
  if (command?.action === "cancel") {
    await cancelRecording(command.source);
  }
});

async function initialize() {
  try {
    const runtime = await window.localFlow.inspectRuntime();
    if (!runtime.whisperAvailable) {
      setStatus("error", "whisper-cli.exe não foi encontrado.");
      return;
    }

    for (const option of profileSelect.options) {
      const profile = runtime.profiles[option.value];
      option.disabled = !profile?.available;
    }
    if (!runtime.profiles.standard?.available) {
      const firstAvailable = [...profileSelect.options].find(
        (option) => !option.disabled,
      );
      if (firstAvailable) profileSelect.value = firstAvailable.value;
    }

    await settingsController.initialize(runtime.settings);
    if (
      new URLSearchParams(window.location.search).get(
        "settingsPreview",
      ) === "1"
    ) {
      document.querySelector(".advanced-panel").open = true;
    }
    shortcutKey.textContent = runtime.shortcut.display;
    shortcutDescription.textContent =
      runtime.shortcut.mode === "toggle"
        ? "Pressione uma vez para iniciar e novamente para transcrever."
        : "Segure para falar e solte para transcrever.";
    shortcutStatus.textContent = runtime.shortcut.registered
      ? "Ativo"
      : "Indisponível";
    shortcutStatus.classList.toggle(
      "error",
      !runtime.shortcut.registered,
    );
    if (runtime.shortcut.error) {
      shortcutDescription.textContent = runtime.shortcut.error;
    }

    setStatus("idle", "Pronto para gravar.");
    if (
      new URLSearchParams(window.location.search).get("selfTest") ===
      "microphone"
    ) {
      await runMicrophoneSelfTest();
    }
  } catch (error) {
    setStatus("error", `Falha ao iniciar: ${error.message}`);
  }
}

async function runMicrophoneSelfTest() {
  try {
    await startRecording();
    if (state !== "recording") {
      throw new Error(statusElement.textContent);
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const wav = buildWav();
    await stopAudioGraph();
    await window.localFlow.reportSelfTest({
      wavBytes: wav.byteLength,
      chunks: chunks.length,
      inputSampleRate: audioContext.sampleRate,
    });
  } catch (error) {
    await window.localFlow.reportSelfTest({
      error: error.message,
    });
  }
}

initialize();
