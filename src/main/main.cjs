const {
  app,
  clipboard,
  crashReporter,
  globalShortcut,
  ipcMain,
  powerMonitor,
  session,
} = require("electron");
const { mkdir, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { ClipboardService } = require("./services/clipboard-service.cjs");
const { cleanOldEntries } = require("./services/housekeeping.cjs");
const { LoginItemService } = require("./services/login-item-service.cjs");
const { PrivacyLogger } = require("./services/privacy-logger.cjs");
const { SettingsStore } = require("./services/settings-store.cjs");
const { TestHarness } = require("./services/test-harness.cjs");
const { WindowManager } = require("./services/window-manager.cjs");
const { ToggleDictationController } = require("./shortcut-controller.cjs");
const { WindowsBridge } = require("./windows-bridge.cjs");
const {
  inspectRuntime,
  transcribeWav,
} = require("./whisper-service.cjs");

const projectRoot = path.resolve(__dirname, "..", "..");
const startupStartedAt = Date.now();
const singleInstanceTestRun =
  process.env.LOCAL_FLOW_SINGLE_INSTANCE_TEST === "1";
const settingsTestRun =
  Boolean(process.env.LOCAL_FLOW_SETTINGS_TEST_WRITE) ||
  Boolean(process.env.LOCAL_FLOW_SETTINGS_TEST_EXPECT);
const automatedRun =
  process.env.LOCAL_FLOW_SMOKE_TEST === "1" ||
  Boolean(process.env.LOCAL_FLOW_CAPTURE_PATH) ||
  Boolean(process.env.LOCAL_FLOW_CAPTURE_CAPSULE_PATH) ||
  Boolean(process.env.LOCAL_FLOW_E2E_AUDIO) ||
  process.env.LOCAL_FLOW_MIC_SELF_TEST === "1" ||
  process.env.LOCAL_FLOW_TRAY_TEST === "1" ||
  process.env.LOCAL_FLOW_LIFECYCLE_TEST === "1" ||
  process.env.LOCAL_FLOW_SHORTCUT_TEST === "1" ||
  Boolean(process.env.LOCAL_FLOW_SHORTCUT_INPUT_TEST_FILE) ||
  Boolean(process.env.LOCAL_FLOW_INSERTION_TEST_AUDIO) ||
  settingsTestRun ||
  process.env.LOCAL_FLOW_METRICS_TEST === "1";
const persistentWindowRun =
  !automatedRun || process.env.LOCAL_FLOW_LIFECYCLE_TEST === "1";

let settingsStore;
let logger;
let windowsBridge;
let clipboardService;
let loginItemService;
let windowManager;
let testHarness;
let shortcutController;
let shortcutRegistered = false;
let shortcutRegistrationError = "";
let activeShortcut = "CommandOrControl+Shift+Space";
let transcriptionRunning = false;
let activeProfile = "standard";

if (process.env.LOCAL_FLOW_USER_DATA) {
  app.setPath("userData", path.resolve(process.env.LOCAL_FLOW_USER_DATA));
}
if (singleInstanceTestRun) app.disableHardwareAcceleration();
app.setPath(
  "crashDumps",
  path.join(app.getPath("userData"), "crashes"),
);
crashReporter.start({
  uploadToServer: false,
  productName: "Local Flow",
});

const hasSingleInstanceLock = automatedRun
  ? true
  : app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

function formatShortcut(accelerator) {
  return (
    settingsStore
      ?.getPublic()
      .allowedShortcuts.find((item) => item.value === accelerator)
      ?.label || accelerator
  );
}

function applyUiState(payload, options) {
  windowManager.applyUiState(payload, options);
}

function snapshotTextClipboard() {
  return clipboardService.snapshotText();
}

async function captureDictationTarget() {
  const target = await windowsBridge.captureForeground();
  if (!target) {
    return {
      hwnd: null,
      processId: null,
      processName: "",
      title: "",
      isSelf: false,
      clipboard: snapshotTextClipboard(),
    };
  }
  return {
    ...target,
    isSelf: Number(target.processId) === process.pid,
    clipboard: snapshotTextClipboard(),
  };
}

function createShortcutController() {
  shortcutController = new ToggleDictationController({
    captureTarget: captureDictationTarget,
    onStart: async () => {
      applyUiState({
        state: "processing",
        message: "Abrindo microfone…",
        profile: activeProfile,
      });
      windowManager.dashboardWindow.webContents.send(
        "dictation:command",
        { action: "start", source: "shortcut" },
      );
    },
    onStop: async () => {
      windowManager.dashboardWindow.webContents.send(
        "dictation:command",
        { action: "stop", source: "shortcut" },
      );
    },
  });
}

function handleGlobalShortcut() {
  if (process.env.LOCAL_FLOW_SHORTCUT_INPUT_TEST_FILE) {
    const target = path.resolve(
      process.env.LOCAL_FLOW_SHORTCUT_INPUT_TEST_FILE,
    );
    mkdir(path.dirname(target), { recursive: true })
      .then(() =>
        writeFile(
          target,
          JSON.stringify({
            triggeredAt: new Date().toISOString(),
            accelerator: activeShortcut,
          }),
        ),
      )
      .then(() => {
        console.log("LOCAL_FLOW_SHORTCUT_INPUT_TRIGGERED");
        app.quit();
      })
      .catch((error) => {
        console.error(
          `LOCAL_FLOW_SHORTCUT_INPUT_ERROR=${error.stack || error.message}`,
        );
        app.exit(1);
      });
    return;
  }
  if (process.env.LOCAL_FLOW_SHORTCUT_TEST === "1") {
    console.log("LOCAL_FLOW_SHORTCUT_TRIGGERED");
    setTimeout(() => app.quit(), 100);
    return;
  }
  shortcutController.toggle().catch((error) => {
    shortcutController.fail();
    logger.error("shortcut_toggle_failed", error);
    applyUiState({
      state: "error",
      message: "O atalho não pôde iniciar o ditado.",
      profile: activeProfile,
    });
  });
}

function registerDictationShortcut(shortcut = settingsStore.get().shortcut) {
  globalShortcut.unregisterAll();
  activeShortcut = shortcut;
  shortcutRegistered = globalShortcut.register(
    activeShortcut,
    handleGlobalShortcut,
  );
  shortcutRegistrationError = shortcutRegistered
    ? ""
    : `${formatShortcut(activeShortcut)} já está sendo usado por outro aplicativo.`;
  windowManager?.setShortcutStatus({
    registered: shortcutRegistered,
    display: formatShortcut(activeShortcut),
  });
  console.log(
    `LOCAL_FLOW_SHORTCUT_READY=${JSON.stringify({
      accelerator: activeShortcut,
      registered: shortcutRegistered,
    })}`,
  );
  if (
    shortcutRegistered &&
    process.env.LOCAL_FLOW_SHORTCUT_TEST === "1"
  ) {
    setTimeout(() => app.quit(), 300);
  }
}

function updateShortcut(nextShortcut) {
  const previous = activeShortcut;
  registerDictationShortcut(nextShortcut);
  if (shortcutRegistered) return true;
  registerDictationShortcut(previous);
  return false;
}

async function onDashboardReady(window) {
  return testHarness.onDashboardReady(window);
}

async function onCapsuleReady(window) {
  return testHarness.onCapsuleReady(window, applyUiState);
}

function configureMicrophonePermission() {
  session.defaultSession.setPermissionCheckHandler(
    (webContents, permission, requestingOrigin, details) => {
      const requestsAudio =
        !details?.mediaType ||
        details.mediaType === "audio" ||
        details.mediaType === "unknown";
      return (
        webContents === windowManager.dashboardWindow?.webContents &&
        permission === "media" &&
        requestingOrigin.startsWith("file://") &&
        details?.isMainFrame !== false &&
        requestsAudio
      );
    },
  );
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      const mediaTypes = details?.mediaTypes;
      const requestsAudio =
        !mediaTypes ||
        mediaTypes.length === 0 ||
        mediaTypes.includes("audio");
      const trustedPage =
        webContents === windowManager.dashboardWindow?.webContents &&
        details?.isMainFrame !== false &&
        String(details?.requestingUrl || "").startsWith("file://");
      callback(permission === "media" && requestsAudio && trustedPage);
    },
  );
}

if (hasSingleInstanceLock) {
  app.on("second-instance", () => {
    windowManager?.showDashboard();
    if (singleInstanceTestRun) {
      console.log("LOCAL_FLOW_SINGLE_INSTANCE_OK");
      app.quit();
    }
  });
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  logger = new PrivacyLogger({
    directory: path.join(app.getPath("userData"), "logs"),
  });
  settingsStore = new SettingsStore({
    filePath: path.join(app.getPath("userData"), "settings.json"),
    logger,
  });
  await settingsStore.load();
  if (process.env.LOCAL_FLOW_SETTINGS_TEST_WRITE) {
    const patch = JSON.parse(process.env.LOCAL_FLOW_SETTINGS_TEST_WRITE);
    const saved = await settingsStore.update(patch);
    console.log(`LOCAL_FLOW_SETTINGS_WRITTEN=${JSON.stringify(saved)}`);
    app.quit();
    return;
  }
  if (process.env.LOCAL_FLOW_SETTINGS_TEST_EXPECT) {
    const expected = JSON.parse(
      process.env.LOCAL_FLOW_SETTINGS_TEST_EXPECT,
    );
    const current = settingsStore.get();
    for (const [key, value] of Object.entries(expected)) {
      if (JSON.stringify(current[key]) !== JSON.stringify(value)) {
        console.error(
          `LOCAL_FLOW_SETTINGS_MISMATCH=${JSON.stringify({ key, expected: value, actual: current[key] })}`,
        );
        app.exit(1);
        return;
      }
    }
    console.log(
      `LOCAL_FLOW_SETTINGS_PERSISTED=${JSON.stringify(expected)}`,
    );
    app.quit();
    return;
  }
  const settings = settingsStore.get();
  activeProfile = settings.profile;
  const shouldStartHidden =
    process.argv.includes("--hidden") || settings.startMinimized;
  if (singleInstanceTestRun) {
    console.log("LOCAL_FLOW_SINGLE_INSTANCE_PRIMARY_READY");
    return;
  }

  windowsBridge = new WindowsBridge({
    scriptPath: path.join(
      projectRoot,
      "native",
      "windows",
      "foreground-helper.ps1",
    ),
  });
  windowsBridge.start();
  clipboardService = new ClipboardService({ clipboard, windowsBridge });
  loginItemService = new LoginItemService({ app, projectRoot });
  if (!automatedRun && !singleInstanceTestRun) {
    loginItemService.apply(settings.launchAtLogin);
  }

  await cleanOldEntries({
    baseDir: path.join(os.tmpdir(), "local-flow"),
    prefix: "job-",
    olderThanMs: 6 * 60 * 60 * 1000,
    logger,
  });
  await logger.prune();
  await logger.info("app_ready", {
    version: app.getVersion(),
    profile: settings.profile,
    startHidden: shouldStartHidden,
  });
  if (process.env.LOCAL_FLOW_METRICS_TEST === "1") {
    const metrics = app.getAppMetrics();
    const workingSetKb = metrics.reduce(
      (total, item) =>
        total + Number(item.memory?.workingSetSize || 0),
      0,
    );
    console.log(
      `LOCAL_FLOW_METRICS=${JSON.stringify({
        startupMs: Date.now() - startupStartedAt,
        processCount: metrics.length,
        workingSetMb: Math.round(workingSetKb / 1024),
        scope: "bootstrap-before-renderers",
      })}`,
    );
    app.quit();
    return;
  }

  windowManager = new WindowManager({
    projectRoot,
    logger,
    automatedRun,
    persistentWindowRun,
    shouldStartHidden,
    onDashboardReady,
    onCapsuleReady,
    onQuit: () => app.quit(),
  });
  testHarness = new TestHarness({
    app,
    clipboard,
    clipboardService,
    projectRoot,
    transcribeWav,
    windowManager,
    windowsBridge,
  });
  windowManager.setProfile(activeProfile);
  windowManager.createAll({
    dashboardQuery:
      process.env.LOCAL_FLOW_MIC_SELF_TEST === "1"
        ? { selfTest: "microphone" }
        : process.env.LOCAL_FLOW_SETTINGS_PREVIEW === "1"
          ? { settingsPreview: "1" }
        : undefined,
  });
  configureMicrophonePermission();
  createShortcutController();
  registerDictationShortcut();

  if (
    !automatedRun ||
    process.env.LOCAL_FLOW_TRAY_TEST === "1" ||
    process.env.LOCAL_FLOW_LIFECYCLE_TEST === "1"
  ) {
    windowManager.createTray();
    console.log("LOCAL_FLOW_TRAY_READY");
    if (process.env.LOCAL_FLOW_TRAY_TEST === "1") {
      setTimeout(() => app.quit(), 500);
    }
  }

  app.on("activate", () => windowManager.showDashboard());
  const cancelForSystemState = (reason) => {
    windowManager.dashboardWindow?.webContents.send(
      "dictation:command",
      { action: "cancel", source: reason },
    );
    shortcutController?.fail();
    applyUiState({
      state: "idle",
      message: "Pronto",
      profile: activeProfile,
    });
    logger.warn("dictation_cancelled_by_system", { reason });
  };
  powerMonitor.on("suspend", () => cancelForSystemState("suspend"));
  powerMonitor.on("lock-screen", () =>
    cancelForSystemState("lock-screen"),
  );
});

app.on("before-quit", () => windowManager?.beginQuit());
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  windowsBridge?.dispose();
  logger?.flush();
});
app.on("window-all-closed", () => {
  if (automatedRun) app.quit();
});

process.on("uncaughtException", (error) => {
  logger?.error("uncaught_exception", error);
});
process.on("unhandledRejection", (error) => {
  logger?.error(
    "unhandled_rejection",
    error instanceof Error ? error : new Error("Unhandled rejection"),
  );
});

ipcMain.handle("runtime:inspect", async () => ({
  ...(await inspectRuntime(projectRoot)),
  shortcut: {
    accelerator: activeShortcut,
    display: formatShortcut(activeShortcut),
    mode: "toggle",
    registered: shortcutRegistered,
    error: shortcutRegistrationError,
  },
  settings: settingsStore.getPublic(),
  loginItem:
    automatedRun || singleInstanceTestRun ? null : loginItemService.get(),
}));

ipcMain.handle("transcription:run", async (_event, payload) => {
  if (transcriptionRunning) {
    throw new Error("Já existe uma transcrição em andamento.");
  }
  transcriptionRunning = true;
  const shortcutTarget =
    shortcutController?.state === "processing"
      ? shortcutController.target
      : null;
  try {
    const settings = settingsStore.get();
    const profile = payload?.profile || settings.profile;
    const vocabulary = Array.isArray(payload?.vocabulary)
      ? payload.vocabulary
      : settings.vocabulary;
    const result = await transcribeWav({
      projectRoot,
      wavBuffer: Buffer.from(payload.audio),
      profile,
      vocabulary,
      threads: 24,
    });
    const insertion = shortcutTarget
      ? await clipboardService.insert(
          result.text,
          shortcutTarget,
          settings,
        )
      : (() => {
          clipboard.writeText(result.text);
          return {
            autoPasted: false,
            clipboardRestored: false,
            reason: "manual-recording",
          };
        })();
    shortcutController?.complete();
    await logger.info("dictation_completed", {
      profile,
      elapsedMs: result.elapsedMs,
      durationSeconds: result.durationSeconds,
      autoPasted: insertion.autoPasted,
      clipboardRestored: insertion.clipboardRestored,
      fallbackReason: insertion.reason,
    });
    return {
      ...result,
      copiedToClipboard: true,
      ...insertion,
    };
  } catch (error) {
    shortcutController?.fail();
    await logger.error("dictation_failed", error);
    throw error;
  } finally {
    transcriptionRunning = false;
  }
});

ipcMain.handle("clipboard:write", (_event, text) => {
  clipboard.writeText(String(text));
  return true;
});

ipcMain.handle("settings:get", () => settingsStore.getPublic());
ipcMain.handle("settings:update", async (_event, patch) => {
  const previous = settingsStore.get();
  const desiredShortcut = patch?.shortcut || previous.shortcut;
  if (
    desiredShortcut !== previous.shortcut &&
    !updateShortcut(desiredShortcut)
  ) {
    throw new Error(`${formatShortcut(desiredShortcut)} já está em uso.`);
  }
  try {
    const next = await settingsStore.update(patch || {});
    activeProfile = next.profile;
    if (
      next.launchAtLogin !== previous.launchAtLogin &&
      !automatedRun &&
      !singleInstanceTestRun
    ) {
      loginItemService.apply(next.launchAtLogin);
    }
    windowManager.setProfile(activeProfile);
    applyUiState({
      ...windowManager.currentUiState,
      profile: activeProfile,
    });
    await logger.info("settings_updated", {
      changedKeys: Object.keys(patch || {}),
    });
    return settingsStore.getPublic();
  } catch (error) {
    if (desiredShortcut !== previous.shortcut) {
      updateShortcut(previous.shortcut);
    }
    throw error;
  }
});

ipcMain.handle("settings:reset", async () => {
  const previous = settingsStore.get();
  const defaults = await settingsStore.reset();
  updateShortcut(defaults.shortcut);
  activeProfile = defaults.profile;
  windowManager.setProfile(activeProfile);
  if (
    previous.launchAtLogin &&
    !automatedRun &&
    !singleInstanceTestRun
  ) {
    loginItemService.apply(false);
  }
  return settingsStore.getPublic();
});

ipcMain.handle("selftest:report", (_event, result) => {
  if (process.env.LOCAL_FLOW_MIC_SELF_TEST !== "1") {
    throw new Error("O autoteste do microfone não está habilitado.");
  }
  console.log(`LOCAL_FLOW_MIC_OK=${JSON.stringify(result)}`);
  setTimeout(() => app.quit(), 100);
  return true;
});

ipcMain.on("ui:update-state", (_event, payload) => {
  applyUiState(payload);
});
ipcMain.on("dictation:event", (_event, payload) => {
  if (["error", "cancelled"].includes(payload?.type)) {
    shortcutController?.fail();
  }
});
ipcMain.handle(
  "ui:get-state",
  () => windowManager.currentUiState,
);
ipcMain.handle("app:show-dashboard", () => {
  windowManager.showDashboard();
  return true;
});
ipcMain.handle("app:hide-dashboard", () => {
  windowManager.hideDashboard();
  return true;
});
