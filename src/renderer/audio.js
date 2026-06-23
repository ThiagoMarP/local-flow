export function downsample(input, inputRate, outputRate) {
  if (inputRate === outputRate) return input;
  const ratio = inputRate / outputRate;
  const outputLength = Math.round(input.length / ratio);
  const output = new Float32Array(outputLength);
  for (let index = 0; index < outputLength; index++) {
    const start = Math.round(index * ratio);
    const end = Math.min(Math.round((index + 1) * ratio), input.length);
    let sum = 0;
    for (let sourceIndex = start; sourceIndex < end; sourceIndex++) {
      sum += input[sourceIndex];
    }
    output[index] = sum / Math.max(1, end - start);
  }
  return output;
}

export function encodeWav(samples, sampleRate = 16000) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeAscii = (offset, text) => {
    for (let index = 0; index < text.length; index++) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (const sample of samples) {
    const value = Math.max(-1, Math.min(1, sample));
    view.setInt16(
      offset,
      value < 0 ? value * 32768 : value * 32767,
      true,
    );
    offset += 2;
  }
  return new Uint8Array(buffer);
}

export function joinAndEncode(chunks, inputRate, outputRate = 16000) {
  const sampleCount = chunks.reduce(
    (total, chunk) => total + chunk.length,
    0,
  );
  const joined = new Float32Array(sampleCount);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return encodeWav(downsample(joined, inputRate, outputRate), outputRate);
}

