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
