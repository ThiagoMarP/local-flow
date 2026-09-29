const assert = require("node:assert/strict");
const test = require("node:test");
const { resolveRevisionMode } = require("../src/main/dictation-session.cjs");

// O painel manda o estado do switch junto com o ditado (vale na hora, antes do
// salvamento automático); sem ele, vale o que está salvo.
test("revisão desligada vira literal, ligada usa o modo escolhido", () => {
  const settings = { revisionEnabled: true, revisionMode: "clean" };
  assert.equal(resolveRevisionMode({ revisionMode: "prompt" }, settings), "prompt");
  assert.equal(resolveRevisionMode({}, settings), "clean");
  assert.equal(resolveRevisionMode({ revisionMode: "prompt", revisionEnabled: false }, settings), "literal");
  assert.equal(resolveRevisionMode({}, { ...settings, revisionEnabled: false }), "literal");
  assert.equal(
    resolveRevisionMode({ revisionEnabled: true }, { ...settings, revisionEnabled: false }),
    "clean",
  );
  assert.equal(resolveRevisionMode(undefined, settings), "clean");
});
