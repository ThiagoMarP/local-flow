import assert from "node:assert/strict";
import test from "node:test";
import { ruleRowIssues, rowsToRules } from "../src/renderer/rule-table.js";

const keys = { sourceKey: "from", targetKey: "to" };

test("linhas viram regras; origem vazia é rascunho e fica de fora", () => {
  assert.deepEqual(
    rowsToRules([
      { source: "  zap ", target: " WhatsApp " },
      { source: "", target: "sobra" },
      { source: "tipo", target: "" },
    ], keys),
    [{ from: "zap", to: "WhatsApp" }, { from: "tipo", to: "" }],
  );
});

// Snippets guardam quebras de linha de verdade: sem a sintaxe \n.
test("snippet mantém as quebras de linha internas", () => {
  assert.deepEqual(
    rowsToRules([{ source: "assinatura", target: "Abraço,\r\nThiago\n" }], {
      sourceKey: "trigger",
      targetKey: "expansion",
    }),
    [{ trigger: "assinatura", expansion: "Abraço,\nThiago" }],
  );
});

// Hoje o normalizador descarta essas linhas em silêncio; a tabela explica.
test("aponta as linhas que seriam ignoradas", () => {
  assert.deepEqual(
    ruleRowIssues([
      { source: "zap", target: "WhatsApp" },
      { source: "ZAP", target: "Zap" },
      { source: "igual", target: "igual" },
      { source: "", target: "" },
      { source: "vazio", target: "  " },
    ], { allowEmptyTarget: false }),
    [null, "duplicate", "same", null, "empty-target"],
  );
  assert.equal(
    ruleRowIssues([{ source: "tipo", target: "" }], { allowEmptyTarget: true })[0],
    null,
  );
});
