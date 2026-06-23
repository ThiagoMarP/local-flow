import { joinAndEncode } from "./audio.js";

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

let audioContext;
let sourceNode;
let processorNode;
let silentGain;
let microphoneStream;
let chunks = [];
let recordingStartedAt = 0;
let timerInterval;
let state = "booting";

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
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function updateTimer() {
  timerElement.textContent = formatDuration(Date.now() - recordingStartedAt);
}

function buildWav() {
  return joinAndEncode(chunks, audioContext.sampleRate, 16000);
}

async function startRecording() {
  try {
    setStatus("requesting", "Solicitando acesso ao microfone…");
    microphoneStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

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
      meterFill.style.width = `${Math.min(100, 4 + peak * 250)}%`;
    };

    sourceNode.connect(processorNode);
    processorNode.connect(silentGain);
    silentGain.connect(audioContext.destination);

    recordingStartedAt = Date.now();
    timerElement.textContent = "00:00";
    timerInterval = window.setInterval(updateTimer, 250);
    setStatus("recording", "Ouvindo…");
  } catch (error) {
    await stopAudioGraph();
    setStatus(
      "error",
      `Não foi possível acessar o microfone: ${error.message}`,
    );
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

async function stopAndTranscribe() {
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
      "copiado para o clipboard";
    setStatus("success", "Transcrição concluída e copiada.");
  } catch (error) {
    setStatus("error", `Falha na transcrição: ${error.message}`);
  } finally {
    chunks = [];
  }
}

recordButton.addEventListener("click", startRecording);
stopButton.addEventListener("click", stopAndTranscribe);
copyButton.addEventListener("click", async () => {
  if (!resultText.value) return;
  await window.localFlow.copyText(resultText.value);
  resultMeta.textContent = "Texto copiado novamente.";
});

window.addEventListener("beforeunload", () => {
  microphoneStream?.getTracks().forEach((track) => track.stop());
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
