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
  assert.equal(result.originalText, "texto sem pontuação");
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

test("substitui antes da revisão e expande snippet depois", async () => {
  let receivedByRevision;
  let receivedStyle;
  const pipeline = new TranscriptionPipeline({
    projectRoot: ".",
    transcribeWav: async () => ({
      text: "mande no zap e adicione minha assinatura",
      elapsedMs: 10,
      durationSeconds: 1,
      profile: "fast",
    }),
    revisionService: {
      revise: async (text, options) => {
        receivedByRevision = text;
        receivedStyle = options.styleInstruction;
        return {
          text: text.replace("mande", "Envie"),
          mode: "smart",
          model: "qwen2.5:3b",
          applied: true,
          fallback: false,
          reason: null,
          elapsedMs: 20,
        };
      },
    },
  });
  const result = await pipeline.run({
    wavBuffer: Buffer.from("wav"),
    revisionMode: "smart",
    writingProfile: "professional",
    replacements: [{ from: "zap", to: "WhatsApp" }],
    snippets: [
      {
        trigger: "minha assinatura",
        expansion: "Atenciosamente,\nMarcos",
      },
    ],
  });
  assert.equal(
    receivedByRevision,
    "mande no WhatsApp e adicione minha assinatura",
  );
  assert.match(receivedStyle, /profissional/i);
  assert.equal(
    result.text,
    "Envie no WhatsApp e adicione Atenciosamente,\nMarcos",
  );
  assert.equal(result.personalization.replacementsApplied, 1);
  assert.equal(result.personalization.snippetsExpanded, 1);
});

test("cancelamento antes da transcrição impede o início do ditado", async () => {
  const controller = new AbortController();
  controller.abort();
  let transcriptions = 0;
  const pipeline = new TranscriptionPipeline({
    transcribeWav: async () => { transcriptions += 1; },
    revisionService: { revise: async () => { throw new Error("não deve revisar"); } },
  });
  await assert.rejects(
    pipeline.run({ wavBuffer: Buffer.from("wav"), signal: controller.signal }),
    { name: "AbortError", code: "ABORT_ERR" },
  );
  assert.equal(transcriptions, 0);
});

test("cancelamento durante ASR descarta texto e não inicia revisão", async () => {
  const controller = new AbortController();
  let revisions = 0;
  const pipeline = new TranscriptionPipeline({
    transcribeWav: async ({ signal }) => {
      assert.equal(signal, controller.signal);
      controller.abort();
      return { text: "texto que não pode ser colado" };
    },
    revisionService: { revise: async () => { revisions += 1; } },
  });
  await assert.rejects(
    pipeline.run({ wavBuffer: Buffer.from("wav"), signal: controller.signal }),
    { name: "AbortError", code: "ABORT_ERR" },
  );
  assert.equal(revisions, 0);
});

test("cancelamento durante revisão descarta resultado concluído na corrida", async () => {
  const controller = new AbortController();
  const pipeline = new TranscriptionPipeline({
    transcribeWav: async () => ({ text: "original" }),
    revisionService: {
      revise: async (_text, { signal }) => {
        assert.equal(signal, controller.signal);
        controller.abort();
        return { text: "resultado tardio" };
      },
    },
  });
  await assert.rejects(
    pipeline.run({ wavBuffer: Buffer.from("wav"), revisionMode: "clean", signal: controller.signal }),
    { name: "AbortError", code: "ABORT_ERR" },
  );
});
