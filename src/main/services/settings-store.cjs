const {
  mkdir,
  readFile,
  rename,
  writeFile,
} = require("node:fs/promises");
const path = require("node:path");
const {
  WRITING_PROFILES,
  normalizeReplacements,
  normalizeSnippets,
} = require("./personalization-service.cjs");
const {
  DEFAULT_MODEL,
  DEFAULT_TIMEOUT_MS,
  REVISION_MODES,
  normalizeModel,
} = require("./revision-service.cjs");

const SETTINGS_VERSION = 8;
const ALLOWED_PROFILES = new Set(["fast", "standard", "accurate", "parakeet"]);
// Parakeet reports per-word timestamps (verbose_json / --json), which meetings
// need to interleave the two speakers, so it is valid here too.
const ALLOWED_MEETING_PROFILES = new Set(["fast", "standard", "accurate", "parakeet"]);
const ALLOWED_MEETING_CAPTURE_MODES = new Map([
  ["both", "Meu microfone + áudio do sistema"],
  ["mic", "Só o meu microfone"],
  ["system", "Só o áudio do sistema"],
]);
const ALLOWED_SHORTCUTS = new Map([
  ["CommandOrControl+Shift+Space", "Ctrl+Shift+Espaço"],
  ["CommandOrControl+Alt+D", "Ctrl+Alt+D"],
  ["CommandOrControl+Shift+D", "Ctrl+Shift+D"],
]);
// Separate list for the meeting shortcut. All Ctrl+Alt+… to dodge the browser's
// Ctrl+Shift+R (reload) and Ctrl+Shift+J/I/C (devtools), and never overlapping
// the dictation accelerators above.
const ALLOWED_MEETING_SHORTCUTS = new Map([
  ["CommandOrControl+Alt+R", "Ctrl+Alt+R"],
  ["CommandOrControl+Alt+M", "Ctrl+Alt+M"],
  ["CommandOrControl+Alt+G", "Ctrl+Alt+G"],
  ["CommandOrControl+Alt+L", "Ctrl+Alt+L"],
]);

// Global "paste the last transcription again". Every option is Ctrl+Alt+… so
// none overlaps the dictation or meeting lists; "off" frees the combo for an
// app that needs it (Word's Paste Special, JetBrains' Extract Variable).
const REPASTE_SHORTCUT_OFF = "off";
const ALLOWED_REPASTE_SHORTCUTS = new Map([
  ["CommandOrControl+Alt+V", "Ctrl+Alt+V"],
  ["CommandOrControl+Alt+B", "Ctrl+Alt+B"],
  ["CommandOrControl+Alt+Shift+V", "Ctrl+Alt+Shift+V"],
  [REPASTE_SHORTCUT_OFF, "Desativado"],
]);

const DEFAULT_SETTINGS = Object.freeze({
  version: SETTINGS_VERSION,
  profile: "standard",
  vocabulary: ["Electron", "TypeScript", "Whisper", "Ollama"],
  shortcut: "CommandOrControl+Shift+Space",
  meetingShortcut: "CommandOrControl+Alt+R",
  repasteShortcut: "CommandOrControl+Alt+V",
  meetingCaptureMode: "both",
  // Reunião tem modelo próprio (independente do ditado): whisper rápido por
  // padrão (prioriza velocidade) e o LLM do resumo separado.
  meetingProfile: "fast",
  meetingSummaryModel: DEFAULT_MODEL,
  nativeHotkey: true,
  microphoneId: "default",
  autoPaste: true,
  // Off by default: restoring the previous clipboard after pasting would push
  // the transcription to the penultimate spot in the Windows clipboard history,
  // so a plain Ctrl+V wouldn't paste it. Keep the transcription as the current
  // clipboard entry instead.
  restoreClipboard: false,
  maxRecordingSeconds: 120,
  // Switch in Settings → Revisão local. Off pastes the text as transcribed,
  // without the AI step; revisionMode is kept for when it is turned back on.
  revisionEnabled: true,
  revisionMode: "literal",
  revisionModel: DEFAULT_MODEL,
  revisionTimeoutMs: DEFAULT_TIMEOUT_MS,
  writingProfile: "neutral",
  replacements: [],
  snippets: [],
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
  const meetingShortcut = ALLOWED_MEETING_SHORTCUTS.has(value.meetingShortcut)
    ? value.meetingShortcut
    : DEFAULT_SETTINGS.meetingShortcut;
  const repasteShortcut = ALLOWED_REPASTE_SHORTCUTS.has(value.repasteShortcut)
    ? value.repasteShortcut
    : DEFAULT_SETTINGS.repasteShortcut;
  const meetingCaptureMode = ALLOWED_MEETING_CAPTURE_MODES.has(
    value.meetingCaptureMode,
  )
    ? value.meetingCaptureMode
    : DEFAULT_SETTINGS.meetingCaptureMode;
  const meetingProfile = ALLOWED_MEETING_PROFILES.has(value.meetingProfile)
    ? value.meetingProfile
    : DEFAULT_SETTINGS.meetingProfile;
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
    meetingShortcut,
    repasteShortcut,
    meetingCaptureMode,
    meetingProfile,
    meetingSummaryModel: normalizeModel(
      value.meetingSummaryModel,
      DEFAULT_SETTINGS.meetingSummaryModel,
    ),
    nativeHotkey:
      typeof value.nativeHotkey === "boolean"
        ? value.nativeHotkey
        : DEFAULT_SETTINGS.nativeHotkey,
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
    revisionEnabled:
      typeof value.revisionEnabled === "boolean"
        ? value.revisionEnabled
        : DEFAULT_SETTINGS.revisionEnabled,
    revisionMode: REVISION_MODES.has(value.revisionMode)
      ? value.revisionMode
      : DEFAULT_SETTINGS.revisionMode,
    revisionModel: normalizeModel(
      value.revisionModel,
      DEFAULT_SETTINGS.revisionModel,
    ),
    revisionTimeoutMs: Math.round(
      Math.max(
        3000,
        Math.min(
          60000,
          Number(value.revisionTimeoutMs) ||
            DEFAULT_SETTINGS.revisionTimeoutMs,
        ),
      ),
    ),
    writingProfile: WRITING_PROFILES.has(value.writingProfile)
      ? value.writingProfile
      : DEFAULT_SETTINGS.writingProfile,
    replacements: normalizeReplacements(value.replacements),
    snippets: normalizeSnippets(value.snippets),
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
    meetingShortcutDisplay:
      ALLOWED_MEETING_SHORTCUTS.get(settings.meetingShortcut) ||
      ALLOWED_MEETING_SHORTCUTS.get(DEFAULT_SETTINGS.meetingShortcut),
    allowedMeetingShortcuts: [...ALLOWED_MEETING_SHORTCUTS.entries()].map(
      ([value, label]) => ({ value, label }),
    ),
    repasteShortcutDisplay:
      ALLOWED_REPASTE_SHORTCUTS.get(settings.repasteShortcut) ||
      ALLOWED_REPASTE_SHORTCUTS.get(DEFAULT_SETTINGS.repasteShortcut),
    allowedRepasteShortcuts: [...ALLOWED_REPASTE_SHORTCUTS.entries()].map(
      ([value, label]) => ({ value, label }),
    ),
    allowedMeetingCaptureModes: [
      ...ALLOWED_MEETING_CAPTURE_MODES.entries(),
    ].map(([value, label]) => ({ value, label })),
    allowedRevisionModes: [...REVISION_MODES.entries()].map(
      ([value, label]) => ({ value, label }),
    ),
    allowedWritingProfiles: [...WRITING_PROFILES.entries()].map(
      ([value, profile]) => ({ value, label: profile.label }),
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
      const parsed = JSON.parse(raw);
      this.value = normalizeSettings(parsed);
      if (parsed.version !== SETTINGS_VERSION) {
        await this.writeAtomic(this.value);
      }
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
  ALLOWED_MEETING_SHORTCUTS,
  ALLOWED_MEETING_CAPTURE_MODES,
  ALLOWED_REPASTE_SHORTCUTS,
  REPASTE_SHORTCUT_OFF,
  DEFAULT_SETTINGS,
  SettingsStore,
  normalizeSettings,
  publicSettings,
};
