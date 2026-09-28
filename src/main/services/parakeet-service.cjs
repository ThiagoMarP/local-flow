const { spawn } = require("node:child_process");
const { access, mkdir, mkdtemp, rm, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { StringDecoder } = require("node:string_decoder");
const { stripNonSpeech, validateWav } = require("../whisper-service.cjs");
const { createAbortError, throwIfAborted } = require("./cancellation.cjs");

const PARAKEET_PROFILE = "parakeet";
const PARAKEET_MODEL_FILE = "parakeet-tdt-0.6b-v3.q8_0.gguf";

function getParakeetPaths(projectRoot, { parakeetCli, modelsDir } = {}) {
  if (!projectRoot && (!parakeetCli || !modelsDir)) {
    throw new Error("projectRoot ou os caminhos do runtime são obrigatórios.");
  }
  return {
    parakeetCli:
      parakeetCli ||
      path.join(projectRoot, "native", "parakeet", "bin", "nemo-speech.exe"),
    modelsDir: modelsDir || path.join(projectRoot, "models"),
  };
}

function runParakeetCli(executable, args, { cwd, timeoutMs = 120000, signal } = {}) {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    let settled = false;
    let aborted = false;
    let timedOut = false;

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(result);
    };

    const onAbort = () => {
      if (settled) return;
      aborted = true;
      child.kill();
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    const timer = setTimeout(() => {
      if (settled || aborted) return;
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += stdoutDecoder.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += stderrDecoder.write(chunk);
    });
    child.once("error", (error) => {
      finish(aborted || signal?.aborted ? createAbortError() : error);
    });
    child.once("close", (code) => {
      if (settled) return;
      stdout += stdoutDecoder.end();
      stderr += stderrDecoder.end();
      if (aborted || signal?.aborted) {
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
            `O Parakeet terminou com código ${code}. ${stderr || stdout}`.trim(),
          ),
        );
        return;
      }
      finish(null, stdout);
    });
    if (signal?.aborted) onAbort();
  });
}

async function transcribeParakeetWav({
  projectRoot,
  parakeetCli: parakeetCliOverride,
  modelsDir: modelsDirOverride,
  wavBuffer,
  profile = PARAKEET_PROFILE,
  timeoutMs = 120000,
  allowEmpty = false,
  processRunner = runParakeetCli,
  server,
  onServerFallback = () => {},
  signal,
}) {
  throwIfAborted(signal);
  if (profile !== PARAKEET_PROFILE) {
    throw new Error(`Perfil de modelo inválido: ${profile}`);
  }
  const wavInfo = validateWav(wavBuffer);
  const { parakeetCli, modelsDir } = getParakeetPaths(projectRoot, {
    parakeetCli: parakeetCliOverride,
    modelsDir: modelsDirOverride,
  });
  const modelPath = path.join(modelsDir, PARAKEET_MODEL_FILE);

  try {
    await access(parakeetCli);
  } catch {
    throwIfAborted(signal);
    const error = new Error(
      "O motor de transcrição Parakeet não foi encontrado. Reinstale o Local Flow.",
    );
    error.code = "PARAKEET_CLI_MISSING";
    throw error;
  }
  throwIfAborted(signal);
  try {
    await access(modelPath);
  } catch {
    throwIfAborted(signal);
    const error = new Error(
      "O modelo Parakeet ainda não foi baixado. Baixe-o em Configuração antes de ditar.",
    );
    error.code = "MODEL_NOT_INSTALLED";
    throw error;
  }
  throwIfAborted(signal);

  const finish = (rawText, startedAt) => {
    const text = stripNonSpeech(rawText);
    if (!text && !allowEmpty) {
      throw new Error("O Parakeet não reconheceu fala no áudio.");
    }
    return {
      text,
      segments: [],
      profile,
      durationSeconds: wavInfo.durationSeconds,
      elapsedMs: Date.now() - startedAt,
    };
  };

  if (server?.available) {
    const startedAt = Date.now();
    let rawText;
    try {
      rawText = await server.transcribe({ wavBuffer, modelPath, timeoutMs, signal });
    } catch (error) {
      if (error?.name === "AbortError" || signal?.aborted) throw error;
      // The warm server is only a speed-up; the CLI below still transcribes.
      onServerFallback(error);
    }
    throwIfAborted(signal);
    if (rawText !== undefined) return finish(rawText, startedAt);
  }

  const tempRoot = path.join(os.tmpdir(), "local-flow");
  await mkdir(tempRoot, { recursive: true });
  throwIfAborted(signal);
  const jobDir = await mkdtemp(path.join(tempRoot, "job-"));
  const audioPath = path.join(jobDir, "audio.wav");
  const startedAt = Date.now();

  try {
    throwIfAborted(signal);
    await writeFile(audioPath, wavBuffer);
    throwIfAborted(signal);
    // The official NeMo-Speech.cpp CLI writes plain results to stdout and
    // diagnostics to stderr. Parakeet TDT is offline-only, so do not use --stream.
    const stdout = await processRunner(
      parakeetCli,
      ["--quiet", "transcribe", audioPath, "--model", modelPath, "--format", "text"],
      { cwd: jobDir, timeoutMs, signal },
    );
    throwIfAborted(signal);
    return finish(stdout, startedAt);
  } finally {
    await rm(jobDir, { recursive: true, force: true });
  }
}

module.exports = {
  PARAKEET_MODEL_FILE,
  PARAKEET_PROFILE,
  getParakeetPaths,
  runParakeetCli,
  transcribeParakeetWav,
};
