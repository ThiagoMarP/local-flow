const { access, stat } = require("node:fs/promises");
const path = require("node:path");
const { MODEL_CATALOG } = require("./model-installer.cjs");
const { looksLikeEnglishDrift } = require("./language-guard.cjs");
const { transcribeParakeetWav } = require("./parakeet-service.cjs");
const {
  getModelPath,
  inspectRuntime: inspectWhisperRuntime,
  transcribeWav,
} = require("../whisper-service.cjs");

// Whisper runs with the language pinned to Portuguese, so it re-transcribes the
// dictations Parakeet heard as English. Medium first: it is the best balance
// of quality and speed among the Whisper profiles.
const LANGUAGE_FALLBACK_PROFILES = ["standard", "fast", "accurate"];

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findInstalledWhisperProfile({ projectRoot, modelsDir }, exists) {
  for (const profile of LANGUAGE_FALLBACK_PROFILES) {
    if (await exists(getModelPath(projectRoot, profile, modelsDir))) return profile;
  }
  return null;
}

function createTranscriber({
  parakeetCli,
  parakeetServer,
  onParakeetServerFallback,
  onLanguageFallback = () => {},
  whisperTranscribe = transcribeWav,
  parakeetTranscribe = transcribeParakeetWav,
  exists = fileExists,
} = {}) {
  return async (options) => {
    if (options.profile !== "parakeet") return whisperTranscribe(options);
    const result = await parakeetTranscribe({
      ...options,
      parakeetCli,
      server: parakeetServer,
      onServerFallback: onParakeetServerFallback,
    });
    const { drifted, englishHits, portugueseHits } = looksLikeEnglishDrift(result.text);
    if (!drifted) return result;

    const fallbackProfile = await findInstalledWhisperProfile(options, exists);
    onLanguageFallback({ englishHits, portugueseHits, fallbackProfile });
    if (!fallbackProfile) return result;
    try {
      const retried = await whisperTranscribe({ ...options, profile: fallbackProfile });
      return { ...retried, fallbackFrom: "parakeet" };
    } catch (error) {
      if (error?.name === "AbortError" || options.signal?.aborted) throw error;
      // A failed retry should not lose the dictation; keep Parakeet's text.
      return result;
    }
  };
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
