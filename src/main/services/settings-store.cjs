const {
  mkdir,
  readFile,
  rename,
  writeFile,
} = require("node:fs/promises");
const path = require("node:path");

const SETTINGS_VERSION = 1;
const ALLOWED_PROFILES = new Set(["fast", "standard", "accurate"]);
const ALLOWED_SHORTCUTS = new Map([
  ["CommandOrControl+Shift+Space", "Ctrl+Shift+Espaço"],
  ["CommandOrControl+Alt+D", "Ctrl+Alt+D"],
  ["CommandOrControl+Shift+D", "Ctrl+Shift+D"],
]);

const DEFAULT_SETTINGS = Object.freeze({
  version: SETTINGS_VERSION,
  profile: "standard",
  vocabulary: ["Electron", "TypeScript", "Whisper", "Ollama"],
  shortcut: "CommandOrControl+Shift+Space",
  microphoneId: "default",
  autoPaste: true,
  restoreClipboard: true,
  maxRecordingSeconds: 120,
  launchAtLogin: false,
  startMinimized: false,
});

function normalizeVocabulary(value) {
  if (!Array.isArray(value)) return [...DEFAULT_SETTINGS.vocabulary];
  const unique = [];
  for (const item of value) {
    const term = String(item || "").trim().slice(0, 80);
    if (term && !unique.includes(term)) unique.push(term);
    if (unique.length >= 100) break;
  }
  return unique;
}

function normalizeSettings(value = {}) {
  const profile = ALLOWED_PROFILES.has(value.profile)
    ? value.profile
    : DEFAULT_SETTINGS.profile;
  const shortcut = ALLOWED_SHORTCUTS.has(value.shortcut)
    ? value.shortcut
    : DEFAULT_SETTINGS.shortcut;
  const maxRecordingSeconds = Math.round(
    Math.max(
      10,
      Math.min(
        600,
        Number(value.maxRecordingSeconds) ||
          DEFAULT_SETTINGS.maxRecordingSeconds,
      ),
    ),
  );

  return {
    version: SETTINGS_VERSION,
    profile,
    vocabulary: normalizeVocabulary(value.vocabulary),
    shortcut,
    microphoneId:
      String(value.microphoneId || DEFAULT_SETTINGS.microphoneId)
        .trim()
        .slice(0, 256) || DEFAULT_SETTINGS.microphoneId,
    autoPaste:
      typeof value.autoPaste === "boolean"
        ? value.autoPaste
        : DEFAULT_SETTINGS.autoPaste,
    restoreClipboard:
      typeof value.restoreClipboard === "boolean"
        ? value.restoreClipboard
        : DEFAULT_SETTINGS.restoreClipboard,
    maxRecordingSeconds,
    launchAtLogin:
      typeof value.launchAtLogin === "boolean"
        ? value.launchAtLogin
        : DEFAULT_SETTINGS.launchAtLogin,
    startMinimized:
      typeof value.startMinimized === "boolean"
        ? value.startMinimized
        : DEFAULT_SETTINGS.startMinimized,
  };
}

function publicSettings(settings) {
  return {
    ...settings,
    shortcutDisplay:
      ALLOWED_SHORTCUTS.get(settings.shortcut) ||
      ALLOWED_SHORTCUTS.get(DEFAULT_SETTINGS.shortcut),
    allowedShortcuts: [...ALLOWED_SHORTCUTS.entries()].map(
      ([value, label]) => ({ value, label }),
    ),
  };
}

class SettingsStore {
  constructor({ filePath, logger } = {}) {
    if (!filePath) throw new Error("filePath é obrigatório.");
    this.filePath = filePath;
    this.logger = logger;
    this.value = { ...DEFAULT_SETTINGS };
  }

  async load() {
    try {
      const raw = await readFile(this.filePath, "utf8");
      this.value = normalizeSettings(JSON.parse(raw));
    } catch (error) {
      if (error.code !== "ENOENT") {
        await this.backupInvalidFile().catch(() => {});
        await this.logger?.warn("settings_recovered", {
          reason: error.name,
        });
      }
      this.value = { ...DEFAULT_SETTINGS };
      await this.writeAtomic(this.value);
    }
    return this.get();
  }

  get() {
    return structuredClone(this.value);
  }

  getPublic() {
    return publicSettings(this.value);
  }

  async update(patch) {
    const next = normalizeSettings({ ...this.value, ...patch });
    await this.writeAtomic(next);
    this.value = next;
    return this.get();
  }

  async reset() {
    return this.update({ ...DEFAULT_SETTINGS });
  }

  async backupInvalidFile() {
    const backup = `${this.filePath}.invalid-${Date.now()}`;
    await rename(this.filePath, backup);
  }

  async writeAtomic(value) {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(
      tempPath,
      `${JSON.stringify(value, null, 2)}\n`,
      "utf8",
    );
    await rename(tempPath, this.filePath);
  }
}

module.exports = {
  ALLOWED_SHORTCUTS,
  DEFAULT_SETTINGS,
  SettingsStore,
  normalizeSettings,
  publicSettings,
};

