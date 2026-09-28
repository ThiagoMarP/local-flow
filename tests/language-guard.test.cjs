const assert = require("node:assert/strict");
const test = require("node:test");
const { looksLikeLanguageDrift } = require("../src/main/services/language-guard.cjs");

test("detecta ditado em português que o Parakeet ouviu como inglês", () => {
  // Saída real do Parakeet para uma fala em português.
  const result = looksLikeLanguageDrift(
    "I preciso de algum lugar to hospedar tocar para rodar, to have those questions. " +
      "And my reunion with Flávio, he followed that he was for a Martin.",
  );
  assert.equal(result.drifted, true);
  assert.ok(result.englishHits > result.portugueseHits);
});

test("português cheio de termos técnicos em inglês continua português", () => {
  for (const text of [
    "Faz o deploy e roda o build, depois dá um push na main.",
    "Vibe coding com Claude Code: o agent roda os tests e faz o commit.",
    "O projeto usa Electron, TypeScript, Whisper e Ollama.",
    "Crie uma função assíncrona que valide o token antes de chamar a API.",
  ]) {
    assert.equal(looksLikeLanguageDrift(text).drifted, false, text);
  }
});

test("palavras que existem nos dois idiomas não contam como inglês", () => {
  // "for", "a", "no" e "do" são comuns em português.
  const result = looksLikeLanguageDrift("Se ele for a Recife, não do jeito que falamos no começo.");
  assert.equal(result.englishHits, 0);
  assert.equal(result.drifted, false);
});

test("detecta ditado que o Parakeet escreveu em cirílico ou grego", () => {
  // Saída real do Parakeet para "e pode seguir".
  assert.equal(looksLikeLanguageDrift("Ипоти").drifted, true);
  assert.equal(looksLikeLanguageDrift("Ипоти").foreignScript, true);
  assert.equal(looksLikeLanguageDrift("Então, Привет, pode seguir.").drifted, true);
  assert.equal(looksLikeLanguageDrift("Καλημέρα").drifted, true);
});

test("acentos do português não contam como alfabeto estrangeiro", () => {
  const result = looksLikeLanguageDrift("Ação, pão, avó, você, à tarde, lingüiça.");
  assert.equal(result.foreignScript, false);
  assert.equal(result.drifted, false);
});

test("textos curtos não disparam o detector", () => {
  assert.equal(looksLikeLanguageDrift("OK").drifted, false);
  assert.equal(looksLikeLanguageDrift("Thank you.").drifted, false);
  assert.equal(looksLikeLanguageDrift("").drifted, false);
});
