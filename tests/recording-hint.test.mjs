import assert from "node:assert/strict";
import test from "node:test";
import { recordingHint } from "../src/renderer/recording-hint.js";

const base = { elapsedMs: 0, limitMs: 120_000, heardSound: true, showEscHint: true };

test("ensina o Esc só no começo da gravação", () => {
  assert.deepEqual(recordingHint({ ...base, elapsedMs: 500 }), { hint: "esc", remainingMs: 0 });
  assert.deepEqual(recordingHint({ ...base, elapsedMs: 2600 }), { hint: null, remainingMs: 0 });
  // Depois de aprendido, a dica some de vez.
  assert.deepEqual(
    recordingHint({ ...base, elapsedMs: 500, showEscHint: false }),
    { hint: null, remainingMs: 0 },
  );
});

// Pausas no meio da fala são normais; o aviso é para o microfone que não
// captou nada desde o início (mudo, desligado ou o dispositivo errado).
test("avisa microfone mudo só se nada foi captado desde o início", () => {
  const silent = { ...base, heardSound: false };
  assert.equal(recordingHint({ ...silent, elapsedMs: 2900 }).hint, null);
  assert.equal(recordingHint({ ...silent, elapsedMs: 3000 }).hint, "silent");
  assert.equal(recordingHint({ ...silent, elapsedMs: 30_000 }).hint, "silent");
  assert.equal(recordingHint({ ...base, elapsedMs: 30_000 }).hint, null);
});

test("conta os últimos 10 segundos antes do limite", () => {
  assert.equal(recordingHint({ ...base, elapsedMs: 109_999 }).hint, null);
  assert.deepEqual(
    recordingHint({ ...base, elapsedMs: 110_000 }),
    { hint: "countdown", remainingMs: 10_000 },
  );
  assert.deepEqual(
    recordingHint({ ...base, elapsedMs: 125_000 }),
    { hint: "countdown", remainingMs: 0 },
  );
});

test("a contagem tem prioridade sobre o aviso de microfone mudo", () => {
  assert.equal(
    recordingHint({ ...base, limitMs: 10_000, heardSound: false, elapsedMs: 4000 }).hint,
    "countdown",
  );
});

test("sem limite configurado não há contagem", () => {
  assert.equal(recordingHint({ ...base, limitMs: 0, elapsedMs: 600_000 }).hint, null);
});
