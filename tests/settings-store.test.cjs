const assert = require("node:assert/strict");
const test = require("node:test");
const { mkdtemp, readFile, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  DEFAULT_SETTINGS,
  SettingsStore,
  normalizeSettings,
} = require("../src/main/services/settings-store.cjs");

test("normaliza configurações fora do schema", () => {
  const settings = normalizeSettings({
    profile: "invalid",
    vocabulary: ["  Ollama  ", "Ollama", "", 42],
    maxRecordingSeconds: 9999,
    autoPaste: "yes",
    revisionMode: "invalid",
    revisionModel: "../../bad model",
    revisionTimeoutMs: 999999,
    writingProfile: "invalid",
    replacements: [
      { from: "  zap ", to: "WhatsApp" },
      { from: "ZAP", to: "duplicado" },
    ],
    snippets: [
      { trigger: "assinatura", expansion: "Atenciosamente,\nMarcos" },
    ],
  });
  assert.equal(settings.profile, "standard");
  assert.deepEqual(settings.vocabulary, ["Ollama", "42"]);
  assert.equal(settings.maxRecordingSeconds, 600);
  assert.equal(settings.autoPaste, true);
  assert.equal(settings.revisionMode, "literal");
  assert.equal(settings.revisionModel, "qwen2.5:3b");
  assert.equal(settings.revisionTimeoutMs, 60000);
  assert.equal(settings.writingProfile, "neutral");
  assert.deepEqual(settings.replacements, [
    { from: "zap", to: "WhatsApp" },
  ]);
  assert.equal(settings.snippets.length, 1);
});

test("persiste atualização parcial", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lf-settings-"));
  const filePath = path.join(directory, "settings.json");
  const store = new SettingsStore({ filePath });
  await store.load();
  await store.update({ profile: "fast", autoPaste: false });

  const next = new SettingsStore({ filePath });
  await next.load();
  assert.equal(next.get().profile, "fast");
  assert.equal(next.get().autoPaste, false);
  assert.equal(next.get().restoreClipboard, false);
  assert.equal(next.get().revisionMode, "literal");
  assert.equal(next.get().writingProfile, "neutral");
});

test("aceita Parakeet no ditado e mantém reuniões nos modelos Whisper", () => {
  const settings = normalizeSettings({ profile: "parakeet", meetingProfile: "parakeet" });
  assert.equal(settings.profile, "parakeet");
  assert.equal(settings.meetingProfile, "fast");
});

test("aceita o modo experimental sem alterar o padrão literal", () => {
  assert.equal(normalizeSettings({ revisionMode: "light" }).revisionMode, "light");
  assert.equal(normalizeSettings({ revisionMode: "fast" }).revisionMode, "fast");
  assert.equal(DEFAULT_SETTINGS.revisionMode, "literal");
});

test("recupera JSON inválido e cria backup", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lf-settings-"));
  const filePath = path.join(directory, "settings.json");
  await writeFile(filePath, "{invalid", "utf8");
  const store = new SettingsStore({ filePath });
  const value = await store.load();
  assert.deepEqual(value, DEFAULT_SETTINGS);
  const saved = JSON.parse(await readFile(filePath, "utf8"));
  assert.equal(saved.version, 8);
});

test("migra configurações da versão anterior", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lf-settings-"));
  const filePath = path.join(directory, "settings.json");
  await writeFile(
    filePath,
    JSON.stringify({ version: 1, profile: "fast" }),
    "utf8",
  );
  const store = new SettingsStore({ filePath });
  await store.load();
  const saved = JSON.parse(await readFile(filePath, "utf8"));
  assert.equal(saved.version, 8);
  assert.equal(saved.profile, "fast");
  assert.equal(saved.revisionMode, "literal");
  assert.equal(saved.writingProfile, "neutral");
});

// O atalho global de colar a última pode brigar com outro app (Colar Especial
// do Word, Extract Variable da JetBrains), então dá para trocar ou desligar.
test("atalho de colar a última aceita só a lista conhecida ou desativado", () => {
  assert.equal(DEFAULT_SETTINGS.repasteShortcut, "CommandOrControl+Alt+V");
  assert.equal(normalizeSettings({}).repasteShortcut, "CommandOrControl+Alt+V");
  assert.equal(
    normalizeSettings({ repasteShortcut: "CommandOrControl+Alt+B" }).repasteShortcut,
    "CommandOrControl+Alt+B",
  );
  assert.equal(normalizeSettings({ repasteShortcut: "off" }).repasteShortcut, "off");
  assert.equal(
    normalizeSettings({ repasteShortcut: "Alt+F4" }).repasteShortcut,
    "CommandOrControl+Alt+V",
  );
});

test("expõe as opções e o rótulo do atalho de colar a última", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lf-settings-"));
  const store = new SettingsStore({ filePath: path.join(directory, "settings.json") });
  await store.load();
  await store.update({ repasteShortcut: "off" });
  const settings = store.getPublic();
  assert.equal(settings.repasteShortcutDisplay, "Desativado");
  assert.deepEqual(
    settings.allowedRepasteShortcuts.map((item) => item.label),
    ["Ctrl+Alt+V", "Ctrl+Alt+B", "Ctrl+Alt+Shift+V", "Desativado"],
  );
});
