import assert from "node:assert/strict";
import test from "node:test";
import { formatTimeSaved, timeSavedMinutes } from "../src/renderer/stats.js";

// Estimativa: digitar a 40 palavras/min contra falar a 150.
test("calcula os minutos economizados ao ditar em vez de digitar", () => {
  assert.equal(timeSavedMinutes(0), 0);
  assert.equal(Math.round(timeSavedMinutes(600) * 10) / 10, 11);
  assert.equal(timeSavedMinutes(-5), 0);
});

test("formata o tempo economizado de forma curta", () => {
  assert.equal(formatTimeSaved(0), "0 min");
  assert.equal(formatTimeSaved(0.4), "< 1 min");
  assert.equal(formatTimeSaved(11), "11 min");
  assert.equal(formatTimeSaved(59.6), "1 h");
  assert.equal(formatTimeSaved(83), "1 h 23 min");
});
