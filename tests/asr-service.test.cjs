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
