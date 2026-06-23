const assert = require("node:assert/strict");
const test = require("node:test");
const {
  extractTranscription,
  getModelPath,
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

test("rejeita perfil de modelo não permitido", () => {
  assert.throws(
    () => getModelPath("C:\\projeto", "..\\outro"),
    /Perfil de modelo inválido/,
  );
});

