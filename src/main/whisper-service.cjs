const { spawn } = require("node:child_process");
const {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  createAbortError,
  throwIfAborted,
} = require("./services/cancellation.cjs");

const MODEL_FILES = Object.freeze({
  fast: "ggml-small-q5_1.bin",
  standard: "ggml-medium-q5_0.bin",
  accurate: "ggml-large-v3-turbo-q5_0.bin",
});

function getRuntimePaths(projectRoot, overrides = {}) {
  return {
    whisperCli:
      overrides.whisperCli ||
      path.join(projectRoot, "native", "whisper", "whisper-cli.exe"),
    modelsDir: overrides.modelsDir || path.join(projectRoot, "models"),
  };
}

function getModelPath(projectRoot, profile, modelsDir) {
  const file = MODEL_FILES[profile];
  if (!file) {
    throw new Error(`Perfil de modelo inválido: ${profile}`);
  }
  return path.join(modelsDir || path.join(projectRoot, "models"), file);
}

function validateWav(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError("O áudio precisa ser um Buffer.");
  }
  if (buffer.length < 44) {
    throw new Error("O arquivo de áudio está vazio ou incompleto.");
  }
  if (
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error("O áudio precisa estar no formato WAV.");
  }
  if (buffer.length > 50 * 1024 * 1024) {
    throw new Error("O áudio excede o limite temporário de 50 MB.");
  }

  let offset = 12;
  let format;
  let dataSize = 0;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const contentOffset = offset + 8;
    if (contentOffset + chunkSize > buffer.length) {
      throw new Error("O arquivo WAV contém um bloco incompleto.");
    }
    if (chunkId === "fmt " && chunkSize >= 16) {
      format = {
        audioFormat: buffer.readUInt16LE(contentOffset),
        channels: buffer.readUInt16LE(contentOffset + 2),
        sampleRate: buffer.readUInt32LE(contentOffset + 4),
        bitsPerSample: buffer.readUInt16LE(contentOffset + 14),
      };
    }
    if (chunkId === "data") {
      dataSize = chunkSize;
    }
    offset = contentOffset + chunkSize + (chunkSize % 2);
  }

  if (!format || !dataSize) {
    throw new Error("O arquivo WAV não contém áudio PCM válido.");
  }
  if (
    format.audioFormat !== 1 ||
    format.channels !== 1 ||
    format.sampleRate !== 16000 ||
    format.bitsPerSample !== 16
  ) {
    throw new Error("O áudio precisa ser PCM mono, 16 kHz e 16 bits.");
  }

  return {
    ...format,
    dataSize,
    durationSeconds:
      dataSize /
      (format.sampleRate * format.channels * (format.bitsPerSample / 8)),
  };
}

// Whisper hallucinates non-speech annotations on silence or background noise,
// e.g. "[MÚSICA DE FUNDO]", "[BLANK_AUDIO]", "[Applause]" or runs of "♪". Drop
// those so they never reach the user's text.
function stripNonSpeech(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/♪+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTranscription(json) {
  if (typeof json?.text === "string") {
    return json.text.trim();
  }
  if (!Array.isArray(json?.transcription)) {
    return "";
  }
  return json.transcription
    .map((segment) => segment?.text || segment?.texts?.[0] || "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

// Per-segment view of the transcription, with millisecond offsets. Needs the
// run to omit -nt (no-timestamps), otherwise whisper collapses everything into
// one coarse 30s window. Used by the meeting pipeline to interleave speakers.
function extractSegments(json) {
  if (!Array.isArray(json?.transcription)) return [];
  const segments = [];
  for (const item of json.transcription) {
    const text = stripNonSpeech(item?.text || item?.texts?.[0] || "");
    if (!text) continue;
    const from = Number(item?.offsets?.from) || 0;
    const to = Number(item?.offsets?.to);
    segments.push({ from, to: Number.isFinite(to) ? to : from, text });
  }
  return segments;
}

function runProcess(executable, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 120000;
  throwIfAborted(options.signal);
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let aborted = false;
    let timedOut = false;

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(result);
    };

    const onAbort = () => {
      if (settled) return;
      aborted = true;
      child.kill();
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });

    const timer = setTimeout(() => {
      if (settled || aborted) return;
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => {
      finish(aborted || options.signal?.aborted ? createAbortError() : error);
    });
    child.once("close", (code) => {
      if (settled) return;
      if (aborted || options.signal?.aborted) {
        finish(createAbortError());
        return;
      }
      if (timedOut) {
        finish(new Error(
          `A transcrição excedeu o limite de ${Math.round(timeoutMs / 1000)} segundos.`,
        ));
        return;
      }
      if (code !== 0) {
        finish(
          new Error(
            `O Whisper terminou com código ${code}. ${stderr || stdout}`.trim(),
          ),
        );
        return;
      }
      finish(null, { stdout, stderr });
    });
    if (options.signal?.aborted) onAbort();
  });
}

async function inspectRuntime(projectRoot, overrides = {}) {
  const { whisperCli, modelsDir } = getRuntimePaths(projectRoot, overrides);
  const profiles = {};
  for (const [profile, file] of Object.entries(MODEL_FILES)) {
    try {
      await access(path.join(modelsDir, file));
      profiles[profile] = { available: true, file };
    } catch {
      profiles[profile] = { available: false, file };
    }
  }

  let whisperAvailable = true;
  try {
    await access(whisperCli);
  } catch {
    whisperAvailable = false;
  }

  return {
    whisperAvailable,
    whisperCli,
    modelsDir,
    profiles,
  };
}

async function transcribeWav({
  projectRoot,
  whisperCli: whisperCliOverride,
  modelsDir: modelsDirOverride,
  wavBuffer,
  profile = "standard",
  language = "pt",
  threads = 24,
  vocabulary = [],
  timeoutMs = 120000,
  withTimestamps = false,
  allowEmpty = false,
  noContext = false,
  signal,
}) {
  throwIfAborted(signal);
  const wavInfo = validateWav(wavBuffer);
  const { whisperCli, modelsDir } = getRuntimePaths(projectRoot, {
    whisperCli: whisperCliOverride,
    modelsDir: modelsDirOverride,
  });
  const modelPath = getModelPath(projectRoot, profile, modelsDir);
  try {
    await access(whisperCli);
  } catch {
    throwIfAborted(signal);
    const error = new Error(
      "O motor de transcrição (whisper-cli.exe) não foi encontrado. Reinstale o Local Flow.",
    );
    error.code = "WHISPER_CLI_MISSING";
    throw error;
  }
  throwIfAborted(signal);
  try {
    await access(modelPath);
  } catch {
    throwIfAborted(signal);
    const error = new Error(
      `O modelo do perfil "${profile}" ainda não foi baixado. ` +
        "Abra o Local Flow e baixe o modelo em Configuração antes de ditar.",
    );
    error.code = "MODEL_NOT_INSTALLED";
    throw error;
  }
  throwIfAborted(signal);

  const tempRoot = path.join(os.tmpdir(), "local-flow");
  await mkdir(tempRoot, { recursive: true });
  throwIfAborted(signal);
  const jobDir = await mkdtemp(path.join(tempRoot, "job-"));
  const audioPath = path.join(jobDir, "audio.wav");
  const outputBase = path.join(jobDir, "transcription");
  const startedAt = Date.now();

  try {
    throwIfAborted(signal);
    await writeFile(audioPath, wavBuffer);
    throwIfAborted(signal);
    const args = [
      "-m",
      modelPath,
      "-f",
      audioPath,
      "-l",
      language,
      "-t",
      // Adapt to the CPU instead of a fixed 24: spawning more threads than the
      // machine has cores just adds context-switching overhead and slows
      // whisper down on smaller machines.
      String(Math.max(1, Math.min(threads, os.cpus().length))),
    ];
    // Dictation uses -nt (no timestamps). The meeting pipeline needs per-segment
    // offsets to interleave speakers, so it omits -nt.
    if (!withTimestamps) args.push("-nt");
    // -mc 0 = don't carry decoded text as context between segments. This is the
    // fix for whisper's repetition loop on non-speech/music audio (the system
    // loopback often grabs a video), where it otherwise echoes one phrase over
    // and over. Used by the meeting path.
    if (noContext) args.push("-mc", "0");
    args.push("-sns", "-oj", "-of", outputBase);

    const cleanVocabulary = (Array.isArray(vocabulary) ? vocabulary : [])
      .map((term) => String(term).trim())
      .filter(Boolean)
      .slice(0, 100);
    if (cleanVocabulary.length > 0) {
      args.push(
        "--prompt",
        `Vocabulário: ${cleanVocabulary.join(", ")}.`,
        "--carry-initial-prompt",
      );
    }

    await runProcess(whisperCli, args, {
      // Use the real temp job directory, never projectRoot: in a packaged build
      // projectRoot points inside app.asar, which is not a real directory, and
      // spawning with a non-existent cwd fails with "spawn <exe> ENOENT".
      cwd: jobDir,
      timeoutMs,
      signal,
    });
    throwIfAborted(signal);
    const json = JSON.parse(await readFile(`${outputBase}.json`, "utf8"));
    throwIfAborted(signal);
    const text = stripNonSpeech(extractTranscription(json));
    const segments = extractSegments(json);
    if (!text && !allowEmpty) {
      throw new Error("O Whisper não reconheceu fala no áudio.");
    }
    throwIfAborted(signal);

    return {
      text,
      segments,
      profile,
      durationSeconds: wavInfo.durationSeconds,
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    await rm(jobDir, { recursive: true, force: true });
  }
}

module.exports = {
  MODEL_FILES,
  extractSegments,
  extractTranscription,
  getModelPath,
  inspectRuntime,
  runProcess,
  stripNonSpeech,
  transcribeWav,
  validateWav,
};
