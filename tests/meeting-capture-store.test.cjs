const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { mkdtemp, readdir, rm } = require("node:fs/promises");
const { MeetingCaptureStore } = require("../src/main/services/meeting-capture-store.cjs");

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

test("salva blocos em ordem e recupera gravação interrompida após reinício", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "lf-meeting-chunks-"));
  try {
    const store = new MeetingCaptureStore({ baseDir: base });
    const { id } = await store.start({ mode: "mic" });
    await store.append({ id, index: 0, micWav: wav(10), systemWav: wav(0) });
    await store.append({ id, index: 1, micWav: wav(10), systemWav: wav(0) });
    // Simula queda depois do rename atômico do segundo bloco, antes de atualizar meta.json.
    await store.writeMeta(id, { ...(await store.readMeta(id)), chunkCount: 1, durationSeconds: 10 });
    const resumed = new MeetingCaptureStore({ baseDir: base });
    const [pending] = await resumed.recoverPending();
    assert.equal(pending.id, id);
    assert.equal(pending.state, "processing");
    assert.equal(pending.interrupted, true);
    assert.equal(pending.chunkCount, 2);
    assert.equal(pending.durationSeconds, 20);
    assert.equal(pending.systemSeconds, 0);
    assert.deepEqual((await readdir(path.join(base, id, "chunks"))).sort(), ["000000", "000001"]);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("bloco inválido não avança a captura; não salva par incompleto", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "lf-meeting-chunks-"));
  try {
    const store = new MeetingCaptureStore({ baseDir: base });
    const { id } = await store.start();
    await assert.rejects(store.append({ id, index: 0, micWav: wav(10), systemWav: Buffer.from("bad") }), /vazio|formato|incompleto/);
    assert.equal((await store.readMeta(id)).chunkCount, 0);
    assert.deepEqual(await readdir(path.join(base, id, "chunks")), []);
    await assert.rejects(store.append({ id, index: 1, micWav: wav(10), systemWav: wav(10) }), /fora de ordem/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
