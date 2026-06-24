const assert = require("node:assert/strict");
const test = require("node:test");
const {
  TranscriptionPipeline,
} = require("../src/main/services/transcription-pipeline.cjs");

test("pipeline aplica revisão e preserva métricas do Whisper", async () => {
  const stages = [];
  const pipeline = new TranscriptionPipeline({
    projectRoot: "C:\\local-flow",
    transcribeWav: async () => ({
      text: "texto sem pontuação",
      elapsedMs: 1200,
      durationSeconds: 4,
      profile: "fast",
    }),
    revisionService: {
      revise: async () => ({
        text: "Texto sem pontuação.",
        mode: "clean",
        model: "qwen2.5:3b",
        applied: true,
        fallback: false,
        reason: null,
        elapsedMs: 300,
      }),
    },
  });
  const result = await pipeline.run({
    wavBuffer: Buffer.from("wav"),
    profile: "fast",
    revisionMode: "clean",
    onProgress: (event) => stages.push(event.stage),
  });
  assert.equal(result.text, "Texto sem pontuação.");
  assert.equal(result.elapsedMs, 1200);
  assert.equal(result.revision.applied, true);
  assert.deepEqual(stages, ["transcribing", "revising"]);
});

test("fallback da revisão ainda retorna transcrição válida", async () => {
  const pipeline = new TranscriptionPipeline({
    projectRoot: ".",
    transcribeWav: async () => ({
      text: "Texto original.",
      elapsedMs: 10,
      durationSeconds: 1,
      profile: "fast",
    }),
    revisionService: {
      revise: async (text) => ({
        text,
        mode: "smart",
        model: "qwen2.5:3b",
        applied: false,
        fallback: true,
        reason: "timeout",
        elapsedMs: 1000,
      }),
    },
  });
  const result = await pipeline.run({
    wavBuffer: Buffer.from("wav"),
    revisionMode: "smart",
  });
  assert.equal(result.text, "Texto original.");
  assert.equal(result.revision.fallback, true);
  assert.equal(result.revision.reason, "timeout");
});
