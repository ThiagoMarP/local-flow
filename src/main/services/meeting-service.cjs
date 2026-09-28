// Meeting transcription (Fase B). Takes the two captured streams — microphone
// ("Você") and system loopback ("Chamada") — transcribes each with per-segment
// timestamps, then interleaves the segments by time into a single labeled
// transcript. The interleaving is pure and deterministic so it can be unit
// tested without invoking whisper.

const DEFAULT_LABELS = Object.freeze({ mic: "Você", system: "Chamada" });
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { chunkName, validChunk } = require("./meeting-capture-store.cjs");

// Twelve 10-second capture blocks per inference keeps each Whisper input near
// two minutes while keeping capture memory and restart loss much smaller.
const INFERENCE_WINDOW_CHUNKS = 12;

function wavFromParts(parts) {
  const bytes = parts.reduce((sum, part) => sum + part.length, 0);
  const wav = Buffer.alloc(44 + bytes);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + bytes, 4);
  wav.write("WAVEfmt ", 8, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(bytes, 40);
  let offset = 44;
  for (const part of parts) {
    part.copy(wav, offset);
    offset += part.length;
  }
  return wav;
}

async function readWindow({ dir, start, end, readFileImpl = readFile }) {
  const data = [];
  let micHasAudio = false;
  let systemHasAudio = false;
  let durationSeconds = 0;
  for (let index = start; index < end; index++) {
    const chunkDir = path.join(dir, "chunks", chunkName(index));
    const [mic, system] = await Promise.all([
      readFileImpl(path.join(chunkDir, "mic.wav")),
      readFileImpl(path.join(chunkDir, "system.wav")),
    ]);
    const micSeconds = validChunk(mic);
    const systemSeconds = validChunk(system);
    const spanBytes = Math.max(mic.length - 44, system.length - 44);
    if (spanBytes > 2 * 1024 * 1024) throw new Error("Bloco de reunião grande demais.");
    durationSeconds += Math.max(micSeconds, systemSeconds);
    micHasAudio ||= micSeconds > 0;
    systemHasAudio ||= systemSeconds > 0;
    data.push({ mic: mic.subarray(44), system: system.subarray(44), spanBytes });
  }
  const channel = (name, hasAudio) => wavFromParts(hasAudio
    ? data.flatMap((item) => [item[name], Buffer.alloc(item.spanBytes - item[name].length)])
    : []);
  return {
    micWav: channel("mic", micHasAudio),
    systemWav: channel("system", systemHasAudio),
    durationSeconds,
  };
}

// Flatten the per-speaker segment lists into a single list ordered by start
// time (ties broken by end time, then by speaker for stability).
function interleaveSegments(streams) {
  const tagged = [];
  for (const stream of streams) {
    for (const segment of stream.segments || []) {
      tagged.push({
        speaker: stream.speaker,
        from: Number(segment.from) || 0,
        to: Number(segment.to) || Number(segment.from) || 0,
        text: String(segment.text || "").trim(),
      });
    }
  }
  return tagged
    .filter((segment) => segment.text)
    .sort(
      (a, b) =>
        a.from - b.from ||
        a.to - b.to ||
        a.speaker.localeCompare(b.speaker),
    );
}

// Collapse consecutive segments with identical text within a single stream —
// whisper's repetition loop on non-speech audio (a video on the loopback)
// echoes the same phrase many times in a row. Done per stream, before
// interleaving, so a turn from the other speaker between repeats doesn't hide
// them.
function collapseConsecutive(segments) {
  const collapsed = [];
  for (const segment of segments || []) {
    const previous = collapsed[collapsed.length - 1];
    if (
      previous &&
      previous.text === String(segment.text || "").trim() &&
      Number(segment.from) - Number(previous.to) <= 1500
    ) {
      previous.to = segment.to;
      continue;
    }
    collapsed.push({ ...segment, text: String(segment.text || "").trim() });
  }
  return collapsed;
}

// Build the final transcript. Consecutive segments from the same speaker are
// merged into a single turn so the output reads like a conversation.
function buildLabeledTranscript(streams, labels = DEFAULT_LABELS) {
  const ordered = interleaveSegments(streams);
  const turns = [];
  for (const segment of ordered) {
    const previous = turns[turns.length - 1];
    if (previous && previous.speaker === segment.speaker) {
      // Pula repetições consecutivas idênticas — assinatura do loop do whisper
      // em áudio não-conversacional, que ecoa a mesma frase várias vezes.
      if (previous.lastText !== segment.text || segment.from - previous.to > 1500) {
        previous.text += ` ${segment.text}`;
        previous.lastText = segment.text;
      }
      previous.to = segment.to;
    } else {
      turns.push({
        speaker: segment.speaker,
        label: labels[segment.speaker] || segment.speaker,
        text: segment.text,
        lastText: segment.text,
        from: segment.from,
        to: segment.to,
      });
    }
  }
  return {
    segments: ordered,
    turns: turns.map(({ lastText, ...turn }) => turn),
    text: turns.map((turn) => `[${turn.label}] ${turn.text}`).join("\n"),
  };
}

class MeetingService {
  constructor({
    transcribeWav,
    projectRoot,
    whisperCli,
    modelsDir,
    labels = DEFAULT_LABELS,
    readFileImpl = readFile,
  }) {
    if (typeof transcribeWav !== "function") {
      throw new Error("transcribeWav é obrigatório.");
    }
    this.transcribeWav = transcribeWav;
    this.projectRoot = projectRoot;
    this.whisperCli = whisperCli;
    this.modelsDir = modelsDir;
    this.labels = labels;
    this.readFileImpl = readFileImpl;
  }

  transcribeStream(wavBuffer, { profile, threads, vocabulary, timeoutMs }) {
    // Canal não capturado (modo "só mic"/"só sistema") vem como WAV vazio (só o
    // cabeçalho de 44 bytes). Pula o whisper e devolve sem segmentos.
    if (!wavBuffer || wavBuffer.length <= 44) {
      return Promise.resolve({ text: "", segments: [] });
    }
    return this.transcribeWav({
      projectRoot: this.projectRoot,
      whisperCli: this.whisperCli,
      modelsDir: this.modelsDir,
      wavBuffer,
      profile,
      threads,
      vocabulary,
      // Reunião precisa dos tempos por trecho e tolera um canal sem fala (só
      // você falou, ou só a chamada).
      withTimestamps: true,
      allowEmpty: true,
      // Quebra o loop de repetição do whisper em áudio não-conversacional
      // (o loopback costuma pegar vídeo/música).
      noContext: true,
      timeoutMs,
    });
  }

  async run({
    micWav,
    systemWav,
    profile = "standard",
    threads,
    vocabulary = [],
    timeoutMs,
  }) {
    const startedAt = Date.now();
    // Os dois canais vão em paralelo, cada um com metade dos threads, para
    // aproveitar máquinas multi-core sem oversubscrição (em 24 núcleos, ~2x).
    const perStreamThreads = threads
      ? Math.max(1, Math.floor(threads / 2))
      : undefined;
    const options = { profile, threads: perStreamThreads, vocabulary, timeoutMs };
    const [mic, system] = await Promise.all([
      this.transcribeStream(micWav, options),
      this.transcribeStream(systemWav, options),
    ]);
    const labeled = buildLabeledTranscript(
      [
        { speaker: "mic", segments: collapseConsecutive(mic.segments) },
        { speaker: "system", segments: collapseConsecutive(system.segments) },
      ],
      this.labels,
    );
    return {
      transcript: labeled.text,
      turns: labeled.turns,
      segments: labeled.segments,
      mic: { text: mic.text, segments: mic.segments },
      system: { text: system.text, segments: system.segments },
      elapsedMs: Date.now() - startedAt,
    };
  }

  async runFromChunkFiles({ dir, chunkCount, profile = "standard", threads, vocabulary = [] }) {
    const startedAt = Date.now();
    const streams = { mic: [], system: [] };
    const failures = [];
    const perStreamThreads = threads
      ? Math.max(1, Math.floor(threads / 2))
      : undefined;
    let offsetMs = 0;
    for (let start = 0; start < chunkCount; start += INFERENCE_WINDOW_CHUNKS) {
      const end = Math.min(start + INFERENCE_WINDOW_CHUNKS, chunkCount);
      const window = await readWindow({
        dir,
        start,
        end,
        readFileImpl: this.readFileImpl,
      });
      // Long inference windows need more than the dictation timeout.
      const timeoutMs = Math.max(120000, window.durationSeconds * 6000);
      // One channel can fail (for example on a noisy loopback) without losing
      // the other channel or the already completed inference windows.
      const options = { profile, threads: perStreamThreads, vocabulary, timeoutMs };
      const results = await Promise.allSettled([
        Promise.resolve().then(() => this.transcribeStream(window.micWav, options)),
        Promise.resolve().then(() => this.transcribeStream(window.systemWav, options)),
      ]);
      for (const [index, speaker] of ["mic", "system"].entries()) {
        const result = results[index];
        if (result.status === "rejected") {
          failures.push({
            speaker,
            startChunk: start,
            endChunk: end,
            fromMs: offsetMs,
            toMs: offsetMs + Math.round(window.durationSeconds * 1000),
            reason: String(result.reason?.message || result.reason || "Falha na transcrição").slice(0, 240),
          });
          continue;
        }
        streams[speaker].push(...(result.value.segments || []).map((segment) => ({
          ...segment,
          from: segment.from + offsetMs,
          to: segment.to + offsetMs,
        })));
      }
      offsetMs += Math.round(window.durationSeconds * 1000);
    }
    const labeled = buildLabeledTranscript([
      { speaker: "mic", segments: collapseConsecutive(streams.mic) },
      { speaker: "system", segments: collapseConsecutive(streams.system) },
    ], this.labels);
    if (!labeled.segments.length) {
      const error = new Error("Nenhum trecho da reunião pôde ser transcrito.");
      error.failures = failures;
      throw error;
    }
    return { transcript: labeled.text, turns: labeled.turns, segments: labeled.segments,
      elapsedMs: Date.now() - startedAt, durationSeconds: offsetMs / 1000,
      partial: failures.length > 0, failures };
  }
}

module.exports = {
  DEFAULT_LABELS,
  MeetingService,
  buildLabeledTranscript,
  collapseConsecutive,
  interleaveSegments,
  readWindow,
  INFERENCE_WINDOW_CHUNKS,
};
