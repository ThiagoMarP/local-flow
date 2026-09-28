// Meeting capture (Fase A). Records two independent streams — the microphone
// ("Você") and the system-audio loopback ("Chamada") — into two separate 16 kHz
// mono WAVs, then hands both to the main process. Kept fully isolated from the
// dictation flow in renderer.js on purpose: it only reuses the pure WAV encoder
// (audio.js) and the shared capture worklet (capture-worklet.js).
import { joinAndEncode } from "./audio.js";

let audioContext = null;
let micStream = null;
let systemStream = null;
let micChunks = [];
let systemChunks = [];
let graphNodes = [];
let isCapturing = false;
// Trava síncrona: start e stop são assíncronos (abrem dispositivos, carregam o
// worklet). Sem isto, comandos sobrepostos se atropelam e corrompem o estado.
let isBusy = false;
// Estado da cápsula (Fase D): tempo decorrido e nível para a onda.
let startedAt = 0;
let uiTimer = null;
let peak = 0;
const CHUNK_MS = 10_000;
const MAX_PENDING_CHUNKS = 2;
let flushTimer = null;
let sessionId = null;
let nextChunkIndex = 0;
let pendingChunks = 0;
let writeQueue = Promise.resolve();
let captureFailure = null;
let stopRequested = false;

function reportCaptureFailure(error) {
  if (captureFailure) return;
  captureFailure = error instanceof Error ? error : new Error(String(error));
  console.error("Local Flow · reunião: gravação em blocos interrompida.", captureFailure);
  window.localFlow.reportMeetingEvent?.({ type: "error", message: captureFailure.message });
  window.localFlow.updateUiState?.({ state: "error", message: "Falha ao salvar reunião" });
  // Stop the audio graph and process chunks already committed on disk.
  queueMicrotask(() => stopMeetingCapture({ interrupted: true }).catch(() => {}));
}

function flushChunks() {
  if (!sessionId || (!micChunks.length && !systemChunks.length)) return Promise.resolve();
  if (pendingChunks >= MAX_PENDING_CHUNKS) {
    reportCaptureFailure(new Error("O disco não acompanhou a gravação; a captura foi interrompida para preservar o áudio já salvo."));
    return Promise.resolve();
  }
  // AudioWorklet callbacks hold these arrays as their sinks. Drain them in
  // place so subsequent frames still land in the active capture buffers.
  const mic = micChunks.splice(0);
  const system = systemChunks.splice(0);
  const sampleRate = audioContext?.sampleRate || 48000;
  const payload = {
    id: sessionId,
    index: nextChunkIndex++,
    micWav: joinAndEncode(mic, sampleRate, 16000),
    systemWav: joinAndEncode(system, sampleRate, 16000),
  };
  pendingChunks++;
  const write = writeQueue.then(() => window.localFlow.appendMeetingCaptureChunk(payload));
  writeQueue = write.catch(reportCaptureFailure).finally(() => { pendingChunks--; });
  return writeQueue;
}

function micConstraints(microphoneId) {
  const audio = {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
  if (microphoneId && microphoneId !== "default") {
    audio.deviceId = { exact: microphoneId };
  }
  return audio;
}

async function openMicrophone(microphoneId) {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: micConstraints(microphoneId),
    });
  } catch (error) {
    // A chosen device may no longer satisfy the exact constraint; fall back to
    // the system default instead of failing the whole capture.
    if (error.name !== "OverconstrainedError") throw error;
    return navigator.mediaDevices.getUserMedia({
      audio: micConstraints(),
    });
  }
}

// Wire one MediaStream into the shared context: a source node → the capture
// worklet (which posts PCM frames) → a muted gain so the graph keeps pulling
// audio without playing anything back.
function pipeStream(stream, sink) {
  const source = audioContext.createMediaStreamSource(stream);
  const worklet = new AudioWorkletNode(audioContext, "capture-processor", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 1,
  });
  worklet.port.onmessage = (event) => {
    if (!isCapturing) return;
    sink.push(event.data.samples);
    if (event.data.peak > peak) peak = event.data.peak;
  };
  const silent = audioContext.createGain();
  silent.gain.value = 0;
  source.connect(worklet);
  worklet.connect(silent);
  silent.connect(audioContext.destination);
  graphNodes.push(source, worklet, silent);
}

// Drives the capsule's "meeting" state: ticks the elapsed timer and feeds the
// wave a level from the loudest recent frame (mic or system), then resets the
// peak so the bars settle when things go quiet — same feel as dictation.
function publishMeetingState() {
  window.localFlow.updateUiState?.({
    state: "meeting",
    elapsedMs: Date.now() - startedAt,
    level: Math.min(1, Math.sqrt(peak) * 2),
  });
  peak = 0;
}

async function teardown() {
  clearInterval(uiTimer);
  clearInterval(flushTimer);
  flushTimer = null;
  uiTimer = null;
  for (const node of graphNodes) {
    try {
      node.disconnect();
    } catch {
      // node may already be detached — ignore
    }
  }
  graphNodes = [];
  micStream?.getTracks().forEach((track) => track.stop());
  systemStream?.getTracks().forEach((track) => track.stop());
  micStream = null;
  systemStream = null;
  if (audioContext && audioContext.state !== "closed") {
    await audioContext.close();
  }
  audioContext = null;
}

export function isMeetingCapturing() {
  return isCapturing;
}

export async function startMeetingCapture(options = {}) {
  if (isCapturing || isBusy) return;
  isBusy = true;
  micChunks = [];
  systemChunks = [];
  sessionId = null;
  nextChunkIndex = 0;
  pendingChunks = 0;
  writeQueue = Promise.resolve();
  captureFailure = null;
  stopRequested = false;
  graphNodes = [];
  // Modo de captura: "both" (padrão), "mic" (só microfone) ou "system" (só o
  // áudio do sistema). Abrimos apenas as fontes pedidas.
  const mode =
    options.mode === "mic" || options.mode === "system"
      ? options.mode
      : "both";
  const wantMic = mode !== "system";
  const wantSystem = mode !== "mic";
  try {
    if (wantMic) {
      micStream = await openMicrophone(options.microphoneId);
    }
    if (wantSystem) {
      // System loopback ("Chamada"). On Windows the request must include video,
      // so we ask for both and drop the video track immediately.
      systemStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      systemStream.getVideoTracks().forEach((track) => track.stop());
      if (mode === "system" && systemStream.getAudioTracks().length === 0) {
        throw new Error("A fonte escolhida não forneceu áudio do sistema.");
      }
    }

    // A single shared AudioContext keeps both streams on the same sample rate;
    // each is independently downsampled to 16 kHz when encoded.
    audioContext = new AudioContext();
    await audioContext.audioWorklet.addModule("./capture-worklet.js");

    const session = await window.localFlow.startMeetingCaptureSession({ mode });
    sessionId = session.id;

    isCapturing = true;
    if (micStream) pipeStream(micStream, micChunks);
    let hasSystemAudio = false;
    if (systemStream) {
      const systemAudio = systemStream.getAudioTracks();
      if (systemAudio.length > 0) {
        pipeStream(new MediaStream(systemAudio), systemChunks);
        hasSystemAudio = true;
      } else {
        console.warn(
          "Local Flow · reunião: sem trilha de áudio do sistema (loopback vazio).",
        );
      }
    }
    window.localFlow.reportMeetingEvent?.({
      type: "started",
      mode,
      hasSystemAudio,
    });
    // Cápsula no estado "gravando reunião": primeiro quadro imediato e depois um
    // tique a cada 250ms para o timer e a onda.
    startedAt = Date.now();
    peak = 0;
    publishMeetingState();
    uiTimer = setInterval(publishMeetingState, 250);
    flushTimer = setInterval(() => { flushChunks().catch(() => {}); }, CHUNK_MS);
  } catch (error) {
    isCapturing = false;
    await teardown();
    if (sessionId) {
      await window.localFlow.saveMeetingCapture({ id: sessionId, interrupted: true }).catch(() => {});
      sessionId = null;
    }
    console.error(
      "Local Flow · reunião: falha ao iniciar a captura.",
      error,
    );
    window.localFlow.reportMeetingEvent?.({
      type: "error",
      message: String(error?.message || error),
    });
    window.localFlow.updateUiState?.({ state: "idle", message: "Pronto" });
    throw error;
  } finally {
    isBusy = false;
    if (stopRequested && isCapturing) {
      stopRequested = false;
      queueMicrotask(() => stopMeetingCapture().catch(() => {}));
    }
  }
}

export async function stopMeetingCapture({ interrupted = false } = {}) {
  if (isBusy) {
    stopRequested = true;
    return null;
  }
  if (!isCapturing) return null;
  isBusy = true;
  isCapturing = false;
  clearInterval(uiTimer);
  uiTimer = null;
  clearInterval(flushTimer);
  flushTimer = null;
  // Mesmo "processando" do ditado; o main transcreve em segundo plano e dispara
  // o pulso de conclusão quando termina.
  window.localFlow.updateUiState?.(captureFailure
    ? { state: "error", message: "Falha ao salvar reunião" }
    : { state: "processing" });
  try {
    if (!captureFailure) await flushChunks();
    await writeQueue;
    micChunks = [];
    systemChunks = [];
    await teardown();
    const result = await window.localFlow.saveMeetingCapture({
      id: sessionId,
      interrupted: interrupted || Boolean(captureFailure),
    });
    sessionId = null;
    console.log("Local Flow · reunião: captura enviada.", result);
    return result;
  } catch (error) {
    window.localFlow.reportMeetingEvent?.({ type: "error", message: String(error?.message || error) });
    window.localFlow.updateUiState?.({ state: "error", message: "Falha ao salvar reunião" });
    throw error;
  } finally {
    isBusy = false;
    stopRequested = false;
  }
}
