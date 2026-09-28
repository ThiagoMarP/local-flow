const assert = require("node:assert/strict");
const test = require("node:test");
const {
  lstat,
  mkdtemp,
  rm,
  stat,
  symlink,
} = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const {
  MODEL_CATALOG,
  ModelInstaller,
  ensureWritableModelsDir,
  resolveModelEntry,
} = require("../src/main/services/model-installer.cjs");

async function withTempDir(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lf-models-"));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("resolveModelEntry rejeita perfil inválido", () => {
  assert.throws(() => resolveModelEntry("nope"), /Perfil de modelo inválido/);
});

test("o catálogo cobre Whisper e Parakeet", () => {
  assert.deepEqual(
    Object.keys(MODEL_CATALOG).sort(),
    ["accurate", "fast", "parakeet", "standard"],
  );
});

test("status reporta indisponível quando o arquivo não existe", async () => {
  await withTempDir(async (dir) => {
    const installer = new ModelInstaller({ modelsDir: dir });
    const status = await installer.status();
    assert.equal(Object.keys(status).length, 4);
    assert.equal(status.standard.available, false);
    assert.equal(status.standard.bytes, 0);
  });
});

test("repara junction quebrada da pasta de modelos", async () => {
  await withTempDir(async (dir) => {
    const modelsDir = path.join(dir, "models");
    const missingTarget = path.join(dir, "destino-removido");
    await symlink(missingTarget, modelsDir, "junction");

    await ensureWritableModelsDir(modelsDir);

    const info = await stat(modelsDir);
    assert.equal(info.isDirectory(), true);
    assert.equal((await lstat(modelsDir)).isSymbolicLink(), false);
  });
});

test("download grava o modelo, renomeia e emite progresso", async () => {
  await withTempDir(async (dir) => {
    const payload = Buffer.from("conteudo-falso-do-modelo-whisper");
    const transport = async () => ({
      ok: true,
      status: 200,
      total: payload.length,
      stream: Readable.from([payload]),
    });
    const installer = new ModelInstaller({
      modelsDir: dir,
      transport,
      minRatio: 0,
    });
    const events = [];
    const result = await installer.download("fast", {
      onProgress: (progress) => events.push(progress),
    });

    assert.equal(result.bytes, payload.length);
    const written = await stat(path.join(dir, MODEL_CATALOG.fast.file));
    assert.equal(written.size, payload.length);
    assert.ok(events.some((event) => event.done));
    assert.equal(installer.isDownloading("fast"), false);
    await assert.rejects(() =>
      stat(path.join(dir, `${MODEL_CATALOG.fast.file}.part`)),
    );
  });
});

test("download com resposta de erro propaga e limpa o parcial", async () => {
  await withTempDir(async (dir) => {
    const transport = async () => ({
      ok: false,
      status: 404,
      total: 0,
      stream: null,
    });
    const installer = new ModelInstaller({
      modelsDir: dir,
      transport,
      minRatio: 0,
    });
    await assert.rejects(() => installer.download("fast"), /HTTP 404/);
    await assert.rejects(() =>
      stat(path.join(dir, `${MODEL_CATALOG.fast.file}.part`)),
    );
  });
});

test("download abaixo do tamanho mínimo é tratado como incompleto", async () => {
  await withTempDir(async (dir) => {
    const payload = Buffer.from("curto");
    const transport = async () => ({
      ok: true,
      status: 200,
      total: payload.length,
      stream: Readable.from([payload]),
    });
    const installer = new ModelInstaller({ modelsDir: dir, transport });
    await assert.rejects(() => installer.download("fast"), /incompleto/);
  });
});
