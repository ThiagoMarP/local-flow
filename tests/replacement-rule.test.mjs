import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { appendReplacementRule } from "../src/renderer/replacement-rule.js";
const require = createRequire(import.meta.url);
const {
  PersonalizationService,
  normalizeReplacements,
} = require("../src/main/services/personalization-service.cjs");

test("regra explícita preserva as existentes e aceita remoção", () => {
  const existing = [{ from: "zap", to: "WhatsApp" }];
  const next = appendReplacementRule(existing, " tipo ", " ");
  assert.deepEqual(next, [
    { from: "zap", to: "WhatsApp" },
    { from: "tipo", to: "" },
  ]);
  assert.deepEqual(existing, [{ from: "zap", to: "WhatsApp" }]);
  assert.deepEqual(normalizeReplacements(next), next);
  assert.equal(
    new PersonalizationService().applyReplacements("eu tipo envio no zap", next).text,
    "eu envio no WhatsApp",
  );
});

test("bloqueia origem duplicada e regras inválidas sem afetar a lista", () => {
  const existing = [{ from: "Local Flow", to: "LocalFlow" }];
  assert.throws(() => appendReplacementRule(existing, "local flow", "LF"), /Já existe/);
  assert.throws(() => appendReplacementRule(existing, "ditado inteiro => texto", "corrigido"), /sem quebra/);
  assert.throws(() => appendReplacementRule(existing, "a", "a"), /iguais/);
  assert.throws(() => appendReplacementRule(existing, "", "x"), /trecho errado/);
  assert.deepEqual(existing, [{ from: "Local Flow", to: "LocalFlow" }]);
});
