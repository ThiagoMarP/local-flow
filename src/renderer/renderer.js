import { joinAndEncode } from "./audio.js";
import { createSettingsController } from "./settings-controller.js";
import { createSetupController } from "./setup-controller.js";
import {
  isMeetingCapturing,
  startMeetingCapture,
  stopMeetingCapture,
} from "./meeting-recorder.js";
import { createMeetingsController } from "./meetings-controller.js";
import { recordingHint } from "./recording-hint.js";

const recordButton = document.querySelector("#recordButton");
const stopButton = document.querySelector("#stopButton");
const discardRecordingButton = document.querySelector("#discardRecordingButton");
const meetingStartButton = document.querySelector("#meetingStartButton");
const meetingStopButton = document.querySelector("#meetingStopButton");
const meetingStatusElement = document.querySelector("#meetingStatus");
const meetingTimerElement = document.querySelector("#meetingTimer");
const meetingShortcutHint = document.querySelector("#meetingShortcutHint");
const profileSelect = document.querySelector("#profileSelect");
const vocabularyInput = document.querySelector("#vocabularyInput");
const statusElement = document.querySelector("#status");
const timerElement = document.querySelector("#timer");
const meterFill = document.querySelector("#meterFill");
const lastMessageText = document.querySelector("#lastMessageText");
const lastMessageMeta = document.querySelector("#lastMessageMeta");
const copyLastButton = document.querySelector("#copyLastButton");
const copyLastOriginalButton = document.querySelector("#copyLastOriginalButton");
const lastMessagePanel = document.querySelector(".last-message-panel");
const historyList = document.querySelector("#historyList");
const historyCount = document.querySelector("#historyCount");
const historyClearButton = document.querySelector("#historyClearButton");
const historySearch = document.querySelector("#historySearch");
const statTotal = document.querySelector("#statTotal");
const statWords = document.querySelector("#statWords");
const statModel = document.querySelector("#statModel");
const navItems = [...document.querySelectorAll(".nav-item")];
const pages = [...document.querySelectorAll(".page")];
const modelsNavAlert = document.querySelector("#modelsNavAlert");
const meetingsController = createMeetingsController({
  listEl: document.querySelector("#meetingsList"),
  countEl: document.querySelector("#meetingsCount"),
  searchEl: document.querySelector("#meetingsSearch"),
});
const shortcutKey = document.querySelector("#shortcutKey");
const shortcutStatus = document.querySelector("#shortcutStatus");
const shortcutDescription = document.querySelector(
  "#shortcutDescription",
);
const microphoneSelect = document.querySelector("#microphoneSelect");
const shortcutSelect = document.querySelector("#shortcutSelect");
const meetingShortcutSelect = document.querySelector(
  "#meetingShortcutSelect",
);
const repasteShortcutSelect = document.querySelector(
  "#repasteShortcutSelect",
);
const meetingCaptureModeSelect = document.querySelector(
  "#meetingCaptureModeSelect",
);
const meetingProfileSelect = document.querySelector(
  "#meetingProfileSelect",
);
const meetingSummaryModelSelect = document.querySelector(
  "#meetingSummaryModelSelect",
);
const maxDurationSelect = document.querySelector("#maxDurationSelect");
const revisionModeSelect = document.querySelector(
  "#revisionModeSelect",
);
const revisionModelSelect = document.querySelector(
  "#revisionModelSelect",
);
const ollamaStatus = document.querySelector("#ollamaStatus");
const writingProfileSelect = document.querySelector(
  "#writingProfileSelect",
);
const replacementRulesInput = document.querySelector(
  "#replacementRulesInput",
);
const snippetRulesInput = document.querySelector(
  "#snippetRulesInput",
);
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
  meetingShortcutSelect,
  repasteShortcutSelect,
  meetingCaptureModeSelect,
  meetingProfileSelect,
  meetingSummaryModelSelect,
  maxDurationSelect,
  revisionModeSelect,
  revisionModelSelect,
  writingProfileSelect,
  replacementRulesInput,
  snippetRulesInput,
  autoPasteInput,
  restoreClipboardInput,
  launchAtLoginInput,
  startMinimizedInput,
  shortcutKey,
  shortcutStatus,
  settingsSaveStatus,
  ollamaStatus,
});

let availableProfileCount = 0;
let availableProfiles = {};
let meetingProfileAvailable = false;

function syncMeetingModelAvailability() {
  meetingProfileAvailable =
    availableProfiles[meetingProfileSelect.value]?.available === true;
  if (!meetingProfileAvailable && ["idle", "error", "setup-required"].includes(meetingPhase)) {
    setMeetingStatus(
      "setup-required",
      "Instale o modelo Whisper de reuniões em Modelos.",
    );
  } else if (meetingProfileAvailable && meetingPhase === "setup-required") {
    setMeetingStatus("idle", "Pronto para gravar.");
  } else {
    setMeetingStatus(meetingPhase, meetingStatusElement.textContent);
  }
}

function applyProfileAvailability(profiles) {
  if (!profiles) return;
  availableProfiles = profiles;
  availableProfileCount = Object.values(profiles).filter(
    (profile) => profile?.available,
  ).length;
  modelsNavAlert.hidden = availableProfileCount > 0;
  for (const option of profileSelect.options) {
    option.disabled = !profiles[option.value]?.available;
  }
  if (profiles[profileSelect.value]?.available === false) {
    const firstAvailable = [...profileSelect.options].find(
      (option) => !option.disabled,
    );
    if (firstAvailable) profileSelect.value = firstAvailable.value;
  }
  settingsController.syncSelectPickers();
  if (availableProfileCount > 0 && state === "setup-required") {
    setStatus("idle", "Pronto para gravar.");
  }
  syncMeetingModelAvailability();
}

const setupController = createSetupController({
  summaryStatus: document.querySelector("#setupSummaryStatus"),
  whisperEngineStatus: document.querySelector("#whisperEngineStatus"),
  modelsDirPath: document.querySelector("#modelsDirPath"),
  modelList: document.querySelector("#modelList"),
  onModelsChanged: applyProfileAvailability,
  onSetupRequired: () => showPage("models"),
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
let dictationGeneration = 0;
let activeRunId = null;
let transcriptionStarted = false;
let cancelRequestPending = false;
let deliveryCommitted = false;
// The last dictation left its text only on the clipboard (copied only, or the
// paste failed). One-shot: only the publish that announces the success carries
// it, so a later republish (e.g. a profile change) does not replay the notice.
let deliveryNeedsManualPaste = false;
// Last microphone level, so the 250 ms timer publish does not drop the capsule
// bars to zero between level samples.
let currentLevel = 0;
let showEscHint = false;
const ESC_HINT_KEY = "localFlow.escHintsShown";
const ESC_HINT_RECORDINGS = 20;

// "Esc cancela" is taught on the first recordings only; after that it would be
// noise. A per-install convenience, so storage failures just skip the hint.
function takeEscHint() {
  try {
    const shown = Number(window.localStorage.getItem(ESC_HINT_KEY)) || 0;
    if (shown >= ESC_HINT_RECORDINGS) return false;
    window.localStorage.setItem(ESC_HINT_KEY, String(shown + 1));
    return true;
  } catch {
    return false;
  }
}

function reportDictationEvent(event) {
  window.localFlow.reportDictationEvent({ runId: activeRunId, ...event });
}
let maxPeak = 0;
let speechFrameCount = 0;
let nativeHotkeyEnabled = false;
let meetingPhase = "idle";
let meetingTogglePending = false;
// Require sustained energy instead of trusting one peak: a click or automatic
// gain spike must not send an otherwise empty recording to Whisper and Ollama.
const NO_SPEECH_PEAK = 0.02;
const NO_SPEECH_RMS = 0.004;
const MIN_SPEECH_FRAMES = 5;

function capsuleState(nextState) {
  // While the mic is opening we already show the recording wave (not a
  // spinner), so the idle line → wave transition stays fluid with no flash.
  if (nextState === "requesting") return "recording";
  if (
    [
      "idle",
      "recording",
      "processing",
      "revising",
      "success",
      "error",
    ].includes(nextState)
  ) {
    return nextState;
  }
  return "idle";
}

// Recording and both post-recording stages lock the same controls: changing the
// model or vocabulary mid-flight would not affect the run already in progress.
function isBusyState(value) {
  return (
    value === "requesting" ||
    value === "recording" ||
    value === "discarding" ||
    value === "processing" ||
    value === "revising"
  );
}

function publishUiState(overrides = {}) {
  const manualPaste = state === "success" && deliveryNeedsManualPaste;
  deliveryNeedsManualPaste = false;
  const recording = state === "recording";
  const payload = {
    source: "dictation",
    state: capsuleState(state),
    message: statusElement.textContent,
    profile: profileSelect.value,
    runId: activeRunId,
    elapsedMs: recording ? Date.now() - recordingStartedAt : 0,
    level: recording ? currentLevel : 0,
    manualPaste,
    ...overrides,
  };
  if (recording) {
    Object.assign(payload, recordingHint({
      elapsedMs: payload.elapsedMs,
      limitMs: (settingsController.get()?.maxRecordingSeconds || 0) * 1000,
      heardSound: maxPeak >= NO_SPEECH_PEAK,
      showEscHint,
    }));
  }
  // Main tracks dictation independently and preserves the meeting capsule
  // while a meeting is being captured.
  window.localFlow.updateUiState(payload);
}

function setStatus(nextState, message) {
  state = nextState;
  statusElement.textContent = message;
  const isIdle =
    state === "idle" || state === "success" || state === "error";
  const busy = isBusyState(state);
  recordButton.disabled = !isIdle || isMeetingCapturing();
  stopButton.disabled = state !== "recording";
  discardRecordingButton.disabled = deliveryCommitted || ![
    "requesting",
    "recording",
    "processing",
    "revising",
  ].includes(state);
  profileSelect.disabled = busy;
  vocabularyInput.disabled = busy;
  settingsController.setDisabled(busy);
  setupController.setDisabled(busy);
  setMeetingStatus(meetingPhase, meetingStatusElement.textContent);
  publishUiState();
}

function setMeetingStatus(nextPhase, message) {
  meetingPhase = nextPhase;
  meetingStatusElement.textContent = message;
  meetingStartButton.disabled =
    meetingTogglePending ||
    !meetingProfileAvailable ||
    !["idle", "processing", "error"].includes(nextPhase) ||
    state === "recording" ||
    state === "requesting";
  meetingStopButton.disabled =
    meetingTogglePending || nextPhase !== "recording";
  recordButton.disabled =
    meetingTogglePending ||
    ["starting", "recording", "stopping"].includes(nextPhase) ||
    isMeetingCapturing() ||
    !["idle", "success", "error"].includes(state);
}

function meetingErrorMessage(error) {
  return String(error?.message || error)
    .replace(/^Error invoking remote method '[^']*':\s*/i, "")
    .replace(/^(Uncaught )?Error:\s*/i, "");
}

function formatTimestamp(at) {
  if (!at) return "";
  try {
    return new Date(at).toLocaleString("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return "";
  }
}

let lastMessageRestMeta = "Nenhuma transcrição ainda.";
let copyFeedbackTimer;
let lastOriginalText = null;
let lastMessageId = null;

function setLastMessage(record) {
  lastMessageId = record?.id || null;
  window.clearTimeout(copyFeedbackTimer);
  if (!record?.text) {
    lastMessageText.value = "";
    lastOriginalText = null;
    copyLastOriginalButton.hidden = true;
    lastMessageRestMeta = "Nenhuma transcrição ainda.";
    lastMessageMeta.textContent = lastMessageRestMeta;
    copyLastButton.disabled = true;
    return;
  }
  lastMessageText.value = record.correctedText || record.text;
  lastOriginalText = record.originalText && record.originalText !== record.text
    ? record.originalText
    : null;
  copyLastOriginalButton.hidden = !lastOriginalText;
  copyLastButton.disabled = false;
  const stamp = formatTimestamp(record.at);
  lastMessageRestMeta = stamp
    ? `Gravado em ${stamp}`
    : "Última transcrição.";
  lastMessageMeta.textContent = lastMessageRestMeta;
}

function setLastMessageDelivery(note) {
  if (!note) return;
  lastMessageRestMeta = `${lastMessageRestMeta} · ${note}`;
  lastMessageMeta.textContent = lastMessageRestMeta;
}

// Clicking anywhere on the card copies the last message, so a quick Ctrl+V
// pastes it — the button is just a visible affordance for the same action.
async function copyLastMessage() {
  if (!lastMessageText.value) return;
  await window.localFlow.copyText(lastMessageText.value);
  lastMessageMeta.textContent = "Copiado — é só dar Ctrl + V.";
  window.clearTimeout(copyFeedbackTimer);
  copyFeedbackTimer = window.setTimeout(() => {
    lastMessageMeta.textContent = lastMessageRestMeta;
  }, 1800);
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
  const generation = ++dictationGeneration;
  const runId = window.crypto.randomUUID();
  activeRunId = runId;
  transcriptionStarted = false;
  deliveryCommitted = false;
  let openingStream;
  let openingContext;
  try {
    recordingSource = source;
    maxDurationStopRequested = false;
    maxPeak = 0;
    speechFrameCount = 0;
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
    const attempts = [{ audio: audioOptions }];
    if (audioOptions.deviceId) {
      attempts.push({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    }
    // Some Windows USB drivers reject Chromium's processing constraints with
    // "Could not start audio source". The final attempt requests the default
    // input without optional processing, which is broadly compatible.
    attempts.push({ audio: true });
    let microphoneError;
    for (const constraints of attempts) {
      try {
        const acquiredStream = await navigator.mediaDevices.getUserMedia(
          constraints,
        );
        if (generation !== dictationGeneration) {
          acquiredStream.getTracks().forEach((track) => track.stop());
          return;
        }
        openingStream = acquiredStream;
        microphoneError = null;
        break;
      } catch (error) {
        if (generation !== dictationGeneration) return;
        microphoneError = error;
        if (error.name === "NotAllowedError") break;
        await new Promise((resolve) => window.setTimeout(resolve, 180));
      }
    }
    if (!openingStream) throw microphoneError;

    openingContext = new AudioContext();
    const nextSourceNode = openingContext.createMediaStreamSource(openingStream);
    // AudioWorklet replaces the deprecated ScriptProcessorNode: capture runs on
    // the audio thread and posts buffered PCM frames (with their peak) here, so
    // a busy main thread can't cause dropouts. A fresh context each recording
    // means addModule registers the processor exactly once per context.
    await openingContext.audioWorklet.addModule("./capture-worklet.js");
    if (generation !== dictationGeneration) return;
    const nextProcessorNode = new AudioWorkletNode(openingContext, "capture-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
    });
    const nextSilentGain = openingContext.createGain();
    nextSilentGain.gain.value = 0;
    microphoneStream = openingStream;
    audioContext = openingContext;
    sourceNode = nextSourceNode;
    processorNode = nextProcessorNode;
    silentGain = nextSilentGain;
    openingStream = undefined;
    openingContext = undefined;
    chunks = [];

    processorNode.port.onmessage = (event) => {
      if (state !== "recording" || generation !== dictationGeneration) return;
      const { samples, peak, rms = 0 } = event.data;
      chunks.push(samples);
      if (peak > maxPeak) maxPeak = peak;
      if (peak >= NO_SPEECH_PEAK && rms >= NO_SPEECH_RMS) {
        speechFrameCount += 1;
      }
      // Square-root curve + gain: lifts a normal speaking volume into a lively
      // range instead of only reacting to loud speech, while silence stays low.
      const level = Math.min(1, Math.pow(peak, 0.5) * 2);
      currentLevel = level;
      meterFill.style.width = `${Math.min(100, 4 + level * 96)}%`;
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
    currentLevel = 0;
    showEscHint = takeEscHint();
    timerElement.textContent = "00:00";
    timerInterval = window.setInterval(updateTimer, 250);
    setStatus("recording", "Ouvindo…");
    reportDictationEvent({
      type: "started",
      source: recordingSource,
    });
    if (pendingShortcutStop) {
      pendingShortcutStop = false;
      await stopAndTranscribe("shortcut");
    }
  } catch (error) {
    if (generation !== dictationGeneration) return;
    await stopAudioGraph();
    if (generation !== dictationGeneration) return;
    const microphoneMessage =
      error?.name === "NotAllowedError"
        ? "A permissão foi bloqueada. Abra Configurações do Windows > Privacidade e segurança > Microfone e permita o Local Flow."
        : error?.name === "NotFoundError"
          ? "Nenhum microfone foi encontrado pelo Windows."
          : error?.message || "não foi possível iniciar a fonte de áudio";
    setStatus(
      "error",
      `Não foi possível acessar o microfone: ${microphoneMessage}`,
    );
    reportDictationEvent({
      type: "error",
      source: recordingSource,
      message: error.message,
    });
  } finally {
    openingStream?.getTracks().forEach((track) => track.stop());
    if (openingContext && openingContext.state !== "closed") {
      await openingContext.close().catch(() => {});
    }
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

async function cancelRecording(reason = "cancelled", acceptedByMain = false) {
  if (!["requesting", "recording", "processing", "revising"].includes(state)) {
    return false;
  }
  if (deliveryCommitted) return false;
  const generation = dictationGeneration;
  const wasProcessing = state === "processing" || state === "revising";
  if (wasProcessing && transcriptionStarted && !acceptedByMain) {
    if (cancelRequestPending) return false;
    cancelRequestPending = true;
    let cancellation;
    try {
      cancellation = await window.localFlow.cancelTranscription(activeRunId);
    } catch (error) {
      if (generation === dictationGeneration && isBusyState(state)) {
        setStatus(state, `Não foi possível cancelar: ${error.message}`);
      }
      return false;
    } finally {
      cancelRequestPending = false;
    }
    if (generation !== dictationGeneration) return true;
    if (!["processing", "revising"].includes(state)) return true;
    if (!cancellation?.accepted) {
      if (cancellation?.reason === "already-delivering" && isBusyState(state)) {
        deliveryCommitted = true;
        setStatus(state, "Finalizando a colagem…");
      }
      return false;
    }
  }
  if (generation !== dictationGeneration) return true;
  dictationGeneration += 1;
  transcriptionStarted = false;
  pendingShortcutStop = false;
  maxDurationStopRequested = false;
  // Invalidate the run before waiting for AudioContext.close(). A stop or a
  // late model result must not turn a cancelled dictation into a paste.
  setStatus("discarding", wasProcessing ? "Cancelando ditado…" : "Descartando gravação…");
  try {
    if (!wasProcessing) await stopAudioGraph();
  } finally {
    chunks = [];
    timerElement.textContent = "00:00";
    setStatus("idle", wasProcessing ? "Ditado cancelado." : "Gravação descartada.");
    reportDictationEvent({
      type: "cancelled",
      source: reason,
    });
  }
  return true;
}

async function stopAndTranscribe(source = recordingSource) {
  const generation = dictationGeneration;
  const runId = activeRunId;
  if (state !== "recording") {
    // Nothing to stop (the start was dropped, or a previous run is still
    // settling). Tell main so a shortcut-driven session doesn't stay wedged.
    if (source === "shortcut") {
      reportDictationEvent({ type: "cancelled", source });
    }
    return;
  }
  // Fast no-speech check: if the recording never crossed the speech threshold,
  // skip the whole transcription (model load + inference) and answer instantly
  // instead of making the user wait through a "loading" cycle for silence.
  if (maxPeak < NO_SPEECH_PEAK || speechFrameCount < MIN_SPEECH_FRAMES) {
    await stopAudioGraph();
    if (generation !== dictationGeneration) return;
    chunks = [];
    maxDurationStopRequested = false;
    setStatus("idle", "Nada detectado — fale algo.");
    reportDictationEvent({
      type: "cancelled",
      source,
      reason: "no-speech",
    });
    return;
  }
  setStatus("processing", "Preparando o áudio…");
  const wav = buildWav();
  await stopAudioGraph();
  if (generation !== dictationGeneration) return;

  if (wav.byteLength <= 44) {
    setStatus("error", "Nenhum áudio foi capturado.");
    reportDictationEvent({
      type: "error",
      source,
      message: "Nenhum áudio foi capturado.",
    });
    return;
  }

  try {
    setStatus("processing", "Transcrevendo localmente…");
    const vocabulary = vocabularyInput.value
      .split(",")
      .map((term) => term.trim())
      .filter(Boolean);
    const settingsDraft = settingsController.getDraft();
    transcriptionStarted = true;
    const result = await window.localFlow.transcribe({
      runId,
      audio: wav,
      profile: profileSelect.value,
      vocabulary,
      revisionMode: revisionModeSelect.value,
      revisionModel: revisionModelSelect.value,
      writingProfile: writingProfileSelect.value,
      replacements: settingsDraft.replacements,
      snippets: settingsDraft.snippets,
    });
    if (generation !== dictationGeneration || runId !== activeRunId) return;
    transcriptionStarted = false;
    setLastMessage({
      id: result.historyId,
      text: result.text,
      originalText: result.originalText !== result.text ? result.originalText : null,
      at: Date.now(),
    });
    loadHistory();
    const copiedOnly =
      result.reason === "auto-paste-disabled" ||
      result.reason === "manual-recording";
    const deliveryMessage = result.autoPasted
      ? "Colagem enviada; confira o campo."
      : copiedOnly
        ? "Transcrição concluída e copiada."
        : "Não consegui colar; use Ctrl+V.";
    const deliveryNote = result.autoPasted
      ? result.clipboardRestored
        ? "Se faltar, clique em Copiar e use Ctrl+V."
        : "Texto também copiado; use Ctrl+V se faltar."
      : copiedOnly
        ? "Use Ctrl+V para inserir."
        : "Texto copiado; use Ctrl+V para inserir.";
    setLastMessageDelivery(
      result.revision?.fallback
        ? `${deliveryNote} Revisão não aplicada; texto original mantido.`
        : deliveryNote,
    );
    deliveryNeedsManualPaste = !result.autoPasted;
    setStatus(
      "success",
      deliveryMessage,
    );
    reportDictationEvent({
      type: "completed",
      source,
      autoPasted: result.autoPasted,
    });
  } catch (error) {
    if (generation !== dictationGeneration || runId !== activeRunId) return;
    transcriptionStarted = false;
    if (
      error?.name === "AbortError" ||
      error?.code === "ABORT_ERR" ||
      /\b(?:AbortError|ABORT_ERR)\b/.test(String(error?.message || error))
    ) {
      chunks = [];
      timerElement.textContent = "00:00";
      setStatus("idle", "Ditado cancelado.");
      reportDictationEvent({ type: "cancelled", source });
      return;
    }
    // Electron wraps handler rejections as "Error invoking remote method
    // 'transcription:run': Error: <real message>". Strip that noise so the
    // capsule shows the actionable message we actually threw.
    const message = String(error?.message || error)
      .replace(/^Error invoking remote method '[^']*':\s*/i, "")
      .replace(/^(Uncaught )?Error:\s*/i, "");
    setStatus("error", `Falha na transcrição: ${message}`);
    reportDictationEvent({
      type: "error",
      source,
      message,
    });
  } finally {
    if (generation === dictationGeneration) chunks = [];
  }
}

recordButton.addEventListener("click", () => startRecording("manual"));
stopButton.addEventListener("click", () =>
  stopAndTranscribe(recordingSource),
);
discardRecordingButton.addEventListener("click", () => {
  cancelRecording("manual");
});
window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || event.repeat || deliveryCommitted) return;
  if (!["requesting", "recording", "processing", "revising"].includes(state)) return;
  event.preventDefault();
  event.stopPropagation();
  cancelRecording("escape");
}, true);
lastMessagePanel.addEventListener("click", copyLastMessage);
copyLastOriginalButton.addEventListener("click", async (event) => {
  event.stopPropagation();
  if (!lastOriginalText) return;
  await window.localFlow.copyText(lastOriginalText);
  lastMessageMeta.textContent = "Original copiado — use Ctrl + V.";
  window.clearTimeout(copyFeedbackTimer);
  copyFeedbackTimer = window.setTimeout(() => {
    lastMessageMeta.textContent = lastMessageRestMeta;
  }, 1800);
});

function historyDayLabel(at) {
  if (!at) return "";
  const date = new Date(at);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(date, today)) return "Hoje";
  if (sameDay(date, yesterday)) return "Ontem";
  return date.toLocaleDateString("pt-BR");
}

function historyDisplayText(item) {
  return item.correctedText || item.text;
}

let openHistoryEditor = null;

function createHistoryEditor(item, textNode, deliveredButton) {
  const editor = document.createElement("section");
  editor.className = "history-editor";
  const label = document.createElement("label");
  label.className = "history-editor-label";
  label.textContent = "Corrigir este ditado";
  const input = document.createElement("textarea");
  input.className = "history-editor-text";
  input.rows = 4;
  input.maxLength = 20000;
  input.value = historyDisplayText(item);
  label.append(input);
  const correctionHint = document.createElement("p");
  correctionHint.className = "history-editor-hint";
  correctionHint.textContent = "A correção altera o histórico. Se o texto já foi colado, copie a versão corrigida e substitua no campo.";

  const actions = document.createElement("div");
  actions.className = "history-editor-actions";
  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "button secondary tiny";
  saveButton.textContent = "Salvar correção";
  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "button tiny";
  copyButton.textContent = "Salvar e copiar";
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "button secondary tiny";
  closeButton.textContent = "Fechar";
  actions.append(saveButton, copyButton, closeButton);

  const ruleDetails = document.createElement("details");
  ruleDetails.className = "history-rule";
  const ruleSummary = document.createElement("summary");
  ruleSummary.textContent = "Criar regra para próximos ditados (opcional)";
  const ruleHint = document.createElement("p");
  ruleHint.textContent = "Informe só o trecho que costuma sair errado e como ele deve ficar. A regra vale para futuros ditados.";
  const ruleFields = document.createElement("div");
  ruleFields.className = "history-rule-fields";
  const fromLabel = document.createElement("label");
  fromLabel.textContent = "Trecho errado";
  const fromInput = document.createElement("input");
  fromInput.type = "text";
  fromInput.maxLength = 120;
  fromLabel.append(fromInput);
  const toLabel = document.createElement("label");
  toLabel.textContent = "Trecho correto (vazio remove)";
  const toInput = document.createElement("input");
  toInput.type = "text";
  toInput.maxLength = 500;
  toLabel.append(toInput);
  const addRuleButton = document.createElement("button");
  addRuleButton.type = "button";
  addRuleButton.className = "button secondary tiny";
  addRuleButton.textContent = "Adicionar substituição";
  ruleFields.append(fromLabel, toLabel, addRuleButton);
  ruleDetails.append(ruleSummary, ruleHint, ruleFields);

  const feedback = document.createElement("p");
  feedback.className = "history-editor-feedback";
  feedback.setAttribute("role", "status");
  const setFeedback = (message, error = false) => {
    feedback.textContent = message;
    feedback.classList.toggle("error", error);
  };
  async function saveCorrection() {
    saveButton.disabled = true;
    copyButton.disabled = true;
    try {
      const saved = await window.localFlow.saveTranscriptionCorrection(item.id, input.value);
      Object.assign(item, saved);
      textNode.textContent = historyDisplayText(item);
      deliveredButton.hidden = !item.correctedText;
      if (lastMessageId && lastMessageId === item.id) setLastMessage(item);
      setFeedback("Correção salva no histórico.");
      return true;
    } catch (error) {
      setFeedback(error?.message || "Não foi possível salvar a correção.", true);
      return false;
    } finally {
      saveButton.disabled = false;
      copyButton.disabled = false;
    }
  }
  saveButton.addEventListener("click", saveCorrection);
  copyButton.addEventListener("click", async () => {
    if (!(await saveCorrection())) return;
    try {
      await window.localFlow.copyText(historyDisplayText(item));
      setFeedback("Correção salva e copiada.");
    } catch (error) {
      setFeedback(error?.message || "Correção salva, mas não foi possível copiar.", true);
    }
  });
  closeButton.addEventListener("click", () => {
    editor.remove();
    openHistoryEditor = null;
  });
  addRuleButton.addEventListener("click", async () => {
    addRuleButton.disabled = true;
    try {
      await settingsController.addReplacementRule(fromInput.value, toInput.value);
      setFeedback("Regra salva. Será aplicada aos próximos ditados.");
    } catch (error) {
      setFeedback(error?.message || "Não foi possível salvar a regra.", true);
    } finally {
      addRuleButton.disabled = false;
    }
  });
  editor.append(label, correctionHint, actions, ruleDetails, feedback);
  return { editor, input };
}

function renderHistory(items) {
  openHistoryEditor = null;
  historyCount.textContent = String(items.length);
  historyList.replaceChildren();
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = "Nenhuma transcrição ainda. Dite com o atalho e o texto aparece aqui.";
    historyList.append(empty);
    historyClearButton.disabled = true;
    return;
  }
  historyClearButton.disabled = false;
  let lastDay = null;
  for (const item of items) {
    const day = historyDayLabel(item.at);
    if (day && day !== lastDay) {
      lastDay = day;
      const header = document.createElement("p");
      header.className = "history-day";
      header.textContent = day;
      historyList.append(header);
    }
    const stamp = item.at
      ? new Date(item.at).toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "history-item";
    button.title = "Clique para copiar a versão atual";
    const text = document.createElement("span");
    text.className = "history-item-text";
    text.textContent = historyDisplayText(item);
    const time = document.createElement("span");
    time.className = "history-item-time";
    time.textContent = stamp;
    button.append(text, time);
    button.addEventListener("click", async () => {
      await window.localFlow.copyText(historyDisplayText(item));
      button.classList.add("copied");
      time.textContent = "copiado!";
      window.setTimeout(() => {
        button.classList.remove("copied");
        time.textContent = stamp;
      }, 1500);
    });
    const row = document.createElement("div");
    row.className = "history-row";
    row.append(button);
    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "history-secondary-button";
    editButton.textContent = "Editar";
    editButton.addEventListener("click", () => {
      if (openHistoryEditor?.id === item.id) {
        openHistoryEditor.editor.remove();
        openHistoryEditor = null;
        return;
      }
      openHistoryEditor?.editor.remove();
      const { editor, input } = createHistoryEditor(item, text, deliveredButton);
      row.after(editor);
      openHistoryEditor = { id: item.id, editor };
      input.focus();
    });
    row.append(editButton);
    const deliveredButton = document.createElement("button");
    deliveredButton.type = "button";
    deliveredButton.className = "history-secondary-button";
    deliveredButton.textContent = "Copiar inicial";
    deliveredButton.title = "Copiar o texto salvo antes da primeira correção manual";
    deliveredButton.hidden = !item.correctedText;
    deliveredButton.addEventListener("click", async () => {
      await window.localFlow.copyText(item.text);
      deliveredButton.textContent = "Inicial copiado!";
      window.setTimeout(() => { deliveredButton.textContent = "Copiar inicial"; }, 1500);
    });
    row.append(deliveredButton);
    if (item.originalText && item.originalText !== item.text) {
      const originalButton = document.createElement("button");
      originalButton.type = "button";
      originalButton.className = "history-secondary-button";
      originalButton.textContent = "Copiar bruto";
      originalButton.title = "Copiar a transcrição antes da revisão e das substituições";
      originalButton.addEventListener("click", async () => {
        await window.localFlow.copyText(item.originalText);
        originalButton.textContent = "Bruto copiado!";
        window.setTimeout(() => { originalButton.textContent = "Copiar bruto"; }, 1500);
      });
      row.append(originalButton);
    }
    historyList.append(row);
  }
}

let allHistory = [];
let historyLoadGeneration = 0;

function profileLabel(value) {
  return (
    {
      fast: "Small",
      standard: "Medium",
      accurate: "Large V3 Turbo",
      parakeet: "Parakeet v3",
    }[value] || "—"
  );
}

// The dictation model shows by name on Início and is marked "Em uso" on the
// Modelos page.
function showActiveModel() {
  if (statModel) statModel.textContent = profileLabel(profileSelect.value);
  for (const item of document.querySelectorAll(".model-item")) {
    item.dataset.active = String(item.dataset.profile === profileSelect.value);
  }
}

function renderStats(items) {
  if (statTotal) statTotal.textContent = String(items.length);
  if (statWords) {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const words = items
      .filter((item) => (item.at || 0) >= weekAgo)
      .reduce(
        (sum, item) =>
          sum + item.text.trim().split(/\s+/).filter(Boolean).length,
        0,
      );
    statWords.textContent = words.toLocaleString("pt-BR");
  }
  showActiveModel();
}

function applyHistoryFilter() {
  const query = (historySearch?.value || "").trim().toLowerCase();
  const items = query
    ? allHistory.filter((item) =>
        [historyDisplayText(item), item.text, item.originalText]
          .filter(Boolean)
          .some((text) => text.toLowerCase().includes(query)))
    : allHistory;
  renderHistory(items);
}

async function loadHistory() {
  const generation = ++historyLoadGeneration;
  const items = await window.localFlow.getTranscriptionHistory();
  if (generation !== historyLoadGeneration) return null;
  allHistory = Array.isArray(items) ? items : [];
  renderStats(allHistory);
  applyHistoryFilter();
  return allHistory;
}

historySearch?.addEventListener("input", applyHistoryFilter);

// Sidebar navigation: show one page at a time.
function showPage(name) {
  if (name !== "settings") settingsController.closeRevisionPicker();
  for (const item of navItems) {
    item.classList.toggle("active", item.dataset.page === name);
  }
  for (const page of pages) {
    page.hidden = page.dataset.page !== name;
  }
  if (name === "models") showActiveModel();
  // Recarrega as reuniões ao abrir a página (uma captura pode ter ocorrido).
  if (name === "meetings") meetingsController.refresh().catch(() => {});
}
for (const item of navItems) {
  item.addEventListener("click", () => showPage(item.dataset.page));
}
// Section shortcuts at the top of Settings. Buttons, not #anchors: a hash
// change is a navigation, which main treats as the renderer being interrupted.
for (const button of document.querySelectorAll(".section-nav [data-section]")) {
  button.addEventListener("click", () => {
    document.getElementById(button.dataset.section)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}
window.localFlow.onRevisionModeChanged((mode) => {
  settingsController.applyRevisionMode(mode);
});
window.localFlow.onNavigate((page) => {
  if (navItems.some((item) => item.dataset.page === page)) showPage(page);
});

function selectedShortcutLabel(select) {
  return select.selectedOptions[0]?.textContent || "indisponível";
}

shortcutSelect.addEventListener("change", () => {
  const label = selectedShortcutLabel(shortcutSelect);
  if (nativeHotkeyEnabled) {
    shortcutDescription.textContent =
      `Toque duas vezes para fixar a gravação ou segure para ditar. ` +
      `Alternativa: ${label}.`;
  } else {
    shortcutKey.textContent = label;
  }
});
meetingShortcutSelect.addEventListener("change", () => {
  meetingShortcutHint.textContent = selectedShortcutLabel(meetingShortcutSelect);
});
meetingProfileSelect.addEventListener("change", syncMeetingModelAvailability);

let historyClearArmed = false;
historyClearButton.addEventListener("click", async () => {
  if (!historyClearArmed) {
    historyClearArmed = true;
    historyClearButton.textContent = "Confirmar limpeza?";
    window.setTimeout(() => {
      historyClearArmed = false;
      historyClearButton.textContent = "Limpar histórico";
    }, 3000);
    return;
  }
  historyClearArmed = false;
  historyClearButton.textContent = "Limpar histórico";
  await window.localFlow.clearTranscriptionHistory();
  setLastMessage(null);
  const remaining = await loadHistory();
  if (!lastMessageId && remaining?.[0]) setLastMessage(remaining[0]);
});
profileSelect.addEventListener("change", () => {
  publishUiState();
  showActiveModel();
});

window.addEventListener("beforeunload", () => {
  microphoneStream?.getTracks().forEach((track) => track.stop());
});

window.localFlow.onDictationCommand(async (command) => {
  if (command?.action === "start") {
    if (["idle", "success", "error"].includes(state)) {
      await startRecording("shortcut");
    } else if (state !== "recording" && state !== "requesting") {
      // Busy with something we can't interrupt (e.g. a transcription). Let main
      // reset so its state machine doesn't drift away from ours.
      reportDictationEvent({
        type: "cancelled",
        source: "shortcut",
      });
    }
    return;
  }
  if (command?.action === "stop") {
    if (state === "recording") {
      await stopAndTranscribe("shortcut");
    } else if (state === "requesting") {
      pendingShortcutStop = true;
    } else {
      // A stop arrived but there's nothing to stop. Acknowledge so main can
      // release the shortcut instead of staying stuck waiting for a result.
      reportDictationEvent({
        type: "cancelled",
        source: "shortcut",
      });
    }
    return;
  }
  if (command?.action === "cancel") {
    if (command.runId && command.runId !== activeRunId) return;
    await cancelRecording(command.source, true);
  }
});

async function runMeetingCommand(command) {
  if (command?.action === "start") {
    setMeetingStatus("starting", "Abrindo as fontes de áudio…");
    meetingTimerElement.textContent = "00:00";
    try {
      await startMeetingCapture({
        microphoneId: settingsController.get()?.microphoneId,
        mode: settingsController.get()?.meetingCaptureMode,
      });
      if (isMeetingCapturing()) {
        setMeetingStatus("recording", "Gravando reunião…");
      } else {
        setMeetingStatus("error", "Não foi possível iniciar a reunião.");
      }
    } catch (error) {
      setMeetingStatus(
        "error",
        `Não foi possível iniciar a reunião: ${meetingErrorMessage(error)}`,
      );
    }
  } else if (command?.action === "stop") {
    setMeetingStatus("stopping", "Salvando a gravação…");
    try {
      const saved = await stopMeetingCapture();
      if (saved) {
        if (meetingPhase === "stopping") {
          setMeetingStatus(
            "processing",
            "Gravação salva. Transcrevendo e resumindo em segundo plano…",
          );
        }
        await meetingsController.refresh().catch(() => {});
      } else {
        setMeetingStatus("idle", "Nenhuma reunião em gravação.");
      }
    } catch (error) {
      setMeetingStatus(
        "error",
        `Não foi possível salvar a reunião: ${meetingErrorMessage(error)}`,
      );
    }
  }
}

let meetingCommandQueue = Promise.resolve();
window.localFlow.onMeetingCommand((command) => {
  // Stop can arrive while Windows is still opening a microphone or a display.
  // Preserve command order so it cannot overtake start.
  meetingCommandQueue = meetingCommandQueue
    .then(() => runMeetingCommand(command))
    .catch((error) => {
      setMeetingStatus(
        "error",
        `Falha ao controlar a reunião: ${meetingErrorMessage(error)}`,
      );
    });
});

async function requestMeetingToggle(desiredAction) {
  if (meetingTogglePending) return;
  meetingTogglePending = true;
  setMeetingStatus(meetingPhase, meetingStatusElement.textContent);
  try {
    const result = await window.localFlow.toggleMeetingCapture(desiredAction);
    if (!result?.ok) {
      const message = result?.reason || "Não foi possível alterar a gravação.";
      setMeetingStatus(
        isMeetingCapturing() ? "recording" : "error",
        message === "dictation-active"
          ? "Finalize o ditado antes de iniciar a reunião."
          : message,
      );
    }
  } catch (error) {
    setMeetingStatus(
      isMeetingCapturing() ? "recording" : "error",
      `Falha ao controlar a reunião: ${meetingErrorMessage(error)}`,
    );
  } finally {
    meetingTogglePending = false;
    setMeetingStatus(meetingPhase, meetingStatusElement.textContent);
  }
}

meetingStartButton.addEventListener("click", () => requestMeetingToggle("start"));
meetingStopButton.addEventListener("click", () => requestMeetingToggle("stop"));

window.localFlow.onUiState((next) => {
  if (next?.state === "meeting") {
    meetingTimerElement.textContent = formatDuration(next.elapsedMs || 0);
  }
});

window.localFlow.onMeetingStatus?.((update) => {
  if (!update) return;
  if (update.current !== false && !isMeetingCapturing()) {
    if (update.state === "processing") {
      setMeetingStatus(
        "processing",
        update.message || "Processando reunião em segundo plano…",
      );
    } else if (update.state === "success") {
      setMeetingStatus("idle", update.message || "Reunião concluída.");
    } else if (update.state === "partial") {
      setMeetingStatus("error", update.message || "A transcrição da reunião ficou parcial.");
    } else if (update.state === "error") {
      setMeetingStatus(
        "error",
        update.message || "A reunião foi salva, mas não pôde ser transcrita.",
      );
    }
  }
  meetingsController.refresh().catch(() => {});
});

window.localFlow.onTranscriptionProgress((progress) => {
  // Only advance a run that is already in flight, and only forwards
  // (transcribing → revising) so a late event can never rewind the capsule.
  if (
    !transcriptionStarted ||
    !activeRunId ||
    progress?.runId !== activeRunId ||
    !["processing", "revising"].includes(state)
  ) return;
  if (progress?.stage === "delivering") {
    deliveryCommitted = true;
    setStatus("processing", "Finalizando a colagem…");
  } else if (progress?.stage === "revising") {
    setStatus(
      "revising",
      progress.mode === "fast"
        ? "Aplicando limpeza rápida…"
        : progress.mode === "light"
          ? "Aplicando limpeza leve…"
          : "Revisando com o Ollama local…",
    );
  } else if (progress?.stage === "transcribing" && state !== "revising") {
    setStatus("processing", "Transcrevendo localmente…");
  }
});

async function initialize() {
  try {
    const runtime = await window.localFlow.inspectRuntime();
    await setupController.refresh();
    setLastMessage(await window.localFlow.getLastTranscription());
    await loadHistory();
    if (!runtime.whisperAvailable && !runtime.parakeetAvailable) {
      setStatus(
        "error",
        "Nenhum mecanismo de transcrição foi encontrado. Reinstale o aplicativo.",
      );
      return;
    }

    applyProfileAvailability(runtime.profiles);

    await settingsController.initialize(
      runtime.settings,
      runtime.revision,
    );
    // Settings can restore a profile after the first readiness pass. Apply the
    // model constraints again so an unavailable saved profile is never used.
    applyProfileAvailability(runtime.profiles);
    showActiveModel();
    meetingShortcutHint.textContent = selectedShortcutLabel(meetingShortcutSelect);
    syncMeetingModelAvailability();
    const hotkey = runtime.hotkey || {};
    nativeHotkeyEnabled = Boolean(hotkey.enabled);
    if (hotkey.enabled) {
      shortcutKey.textContent = hotkey.display;
      shortcutDescription.textContent =
        `Toque duas vezes para fixar a gravação ou segure para ditar. ` +
        `Alternativa: ${runtime.shortcut.display}.`;
      shortcutStatus.textContent = hotkey.ready ? "Ativo" : "Iniciando…";
      shortcutStatus.classList.toggle("error", false);
    } else {
      shortcutKey.textContent = runtime.shortcut.display;
      shortcutDescription.textContent =
        runtime.shortcut.mode === "toggle"
          ? "Pressione uma vez para iniciar e novamente para transcrever."
          : "Segure para falar e solte para transcrever.";
      shortcutStatus.textContent = runtime.shortcut.registered
        ? "Ativo"
        : "Indisponível";
      shortcutStatus.classList.toggle("error", !runtime.shortcut.registered);
      if (runtime.shortcut.error) {
        shortcutDescription.textContent = runtime.shortcut.error;
      }
    }

    if (availableProfileCount === 0) {
      showPage("models");
      setStatus(
        "setup-required",
        "Baixe um modelo de voz para começar.",
      );
    } else {
      setStatus("idle", "Pronto para gravar.");
    }
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
