const test = require("node:test");
const assert = require("node:assert");
const {
  MeetingSummaryService,
  cleanMarkdown,
} = require("../src/main/services/meeting-summary-service.cjs");

test("cleanMarkdown remove cerca de código e preâmbulo antes do título", () => {
  assert.strictEqual(
    cleanMarkdown("```markdown\n# Ata\n\n## Resumo\nok\n```"),
    "# Ata\n\n## Resumo\nok",
  );
  assert.strictEqual(
    cleanMarkdown("Claro! Aqui está a ata:\n# Ata da Reunião\n## Resumo\nok"),
    "# Ata da Reunião\n## Resumo\nok",
  );
  assert.strictEqual(cleanMarkdown(""), "");
});

test("summarize retorna a ata em markdown do modelo", async () => {
  const fake = async (url, options) => {
    assert.match(url, /\/api\/generate$/);
    const body = JSON.parse(options.body);
    assert.strictEqual(body.format, undefined);
    assert.match(body.system, /Ata da Reunião/);
    return {
      ok: true,
      json: async () => ({
        response: "# Ata da Reunião\n\n## Resumo Executivo\nTudo certo.",
      }),
    };
  };
  const service = new MeetingSummaryService({ fetchImpl: fake });
  const out = await service.summarize("[Você] oi\n[Chamada] tudo bem?");
  assert.strictEqual(out.applied, true);
  assert.match(out.markdown, /## Resumo Executivo/);
});

test("summarize faz fallback quando o Ollama está offline", async () => {
  const fake = async () => {
    throw new TypeError("fetch failed");
  };
  const service = new MeetingSummaryService({ fetchImpl: fake });
  const out = await service.summarize("[Você] oi");
  assert.strictEqual(out.applied, false);
  assert.strictEqual(out.reason, "ollama-unavailable");
  assert.strictEqual(out.markdown, null);
});

test("summarize faz fallback quando a resposta não tem título", async () => {
  const fake = async () => ({
    ok: true,
    json: async () => ({ response: "só um texto solto sem markdown" }),
  });
  const service = new MeetingSummaryService({ fetchImpl: fake });
  const out = await service.summarize("[Você] oi");
  assert.strictEqual(out.applied, false);
  assert.strictEqual(out.reason, "invalid-response");
});

test("summarize faz fallback com entrada vazia", async () => {
  const service = new MeetingSummaryService({ fetchImpl: async () => ({}) });
  const out = await service.summarize("");
  assert.strictEqual(out.applied, false);
  assert.strictEqual(out.reason, "empty-input");
});

const { summaryBudget } = require("../src/main/services/meeting-summary-service.cjs");

// Uma reunião de ~40 min tinha o começo cortado (num_ctx fixo em 8192) e
// estourava o limite de 45 s mesmo no modelo pequeno. O orçamento acompanha o
// tamanho da transcrição.
test("contexto e tempo limite acompanham o tamanho da reunião", () => {
  const short = summaryBudget("x".repeat(3000));
  assert.strictEqual(short.numCtx, 8192);
  assert.ok(short.timeoutMs >= 90000);

  const fortyMinutes = summaryBudget("x".repeat(45000));
  assert.ok(fortyMinutes.numCtx >= 15000 + 2000, `numCtx ${fortyMinutes.numCtx}`);
  assert.strictEqual(fortyMinutes.numCtx % 1024, 0);
  assert.ok(fortyMinutes.timeoutMs > short.timeoutMs);

  const huge = summaryBudget("x".repeat(400000));
  assert.strictEqual(huge.numCtx, 32768);
  assert.strictEqual(huge.timeoutMs, 900000);
});

test("pede sem raciocínio e com o contexto do orçamento", async () => {
  let body;
  const fake = async (_url, options) => {
    body = JSON.parse(options.body);
    return { ok: true, json: async () => ({ response: "# Ata da Reunião\n\n## Resumo Executivo\nok" }) };
  };
  const service = new MeetingSummaryService({ fetchImpl: fake });
  const transcript = "[Você] fala longa ".repeat(3000);
  await service.summarize(transcript);
  assert.strictEqual(body.think, false);
  assert.strictEqual(body.options.num_ctx, summaryBudget(transcript.trim()).numCtx);
  assert.ok(body.options.num_ctx > 8192);
});

test("tempo limite configurado menor não corta reunião longa", async () => {
  let aborted = false;
  const fake = (_url, options) => new Promise((resolve) => {
    options.signal.addEventListener("abort", () => { aborted = true; });
    setTimeout(() => resolve({ ok: true, json: async () => ({ response: "# Ata\n\nok" }) }), 1500);
  });
  const service = new MeetingSummaryService({ fetchImpl: fake, timeoutMs: 1000 });
  const out = await service.summarize("[Você] oi");
  assert.strictEqual(aborted, false);
  assert.strictEqual(out.applied, true);
});
