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

const MODEL_FILES = Object.freeze({
  fast: "ggml-small-q5_1.bin",
  standard: "ggml-medium-q5_0.bin",
  accurate: "ggml-large-v3-turbo-q5_0.bin",
});

function getRuntimePaths(projectRoot) {
  return {
    whisperCli: path.join(
      projectRoot,
      "native",
      "whisper",
      "whisper-cli.exe",
    ),
    modelsDir: path.join(projectRoot, "models"),
  };
}

function getModelPath(projectRoot, profile) {
  const file = MODEL_FILES[profile];
  if (!file) {
    throw new Error(`Perfil de modelo inválido: ${profile}`);
  }
  return path.join(projectRoot, "models", file);
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

function runProcess(executable, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 120000;
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(
        new Error(
          `A transcrição excedeu o limite de ${Math.round(timeoutMs / 1000)} segundos.`,
        ),
      );
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new Error(
            `O Whisper terminou com código ${code}. ${stderr || stdout}`.trim(),
          ),
        );
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function inspectRuntime(projectRoot) {
  const { whisperCli, modelsDir } = getRuntimePaths(projectRoot);
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
    profiles,
  };
}

async function transcribeWav({
  projectRoot,
  wavBuffer,
  profile = "standard",
  language = "pt",
  threads = 24,
  vocabulary = [],
  timeoutMs = 120000,
}) {
  const wavInfo = validateWav(wavBuffer);
  const { whisperCli } = getRuntimePaths(projectRoot);
  const modelPath = getModelPath(projectRoot, profile);
  await access(whisperCli);
  await access(modelPath);

  const tempRoot = path.join(os.tmpdir(), "local-flow");
  await mkdir(tempRoot, { recursive: true });
  const jobDir = await mkdtemp(path.join(tempRoot, "job-"));
  const audioPath = path.join(jobDir, "audio.wav");
  const outputBase = path.join(jobDir, "transcription");
  const startedAt = Date.now();

  try {
    await writeFile(audioPath, wavBuffer);
    const args = [
      "-m",
      modelPath,
      "-f",
      audioPath,
      "-l",
      language,
      "-t",
      String(Math.max(1, Math.min(threads, 24))),
      "-nt",
      "-oj",
      "-of",
      outputBase,
    ];

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
      cwd: projectRoot,
      timeoutMs,
    });
    const json = JSON.parse(await readFile(`${outputBase}.json`, "utf8"));
    const text = extractTranscription(json);
    if (!text) {
      throw new Error("O Whisper não reconheceu fala no áudio.");
    }

    return {
      text,
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
  extractTranscription,
  getModelPath,
  inspectRuntime,
  transcribeWav,
  validateWav,
};
