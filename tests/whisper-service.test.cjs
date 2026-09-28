const assert = require("node:assert/strict");
const test = require("node:test");
const {
  extractTranscription,
  getModelPath,
  runProcess,
  stripNonSpeech,
  transcribeWav,
  validateWav,
} = require("../src/main/whisper-service.cjs");

function createPcmWav({ sampleRate = 16000, seconds = 1 } = {}) {
  const samples = sampleRate * seconds;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(samples * 2, 40);
  return buffer;
}

test("valida WAV PCM mono de 16 kHz", () => {
  const info = validateWav(createPcmWav({ seconds: 2 }));
  assert.equal(info.sampleRate, 16000);
  assert.equal(info.channels, 1);
  assert.equal(info.durationSeconds, 2);
});

test("rejeita áudio fora de 16 kHz", () => {
  assert.throws(
    () => validateWav(createPcmWav({ sampleRate: 44100 })),
    /16 kHz/,
  );
});

test("extrai e normaliza segmentos da transcrição", () => {
  const text = extractTranscription({
    transcription: [{ text: " Olá " }, { text: " mundo." }],
  });
  assert.equal(text, "Olá mundo.");
});

test("remove anotações de não-fala alucinadas", () => {
  assert.equal(
    stripNonSpeech("Olá [MÚSICA DE FUNDO] mundo"),
    "Olá mundo",
  );
  assert.equal(stripNonSpeech("[BLANK_AUDIO]"), "");
  assert.equal(stripNonSpeech("♪♪ tudo bem ♪"), "tudo bem");
  assert.equal(stripNonSpeech("texto normal"), "texto normal");
});

test("rejeita perfil de modelo não permitido", () => {
  assert.throws(
    () => getModelPath("C:\\projeto", "..\\outro"),
    /Perfil de modelo inválido/,
  );
});

test("Whisper não inicia um trabalho previamente cancelado", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    transcribeWav({ wavBuffer: createPcmWav(), signal: controller.signal }),
    { name: "AbortError", code: "ABORT_ERR" },
  );
});

test("cancelar Whisper encerra o subprocesso em andamento", async () => {
  const controller = new AbortController();
  const running = runProcess(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    { signal: controller.signal, timeoutMs: 5000 },
  );
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(running, { name: "AbortError", code: "ABORT_ERR" });
});
