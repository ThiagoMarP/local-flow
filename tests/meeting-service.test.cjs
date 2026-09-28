const test = require("node:test");
const assert = require("node:assert");

function wav(seconds) {
  const bytes = seconds * 32000;
  const buffer = Buffer.alloc(44 + bytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + bytes, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16000, 24);
  buffer.writeUInt32LE(32000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(bytes, 40);
  return buffer;
}
const {
  buildLabeledTranscript,
  collapseConsecutive,
  interleaveSegments,
  MeetingService,
} = require("../src/main/services/meeting-service.cjs");

test("collapseConsecutive remove repetições idênticas do mesmo canal", () => {
  const out = collapseConsecutive([
    { from: 0, to: 1000, text: "loop" },
    { from: 1000, to: 2000, text: "loop" },
    { from: 2000, to: 3000, text: "loop" },
    { from: 3000, to: 4000, text: "fim" },
  ]);
  assert.deepStrictEqual(
    out.map((segment) => segment.text),
    ["loop", "fim"],
  );
  assert.strictEqual(out[0].to, 3000);
});

test("mantém a mesma palavra quando repetida após pausa longa", () => {
  const segments = collapseConsecutive([
    { from: 0, to: 1000, text: "sim" },
    { from: 120000, to: 121000, text: "sim" },
  ]);
  assert.equal(segments.length, 2);
  assert.equal(buildLabeledTranscript([{ speaker: "mic", segments }]).text, "[Você] sim sim");
});

test("intercala falas dos dois canais por tempo e rotula", () => {
  const result = buildLabeledTranscript([
    {
      speaker: "mic",
      segments: [
        { from: 0, to: 2000, text: "oi" },
        { from: 5000, to: 6000, text: "beleza" },
      ],
    },
    {
      speaker: "system",
      segments: [{ from: 2500, to: 4000, text: "tudo bem?" }],
    },
  ]);
  assert.strictEqual(
    result.text,
    "[Você] oi\n[Chamada] tudo bem?\n[Você] beleza",
  );
  assert.strictEqual(result.turns.length, 3);
});

test("agrupa falas consecutivas do mesmo interlocutor", () => {
  const result = buildLabeledTranscript([
    {
      speaker: "mic",
      segments: [
        { from: 0, to: 1000, text: "uma" },
        { from: 1000, to: 2000, text: "duas" },
      ],
    },
    { speaker: "system", segments: [] },
  ]);
  assert.strictEqual(result.text, "[Você] uma duas");
  assert.strictEqual(result.turns.length, 1);
});

test("colapsa repetições consecutivas idênticas (loop do whisper)", () => {
  const result = buildLabeledTranscript([
    {
      speaker: "system",
      segments: [
        { from: 0, to: 1000, text: "olá pessoal" },
        { from: 1000, to: 2000, text: "olá pessoal" },
        { from: 2000, to: 3000, text: "olá pessoal" },
        { from: 3000, to: 4000, text: "tudo certo" },
      ],
    },
    { speaker: "mic", segments: [] },
  ]);
  assert.strictEqual(result.text, "[Chamada] olá pessoal tudo certo");
  assert.strictEqual(result.turns.length, 1);
});

test("ignora trechos vazios e ordena por tempo", () => {
  const ordered = interleaveSegments([
    {
      speaker: "mic",
      segments: [
        { from: 3000, to: 4000, text: "depois" },
        { from: 0, to: 0, text: "  " },
      ],
    },
    { speaker: "system", segments: [{ from: 1000, to: 2000, text: "antes" }] },
  ]);
  assert.deepStrictEqual(
    ordered.map((segment) => segment.text),
    ["antes", "depois"],
  );
});

test("MeetingService.run injeta transcribeWav e monta a transcrição", async () => {
  const fake = async ({ wavBuffer, withTimestamps, allowEmpty }) => {
    assert.strictEqual(withTimestamps, true);
    assert.strictEqual(allowEmpty, true);
    return wavBuffer.length === 100
      ? {
          text: "minha fala",
          segments: [{ from: 1000, to: 2000, text: "minha fala" }],
        }
      : {
          text: "fala deles",
          segments: [{ from: 0, to: 500, text: "fala deles" }],
        };
  };
  const service = new MeetingService({
    transcribeWav: fake,
    projectRoot: ".",
    whisperCli: "x",
    modelsDir: "m",
  });
  const out = await service.run({
    micWav: Buffer.alloc(100),
    systemWav: Buffer.alloc(200),
  });
  assert.strictEqual(
    out.transcript,
    "[Chamada] fala deles\n[Você] minha fala",
  );
  assert.strictEqual(out.turns.length, 2);
});

test("MeetingService.run pula o canal vazio (modo só mic ou só sistema)", async () => {
  let calls = 0;
  const fake = async () => {
    calls += 1;
    return {
      text: "minha fala",
      segments: [{ from: 0, to: 1000, text: "minha fala" }],
    };
  };
  const service = new MeetingService({
    transcribeWav: fake,
    projectRoot: ".",
    whisperCli: "x",
    modelsDir: "m",
  });
  const out = await service.run({
    micWav: Buffer.alloc(2000),
    systemWav: Buffer.alloc(44),
  });
  assert.strictEqual(calls, 1);
  assert.strictEqual(out.transcript, "[Você] minha fala");
});

test("60 minutos em blocos de 10 s mantém cada inferência limitada e tempos corretos", async () => {
  const tenSeconds = wav(10);
  let reads = 0;
  let calls = 0;
  const service = new MeetingService({
    projectRoot: ".",
    whisperCli: "x",
    modelsDir: "m",
    readFileImpl: async () => { reads++; return tenSeconds; },
    transcribeWav: async ({ wavBuffer, withTimestamps, timeoutMs }) => {
      calls++;
      assert.equal(withTimestamps, true);
      assert.ok(wavBuffer.length <= 4 * 1024 * 1024, "janela não deve carregar reunião inteira");
      assert.ok(timeoutMs >= 120000);
      return { text: `fala ${calls}`, segments: [{ from: 0, to: 1000, text: `fala ${calls}` }] };
    },
  });
  const result = await service.runFromChunkFiles({ dir: "fixture", chunkCount: 360 });
  assert.equal(reads, 720);
  assert.equal(calls, 60); // 30 janelas de dois minutos, dois canais
  assert.equal(result.durationSeconds, 3600);
  assert.equal(result.segments.at(-1).from, 3480000);
});

test("falhas em canais e janelas preservam falas transcritas e marcam resultado parcial", async () => {
  const tenSeconds = wav(10);
  let call = 0;
  const service = new MeetingService({
    readFileImpl: async () => tenSeconds,
    transcribeWav: async () => {
      call += 1;
      if (call === 2 || call === 3) throw new Error(`falha ${call}`);
      const text = call === 1 ? "primeira fala" : "fala final";
      return { text, segments: [{ from: 0, to: 1000, text }] };
    },
  });

  const result = await service.runFromChunkFiles({ dir: "fixture", chunkCount: 13 });
  assert.equal(call, 4);
  assert.equal(result.transcript, "[Você] primeira fala\n[Chamada] fala final");
  assert.deepEqual(result.segments.map(({ from, text }) => ({ from, text })), [
    { from: 0, text: "primeira fala" },
    { from: 120000, text: "fala final" },
  ]);
  assert.equal(result.durationSeconds, 130);
  assert.equal(result.partial, true);
  assert.deepEqual(result.failures.map(({ startChunk, endChunk, speaker }) =>
    ({ startChunk, endChunk, speaker })), [
    { startChunk: 0, endChunk: 12, speaker: "system" },
    { startChunk: 12, endChunk: 13, speaker: "mic" },
  ]);
});

test("nenhum segmento utilizável lança erro com falhas detalhadas", async () => {
  const service = new MeetingService({
    readFileImpl: async () => wav(1),
    transcribeWav: async () => { throw new Error("ASR indisponível"); },
  });
  await assert.rejects(service.runFromChunkFiles({ dir: "fixture", chunkCount: 1 }), (error) => {
    assert.match(error.message, /nenhum trecho/i);
    assert.equal(error.failures.length, 2);
    assert.deepEqual(error.failures.map(({ speaker }) => speaker), ["mic", "system"]);
    return true;
  });
});

test("uma janela inteira com falha não descarta a janela seguinte", async () => {
  let calls = 0;
  const service = new MeetingService({
    readFileImpl: async () => wav(1),
    transcribeWav: () => {
      calls += 1;
      if (calls <= 2) throw new Error("falha imediata");
      return { text: "recuperado", segments: [{ from: 0, to: 1000, text: "recuperado" }] };
    },
  });
  const result = await service.runFromChunkFiles({ dir: "fixture", chunkCount: 13 });
  assert.equal(calls, 4);
  assert.equal(result.partial, true);
  assert.equal(result.failures.length, 2);
  assert.equal(result.segments[0].from, 12000);
  assert.equal(result.transcript, "[Você] recuperado\n[Chamada] recuperado");
});
