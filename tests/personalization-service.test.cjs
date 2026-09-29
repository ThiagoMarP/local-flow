const assert = require("node:assert/strict");
const test = require("node:test");
const {
  PersonalizationService,
  normalizeReplacements,
  normalizeSnippets,
  resolvePersonalizationOptions,
} = require("../src/main/services/personalization-service.cjs");

test("substitui frases maiores primeiro sem cascata", () => {
  const service = new PersonalizationService();
  const result = service.applyReplacements(
    "Abra o Local Flow e depois abra o fluxo.",
    [
      { from: "local flow", to: "Local Flow" },
      { from: "flow", to: "fluxo" },
      { from: "fluxo", to: "pipeline" },
    ],
  );
  assert.equal(
    result.text,
    "Abra o Local Flow e depois abra o pipeline.",
  );
  assert.equal(result.applied, 2);
});

test("substituição pode remover uma expressão", () => {
  const service = new PersonalizationService();
  const result = service.applyReplacements("eu tipo vou enviar", [
    { from: "tipo", to: "" },
  ]);
  assert.equal(result.text, "eu vou enviar");
  assert.equal(result.applied, 1);
});

test("snippet preserva conteúdo multilinha", () => {
  const service = new PersonalizationService();
  const result = service.expandSnippets("adicione minha assinatura", [
    {
      trigger: "minha assinatura",
      expansion: "Atenciosamente,\nMarcos",
    },
  ]);
  assert.equal(
    result.text,
    "adicione Atenciosamente,\nMarcos",
  );
  assert.equal(result.applied, 1);
});

test("normalização limita e remove gatilhos duplicados", () => {
  assert.deepEqual(
    normalizeReplacements([
      { from: " Whisper ", to: "whisper.cpp" },
      { from: "whisper", to: "duplicado" },
    ]),
    [{ from: "Whisper", to: "whisper.cpp" }],
  );
  assert.deepEqual(
    normalizeSnippets([
      { trigger: " assinatura ", expansion: " A\nB " },
    ]),
    [{ trigger: "assinatura", expansion: "A\nB" }],
  );
});

test("opções do payload têm prioridade sobre configurações", () => {
  const options = resolvePersonalizationOptions(
    {
      writingProfile: "casual",
      replacements: [{ from: "a", to: "b" }],
    },
    {
      writingProfile: "professional",
      replacements: [],
      snippets: [{ trigger: "x", expansion: "y" }],
    },
  );
  assert.equal(options.writingProfile, "casual");
  assert.equal(options.replacements.length, 1);
  assert.equal(options.snippets.length, 1);
});

// O campo de teste das Configurações mostra exatamente o que o ditado faria:
// substituições primeiro, snippets depois (a revisão por IA fica de fora).
test("prévia aplica substituições e depois snippets", () => {
  const service = new PersonalizationService();
  const result = service.preview({
    text: "manda zap com minha assinatura",
    replacements: [{ from: "zap", to: "WhatsApp" }],
    snippets: [{ trigger: "minha assinatura", expansion: "Abraço,\nThiago" }],
  });
  assert.deepEqual(result, {
    text: "manda WhatsApp com Abraço,\nThiago",
    replacementsApplied: 1,
    snippetsExpanded: 1,
  });
});

test("prévia tolera entrada vazia ou inválida", () => {
  const service = new PersonalizationService();
  assert.deepEqual(service.preview({}), { text: "", replacementsApplied: 0, snippetsExpanded: 0 });
  assert.equal(service.preview({ text: "x".repeat(5000) }).text.length, 2000);
});

// Remover uma palavra no começo ou no fim deixava um espaço sobrando, que ia
// junto na colagem (achado pelo campo de teste das Configurações).
test("remover trecho nas pontas não deixa espaço sobrando", () => {
  const service = new PersonalizationService();
  const rules = [{ from: "tipo", to: "" }];
  assert.equal(service.applyReplacements("tipo manda agora", rules).text, "manda agora");
  assert.equal(service.applyReplacements("manda agora tipo", rules).text, "manda agora");
  assert.equal(service.applyReplacements("manda tipo agora", rules).text, "manda agora");
});
