const assert = require("node:assert/strict");
const test = require("node:test");
const {
  MeetingController,
  summaryFailureMessage,
} = require("../src/main/meeting-controller.cjs");

function setup({ meeting, summarize }) {
  const calls = { saved: [], summarized: [] };
  const controller = new MeetingController({
    settingsStore: { get: () => ({ meetingSummaryModel: "qwen2.5:3b" }) },
    logger: { info: async () => {}, warn: async () => {} },
    meetingStore: {
      get: async () => meeting,
      saveSummary: async (id, markdown) => {
        calls.saved.push({ id, markdown });
        return { ...meeting, hasSummary: true, summarized: true, summary: markdown };
      },
    },
    meetingSummaryService: {
      summarize: async (transcript, options) => {
        calls.summarized.push({ transcript, options });
        return summarize();
      },
    },
  });
  return { controller, calls };
}

const done = { id: "m1", state: "done", hasTranscript: true, transcript: "[Você] oi" };

test("gera o resumo depois com o modelo das configurações", async () => {
  const { controller, calls } = setup({
    meeting: done,
    summarize: () => ({ applied: true, markdown: "## Resumo" }),
  });
  const result = await controller.regenerateSummary("m1");
  assert.equal(result.summary, "## Resumo");
  assert.deepEqual(calls.saved, [{ id: "m1", markdown: "## Resumo" }]);
  assert.deepEqual(calls.summarized[0], {
    transcript: "[Você] oi",
    options: { model: "qwen2.5:3b" },
  });
});

test("Ollama fechado vira mensagem clara e nada é gravado", async () => {
  const { controller, calls } = setup({
    meeting: done,
    summarize: () => ({ applied: false, reason: "ollama-unavailable" }),
  });
  await assert.rejects(controller.regenerateSummary("m1"), /Ollama está fechado/);
  assert.equal(calls.saved.length, 0);
});

test("recusa reunião sem transcrição ou ainda em andamento", async () => {
  for (const meeting of [
    { ...done, hasTranscript: false, transcript: "" },
    { ...done, state: "processing" },
    { ...done, state: "recording" },
  ]) {
    const { controller, calls } = setup({ meeting, summarize: () => ({ applied: true, markdown: "x" }) });
    await assert.rejects(controller.regenerateSummary("m1"));
    assert.equal(calls.summarized.length, 0);
  }
});

test("dois pedidos para a mesma reunião não rodam juntos", async () => {
  let release;
  const { controller, calls } = setup({
    meeting: done,
    summarize: () => new Promise((resolve) => { release = () => resolve({ applied: true, markdown: "ok" }); }),
  });
  const first = controller.regenerateSummary("m1");
  await assert.rejects(controller.regenerateSummary("m1"), /já está sendo gerado/);
  await new Promise(setImmediate);
  release();
  await first;
  assert.equal(calls.summarized.length, 1);
});

test("mensagens de falha dizem o que fazer", () => {
  assert.match(summaryFailureMessage("ollama-unavailable"), /Abra o Ollama/);
  assert.match(summaryFailureMessage("timeout"), /demorou demais/);
  assert.match(summaryFailureMessage("ollama-http-404"), /modelo/);
  assert.match(summaryFailureMessage("invalid-response"), /Tente de novo/);
});
