const { access, stat } = require("node:fs/promises");
const path = require("node:path");
const { MODEL_CATALOG } = require("./model-installer.cjs");
const { transcribeParakeetWav } = require("./parakeet-service.cjs");
const { inspectRuntime: inspectWhisperRuntime, transcribeWav } = require("../whisper-service.cjs");

function createTranscriber({
  parakeetCli,
  parakeetServer,
  onParakeetServerFallback,
  whisperTranscribe = transcribeWav,
  parakeetTranscribe = transcribeParakeetWav,
} = {}) {
  return (options) =>
    options.profile === "parakeet"
      ? parakeetTranscribe({
          ...options,
          parakeetCli,
          server: parakeetServer,
          onServerFallback: onParakeetServerFallback,
        })
      : whisperTranscribe(options);
}

async function inspectAsrRuntime(projectRoot, options = {}) {
  const whisper = await inspectWhisperRuntime(projectRoot, options);
  const parakeetCli = options.parakeetCli || path.join(
    projectRoot,
    "native",
    "parakeet",
    "bin",
    "nemo-speech.exe",
  );
  const model = MODEL_CATALOG.parakeet;
  let parakeetAvailable = false;
  let modelAvailable = false;
  try {
    await access(parakeetCli);
    parakeetAvailable = true;
  } catch {
    // The Whisper profiles can still run if the optional Parakeet engine is absent.
  }
  try {
    const file = await stat(path.join(whisper.modelsDir, model.file));
    modelAvailable = file.isFile() && file.size === model.approxBytes;
  } catch {
    // The model is downloaded only when requested.
  }
  return {
    ...whisper,
    parakeetAvailable,
    parakeetCli,
    profiles: {
      ...whisper.profiles,
      parakeet: {
        available: parakeetAvailable && modelAvailable,
        file: model.file,
      },
    },
  };
}

module.exports = { createTranscriber, inspectAsrRuntime };
