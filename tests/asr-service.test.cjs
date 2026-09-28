const assert = require("node:assert/strict");
const test = require("node:test");
const { createTranscriber } = require("../src/main/services/asr-service.cjs");

test("roteia o perfil Parakeet ao motor nativo", async () => {
  const calls = [];
  const transcribe = createTranscriber({
    parakeetCli: "C:\\nemo-speech.exe",
    whisperTranscribe: () => {
      throw new Error("Whisper não deveria executar");
    },
    parakeetTranscribe: async (options) => {
      calls.push(options);
      return { text: "Olá", profile: "parakeet" };
    },
  });
  const result = await transcribe({ profile: "parakeet", wavBuffer: Buffer.from("wav") });
  assert.equal(result.text, "Olá");
  assert.equal(calls[0].parakeetCli, "C:\\nemo-speech.exe");
});

test("mantém os perfis existentes no Whisper", async () => {
  const transcribe = createTranscriber({
    whisperTranscribe: async ({ profile }) => ({ text: profile }),
    parakeetTranscribe: () => {
      throw new Error("Parakeet não deveria executar");
    },
  });
  assert.equal((await transcribe({ profile: "fast" })).text, "fast");
  assert.equal((await transcribe({ profile: "accurate" })).text, "accurate");
});

const DRIFTED = "And my reunion with Flávio, he followed that he was for a Martin.";
const installed = (...files) => async (filePath) =>
  files.some((file) => filePath.endsWith(file));

test("retranscreve no Whisper quando o Parakeet sai em inglês", async () => {
  const events = [];
  const whisperCalls = [];
  const transcribe = createTranscriber({
    parakeetTranscribe: async () => ({ text: DRIFTED, profile: "parakeet" }),
    whisperTranscribe: async (options) => {
      whisperCalls.push(options);
      return { text: "E minha reunião com o Flávio.", profile: options.profile };
    },
    exists: installed("ggml-medium-q5_0.bin", "ggml-small-q5_1.bin"),
    onLanguageFallback: (event) => events.push(event),
  });
  const result = await transcribe({
    profile: "parakeet",
    projectRoot: "C:\\app",
    modelsDir: "C:\\models",
    wavBuffer: Buffer.from("wav"),
  });
  assert.equal(result.text, "E minha reunião com o Flávio.");
  assert.equal(result.fallbackFrom, "parakeet");
  assert.equal(whisperCalls[0].profile, "standard");
  assert.equal(events[0].fallbackProfile, "standard");
  assert.ok(events[0].englishHits >= 3);
});

test("usa o Small quando o Medium não está instalado", async () => {
  const whisperCalls = [];
  const transcribe = createTranscriber({
    parakeetTranscribe: async () => ({ text: DRIFTED }),
    whisperTranscribe: async (options) => {
      whisperCalls.push(options.profile);
      return { text: "ok" };
    },
    exists: installed("ggml-small-q5_1.bin"),
  });
  await transcribe({ profile: "parakeet", modelsDir: "C:\\models" });
  assert.deepEqual(whisperCalls, ["fast"]);
});

test("mantém o texto do Parakeet quando não há Whisper instalado", async () => {
  const events = [];
  const transcribe = createTranscriber({
    parakeetTranscribe: async () => ({ text: DRIFTED }),
    whisperTranscribe: () => {
      throw new Error("Whisper não deveria executar");
    },
    exists: installed(),
    onLanguageFallback: (event) => events.push(event),
  });
  const result = await transcribe({ profile: "parakeet", modelsDir: "C:\\models" });
  assert.equal(result.text, DRIFTED);
  assert.equal(events[0].fallbackProfile, null);
});

test("mantém o texto do Parakeet quando o Whisper falha", async () => {
  const transcribe = createTranscriber({
    parakeetTranscribe: async () => ({ text: DRIFTED }),
    whisperTranscribe: async () => {
      throw new Error("whisper quebrou");
    },
    exists: installed("ggml-medium-q5_0.bin"),
  });
  const result = await transcribe({ profile: "parakeet", modelsDir: "C:\\models" });
  assert.equal(result.text, DRIFTED);
});

test("cancelar durante a retranscrição não cola o texto do Parakeet", async () => {
  const controller = new AbortController();
  const transcribe = createTranscriber({
    parakeetTranscribe: async () => ({ text: DRIFTED }),
    whisperTranscribe: async () => {
      controller.abort();
      const error = new Error("Ditado cancelado.");
      error.name = "AbortError";
      throw error;
    },
    exists: installed("ggml-medium-q5_0.bin"),
  });
  await assert.rejects(
    transcribe({ profile: "parakeet", modelsDir: "C:\\models", signal: controller.signal }),
    { name: "AbortError" },
  );
});

test("não chama o Whisper quando o Parakeet acerta o português", async () => {
  const transcribe = createTranscriber({
    parakeetTranscribe: async () => ({ text: "Faz o deploy e roda o build na main." }),
    whisperTranscribe: () => {
      throw new Error("Whisper não deveria executar");
    },
    exists: installed("ggml-medium-q5_0.bin"),
  });
  const result = await transcribe({ profile: "parakeet", modelsDir: "C:\\models" });
  assert.equal(result.text, "Faz o deploy e roda o build na main.");
});
