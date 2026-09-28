const assert = require("node:assert/strict");
const test = require("node:test");
const { mkdtemp, rm, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  TranscriptionHistoryStore,
} = require("../src/main/services/transcription-history.cjs");

async function withStore(run, options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lf-history-"));
  const store = new TranscriptionHistoryStore({
    filePath: path.join(dir, "transcription-history.json"),
    ...options,
  });
  try {
    await run(store);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("lista vazia e last null quando ainda não há nada", async () => {
  await withStore(async (store) => {
    assert.deepEqual(await store.list(), []);
    assert.equal(await store.last(), null);
  });
});

test("guarda mais recente primeiro", async () => {
  await withStore(async (store) => {
    await store.add({ text: "primeira", at: 1 });
    await store.add({ text: "segunda", at: 2 });
    const items = await store.list();
    assert.equal(items.length, 2);
    assert.equal(items[0].text, "segunda");
    assert.equal(items[1].text, "primeira");
    assert.equal((await store.last()).text, "segunda");
  });
});

test("guarda original com resultado revisado e lê registros antigos", async () => {
  await withStore(async (store) => {
    await store.add({ text: "registro antigo", at: 1 });
    await store.add({ text: "às três", originalText: "às duas… não, às três", at: 2 });
    const items = await store.list();
    assert.equal(items[0].originalText, "às duas… não, às três");
    assert.equal(items[1].originalText, null);
  });
});

test("salva correção separada sem alterar o texto entregue nem o bruto", async () => {
  await withStore(async (store) => {
    const entry = await store.add({
      text: "O Loca Flow está aberto.",
      originalText: "O loca flo está aberto.",
      at: 1,
    });
    const corrected = await store.saveCorrection(entry.id, "O Local Flow está aberto.");
    assert.equal(corrected.correctedText, "O Local Flow está aberto.");
    const [saved] = await store.list();
    assert.equal(saved.text, "O Loca Flow está aberto.");
    assert.equal(saved.originalText, "O loca flo está aberto.");
    assert.equal(saved.correctedText, "O Local Flow está aberto.");
    assert.equal((await store.last()).correctedText, "O Local Flow está aberto.");

    await store.saveCorrection(entry.id, entry.text);
    assert.equal((await store.last()).correctedText, null);
  });
});

test("não apaga o ditado com correção vazia ou id inexistente", async () => {
  await withStore(async (store) => {
    const entry = await store.add({ text: "Ditado preservado", at: 1 });
    await assert.rejects(store.saveCorrection(entry.id, "   "), /não pode ficar vazia/);
    await assert.rejects(store.saveCorrection("outro", "Mudança"), /não encontrado/);
    await assert.rejects(store.saveCorrection(entry.id, "x".repeat(20001)), /até 20000/);
    assert.equal((await store.last()).text, "Ditado preservado");
    assert.equal((await store.last()).correctedText, null);
  });
});

test("adição simultânea à correção não perde nenhum ditado", async () => {
  await withStore(async (store) => {
    const first = await store.add({ text: "primeiro", at: 1 });
    await Promise.all([
      store.saveCorrection(first.id, "primeiro corrigido"),
      store.add({ text: "segundo", at: 2 }),
    ]);
    const items = await store.list();
    assert.deepEqual(items.map((item) => item.text), ["segundo", "primeiro"]);
    assert.equal(items[1].correctedText, "primeiro corrigido");
  });
});

test("migração legada ocorre uma vez e não ressurge após limpar", async () => {
  await withStore(async (store) => {
    const legacyPath = path.join(path.dirname(store.filePath), "last-transcription.json");
    await writeFile(legacyPath, JSON.stringify({ text: "ditado legado", at: 123 }));
    assert.equal(await store.migrateLegacyOnce(legacyPath), true);
    assert.equal((await store.last()).text, "ditado legado");
    await store.clear();

    const reopened = new TranscriptionHistoryStore({ filePath: store.filePath });
    assert.equal(await reopened.migrateLegacyOnce(legacyPath), false);
    assert.deepEqual(await reopened.list(), []);
  });
});

test("migração não sobrescreve histórico existente, mesmo vazio", async () => {
  await withStore(async (store) => {
    const legacyPath = path.join(path.dirname(store.filePath), "last-transcription.json");
    await writeFile(legacyPath, JSON.stringify({ text: "legado" }));
    await store.clear();
    assert.equal(await store.migrateLegacyOnce(legacyPath), false);
    assert.deepEqual(await store.list(), []);
    await store.add({ text: "novo", at: 1 });
    assert.equal(await store.migrateLegacyOnce(legacyPath), false);
    assert.equal((await store.last()).text, "novo");
  });
});

test("ausência de legado é registrada para impedir importação posterior", async () => {
  await withStore(async (store) => {
    const legacyPath = path.join(path.dirname(store.filePath), "last-transcription.json");
    assert.equal(await store.migrateLegacyOnce(legacyPath), false);
    await writeFile(legacyPath, JSON.stringify({ text: "tardio" }));
    assert.equal(await store.migrateLegacyOnce(legacyPath), false);
    assert.deepEqual(await store.list(), []);
  });
});

test("ignora texto vazio", async () => {
  await withStore(async (store) => {
    assert.equal(await store.add({ text: "   " }), null);
    assert.deepEqual(await store.list(), []);
  });
});

test("respeita o limite de itens", async () => {
  await withStore(
    async (store) => {
      await store.add({ text: "a", at: 1 });
      await store.add({ text: "b", at: 2 });
      await store.add({ text: "c", at: 3 });
      const items = await store.list();
      assert.equal(items.length, 2);
      assert.deepEqual(
        items.map((i) => i.text),
        ["c", "b"],
      );
    },
    { maxItems: 2 },
  );
});

test("remove por id e limpa tudo", async () => {
  await withStore(async (store) => {
    const a = await store.add({ text: "a", at: 1 });
    await store.add({ text: "b", at: 2 });
    await store.remove(a.id);
    assert.deepEqual(
      (await store.list()).map((i) => i.text),
      ["b"],
    );
    await store.clear();
    assert.deepEqual(await store.list(), []);
  });
});
