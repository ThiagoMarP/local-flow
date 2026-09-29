import assert from "node:assert/strict";
import test from "node:test";
import { formatOffset, transcriptTurns } from "../src/renderer/meeting-transcript.js";

test("usa as falas com horário quando a reunião tem turns.json", () => {
  const turns = transcriptTurns({
    transcriptTurns: [
      { speaker: "mic", label: "Você", text: "Bom dia", from: 1200, to: 3000 },
      { speaker: "system", label: "Chamada", text: "Oi", from: 65_000, to: 66_000 },
    ],
    transcript: "ignorado",
  });
  assert.deepEqual(turns, [
    { speaker: "mic", label: "Você", text: "Bom dia", from: 1200 },
    { speaker: "system", label: "Chamada", text: "Oi", from: 65_000 },
  ]);
});

// Reuniões gravadas antes do turns.json só têm o texto "[Rótulo] fala".
test("reunião antiga: lê as falas do texto, sem horário", () => {
  assert.deepEqual(
    transcriptTurns({
      transcriptTurns: null,
      transcript: "[Você] primeira linha\ncontinua aqui\n[Chamada] resposta\n\n",
    }),
    [
      { speaker: "mic", label: "Você", text: "primeira linha\ncontinua aqui", from: null },
      { speaker: "system", label: "Chamada", text: "resposta", from: null },
    ],
  );
  assert.deepEqual(transcriptTurns({ transcript: "texto sem rótulo" }), [
    { speaker: "system", label: "", text: "texto sem rótulo", from: null },
  ]);
  assert.deepEqual(transcriptTurns({ transcript: "" }), []);
});

test("formata o minuto da fala", () => {
  assert.equal(formatOffset(null), "");
  assert.equal(formatOffset(0), "0:00");
  assert.equal(formatOffset(65_400), "1:05");
  assert.equal(formatOffset(3_725_000), "1:02:05");
});
