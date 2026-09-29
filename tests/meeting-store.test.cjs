const test = require("node:test");
const assert = require("node:assert");
const os = require("node:os");
const path = require("node:path");
const { mkdtemp, mkdir, writeFile, rm } = require("node:fs/promises");
const {
  MeetingStore,
  parseFolderDate,
} = require("../src/main/services/meeting-store.cjs");

function tempBase() {
  return mkdtemp(path.join(os.tmpdir(), "meeting-store-test-"));
}

test("parseFolderDate decodifica o nome da pasta", () => {
  assert.strictEqual(
    parseFolderDate("2026-06-30T19-11-05-350Z"),
    Date.parse("2026-06-30T19:11:05.350Z"),
  );
  assert.strictEqual(parseFolderDate("lixo"), null);
});

test("list ordena por data desc e carrega o resumo; get traz a transcrição", async () => {
  const base = await tempBase();
  try {
    const older = path.join(base, "2026-06-30T10-00-00-000Z");
    const newer = path.join(base, "2026-06-30T12-00-00-000Z");
    await mkdir(older);
    await mkdir(newer);
    await writeFile(
      path.join(older, "meta.json"),
      JSON.stringify({ at: 1000, durationSeconds: 30, turns: 2, summarized: true,
        state: "done", interrupted: true }),
    );
    await writeFile(path.join(older, "transcript.txt"), "[Você] oi");
    await writeFile(path.join(older, "resumo.md"), "## Resumo\n\nok");
    await writeFile(
      path.join(newer, "meta.json"),
      JSON.stringify({ at: 2000, durationSeconds: 10, turns: 1 }),
    );
    await writeFile(path.join(newer, "transcript.txt"), "[Chamada] e aí");

    const store = new MeetingStore({ baseDir: base });
    const list = await store.list();
    assert.strictEqual(list.length, 2);
    assert.strictEqual(list[0].at, 2000);

    const withSummary = list.find((m) => m.id.endsWith("10-00-00-000Z"));
    assert.strictEqual(withSummary.summary, "## Resumo\n\nok");
    assert.strictEqual(withSummary.hasSummary, true);
    assert.strictEqual(withSummary.hasTranscript, true);
    assert.strictEqual(withSummary.turns, 2);
    assert.strictEqual(withSummary.state, "done");
    assert.strictEqual(withSummary.interrupted, true);

    const full = await store.get(withSummary.id);
    assert.strictEqual(full.transcript, "[Você] oi");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("list deriva a data do nome quando não há meta.json", async () => {
  const base = await tempBase();
  try {
    const dir = path.join(base, "2026-06-30T08-00-00-000Z");
    await mkdir(dir);
    await writeFile(path.join(dir, "transcript.txt"), "x");
    const store = new MeetingStore({ baseDir: base });
    const [item] = await store.list();
    assert.strictEqual(item.at, Date.parse("2026-06-30T08:00:00.000Z"));
    assert.strictEqual(item.hasSummary, false);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("get rejeita identificadores de travessia de caminho", async () => {
  const base = await tempBase();
  try {
    const store = new MeetingStore({ baseDir: base });
    await assert.rejects(() => store.get(".."), /inválido/);
    await assert.rejects(() => store.get(""), /inválido/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("remove apaga a reunião e devolve a lista", async () => {
  const base = await tempBase();
  try {
    const dir = path.join(base, "2026-06-30T10-00-00-000Z");
    await mkdir(dir);
    await writeFile(path.join(dir, "transcript.txt"), "x");
    const store = new MeetingStore({ baseDir: base });
    assert.strictEqual((await store.list()).length, 1);
    const after = await store.remove("2026-06-30T10-00-00-000Z");
    assert.strictEqual(after.length, 0);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("remove preserva reuniões ainda gravando ou processando", async () => {
  const base = await tempBase();
  try {
    const store = new MeetingStore({ baseDir: base });
    for (const state of ["recording", "processing"]) {
      const id = `meeting-${state}`;
      const dir = path.join(base, id);
      await mkdir(dir);
      await writeFile(path.join(dir, "meta.json"), JSON.stringify({ state }));
      await assert.rejects(() => store.remove(id), /Aguarde a reunião terminar/);
      assert.strictEqual((await store.get(id)).state, state);
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

// Resumo gerado depois (Ollama estava fechado no processamento): grava o
// resumo e marca a reunião como resumida, sem mexer no resto do meta.
test("saveSummary grava o resumo e marca a reunião como resumida", async () => {
  const base = await tempBase();
  try {
    const id = "2026-06-30T10-00-00-000Z";
    await mkdir(path.join(base, id));
    await writeFile(path.join(base, id, "meta.json"),
      JSON.stringify({ at: 1000, turns: 3, summarized: false, state: "done" }));
    await writeFile(path.join(base, id, "transcript.txt"), "[Você] oi");
    const store = new MeetingStore({ baseDir: base });
    const saved = await store.saveSummary(id, "## Resumo\n\nok");
    assert.strictEqual(saved.hasSummary, true);
    assert.strictEqual(saved.summarized, true);
    assert.strictEqual(saved.turns, 3);
    assert.strictEqual(saved.summary, "## Resumo\n\nok");
    // Só grava numa reunião que existe (e o id nunca sai da pasta de reuniões).
    await assert.rejects(store.saveSummary("../x", "a"), /não encontrada/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

// As falas com horário ficam em turns.json; reuniões antigas não têm o arquivo.
test("get traz as falas com horário quando existem", async () => {
  const base = await tempBase();
  try {
    const withTurns = "2026-06-30T10-00-00-000Z";
    const legacy = "2026-06-30T11-00-00-000Z";
    await mkdir(path.join(base, withTurns));
    await mkdir(path.join(base, legacy));
    const turns = [{ speaker: "mic", label: "Você", text: "oi", from: 0, to: 900 }];
    await writeFile(path.join(base, withTurns, "turns.json"), JSON.stringify(turns));
    await writeFile(path.join(base, withTurns, "transcript.txt"), "[Você] oi");
    await writeFile(path.join(base, legacy, "transcript.txt"), "[Você] oi");
    const store = new MeetingStore({ baseDir: base });
    assert.deepStrictEqual((await store.get(withTurns)).transcriptTurns, turns);
    assert.strictEqual((await store.get(legacy)).transcriptTurns, null);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
