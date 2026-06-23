import assert from "node:assert/strict";
import test from "node:test";
import {
  downsample,
  encodeWav,
  joinAndEncode,
} from "../src/renderer/audio.js";

test("reduz áudio de 48 kHz para 16 kHz", () => {
  const input = new Float32Array(48000).fill(0.25);
  const output = downsample(input, 48000, 16000);
  assert.equal(output.length, 16000);
  assert.ok(Math.abs(output[100] - 0.25) < 0.001);
});

test("gera cabeçalho WAV PCM mono de 16 kHz", () => {
  const wav = encodeWav(new Float32Array(16000), 16000);
  const view = new DataView(wav.buffer);
  assert.equal(new TextDecoder().decode(wav.slice(0, 4)), "RIFF");
  assert.equal(new TextDecoder().decode(wav.slice(8, 12)), "WAVE");
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint16(34, true), 16);
});

test("junta blocos antes de gerar o WAV", () => {
  const wav = joinAndEncode(
    [new Float32Array(8000), new Float32Array(8000)],
    16000,
    16000,
  );
  assert.equal(wav.byteLength, 44 + 16000 * 2);
});

