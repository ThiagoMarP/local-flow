const {
  app,
  clipboard,
  crashReporter,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  Notification,
  powerMonitor,
  session,
} = require("electron");
const os = require("node:os");
const path = require("node:path");
const { resolveAppPaths } = require("./services/app-paths.cjs");
const { ClipboardService } = require("./services/clipboard-service.cjs");
const { createTranscriber, inspectAsrRuntime } = require("./services/asr-service.cjs");
const { cleanOldEntries } = require("./services/housekeeping.cjs");
const { LoginItemService } = require("./services/login-item-service.cjs");
const { ModelInstaller } = require("./services/model-installer.cjs");
const { ParakeetServer } = require("./services/parakeet-server.cjs");
const { PrivacyLogger } = require("./services/privacy-logger.cjs");
const { RevisionService } = require("./services/revision-service.cjs");
const { detectRunMode } = require("./services/run-mode.cjs");
const { SettingsStore } = require("./services/settings-store.cjs");
const {
  TranscriptionHistoryStore,
} = require("./services/transcription-history.cjs");
const {
  TestHarness,
  handleShortcutTestTrigger,
  runHeadlessPipelineTest,
} = require("./services/test-harness.cjs");
const { TranscriptionPipeline } = require("./services/transcription-pipeline.cjs");
const { MeetingService } = require("./services/meeting-service.cjs");
const {
  MeetingSummaryService,
} = require("./services/meeting-summary-service.cjs");
const { MeetingStore } = require("./services/meeting-store.cjs");
const { MeetingCaptureStore } = require("./services/meeting-capture-store.cjs");
const { WindowManager } = require("./services/window-manager.cjs");
const { registerAppIpc } = require("./app-ipc.cjs");
const { DictationSession } = require("./dictation-session.cjs");
const { MeetingController } = require("./meeting-controller.cjs");
const { configureMicrophonePermission } = require("./permissions.cjs");
const { runSetupSelfTest, registerSetupIpc } = require("./setup-ipc.cjs");
const { LastTranscriptionPaster } = require("./repaste.cjs");
const { ShortcutRegistry } = require("./shortcut-registry.cjs");
const { ToggleDictationController } = require("./shortcut-controller.cjs");
const { EscapeShortcut } = require("./escape-shortcut.cjs");
const { createHotkeyTrigger } = require("./hotkey-listener.cjs");
const { WindowsBridge } = require("./windows-bridge.cjs");
const { transcribeWav } = require("./whisper-service.cjs");

const projectRoot = path.resolve(__dirname, "..", "..");
const startupStartedAt = Date.now();
const {
  automatedRun,
  e2eTestRun,
  personalizationTestRun,
  persistentWindowRun,
  revisionTestRun,
  settingsTestRun,
  singleInstanceTestRun,
} = detectRunMode();

let settingsStore, logger;
let windowsBridge;
let clipboardService;
let windowManager;
let testHarness;
let dictation;
let meetings;
let shortcuts;
let shortcutController;
let hotkeyTrigger;
let escapeShortcut;
let activeProfile = "standard";

if (process.env.LOCAL_FLOW_USER_DATA) {
  app.setPath("userData", path.resolve(process.env.LOCAL_FLOW_USER_DATA));
}
// Windows atribui as notificações ao AppUserModelID do app. Sem isto, o build de
// dev (electron.exe) aparece como "Electron"; declarando o mesmo appId do
// empacotador, as notificações leem "Local Flow".
app.setAppUserModelId("com.localflow.desktop");
if (
  singleInstanceTestRun ||
  revisionTestRun ||
  e2eTestRun ||
  Boolean(process.env.LOCAL_FLOW_CAPTURE_PATH) ||
  Boolean(process.env.LOCAL_FLOW_INSERTION_TEST_AUDIO) ||
  personalizationTestRun
) {
  app.disableHardwareAcceleration();
}
app.setPath(
  "crashDumps",
  path.join(app.getPath("userData"), "crashes"),
);
crashReporter.start({
  uploadToServer: false,
  productName: "Local Flow",
});

// Native binary, helper script and model locations for dev and packaged builds.
const appPaths = resolveAppPaths({ app, projectRoot });
// Parakeet stays loaded between dictations and unloads itself when idle.
const parakeetServer = new ParakeetServer({
  executable: appPaths.parakeetCli,
  onEvent: (event, metadata) => logger?.info(event, metadata),
});
const transcribeDictation = createTranscriber({
  parakeetCli: appPaths.parakeetCli,
  parakeetServer,
  onParakeetServerFallback: (error) =>
    logger?.warn("parakeet_server_fallback", { reason: error.message }),
  onLanguageFallback: (counts) => logger?.warn("parakeet_language_fallback", counts),
});

const hasSingleInstanceLock = automatedRun
  ? true
  : app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

function applyUiState(payload, options) {
  windowManager.applyUiState(payload, options);
}

function notify(body) {
  try {
    if (Notification.isSupported()) {
      new Notification({ title: "Local Flow", body, silent: true }).show();
    }
  } catch {
    // notificação é só feedback de cortesia — nunca deve quebrar a captura
  }
}

async function captureDictationTarget() {
  const target = await windowsBridge.captureForeground();
  const clipboardSnapshot = clipboardService.snapshotText();
  if (!target) {
    return {
      hwnd: null,
      processId: null,
      processName: "",
      title: "",
      isSelf: false,
      clipboard: clipboardSnapshot,
    };
  }
  return {
    ...target,
    isSelf: Number(target.processId) === process.pid,
    clipboard: clipboardSnapshot,
  };
}

// The renderer owns the microphone, so every shortcut gesture has to reach it.
// Touching a destroyed BrowserWindow throws "TypeError: Object has been
// destroyed", and because nothing here recovered, that one throw wedged the
// shortcut for the rest of the session — the app looked dead until restarted.
// Renderers do die (see the renderer_gone entries in the log), so send through
// a guard that revives the window instead of assuming it is alive.
function sendDictationCommand(action) {
  const window = windowManager?.dashboardWindow;
  if (!window || window.isDestroyed()) {
    // Recreate and let the caller fail this gesture: the fresh renderer is not
    // loaded yet, so it could not honour the command anyway. The next press
    // works.
    windowManager?.createDashboard();
    throw new Error(
      "A janela do Local Flow não estava disponível. Tente novamente.",
    );
  }
  window.webContents.send("dictation:command", { action, source: "shortcut" });
}

function createShortcutController() {
  shortcutController = new ToggleDictationController({
    captureTarget: captureDictationTarget,
    onStateChange: () => dictation.syncEscapeShortcut(),
    onStart: async () => {
      // Go straight to the recording wave on key press — no "opening mic"
      // spinner flash in between. The line just grows into the wave.
      applyUiState({
        state: "recording",
        message: "Ouvindo…",
        profile: activeProfile,
      });
      sendDictationCommand("start");
    },
    onStop: async () => {
      sendDictationCommand("stop");
    },
  });
}

function reportShortcutError(error) {
  shortcutController.fail();
  logger.error("shortcut_toggle_failed", error);
  applyUiState({
    state: "error",
    message: "O atalho não pôde iniciar o ditado.",
    profile: activeProfile,
  });
}

function handleGlobalShortcut(accelerator) {
  if (handleShortcutTestTrigger({ app, accelerator })) {
    return;
  }
  // Mutuamente exclusivo com a GRAVAÇÃO de reunião (os dois usam o microfone).
  // O processamento em 2º plano da reunião não bloqueia o ditado.
  if (meetings.blocksDictation() && shortcutController.state === "idle") {
    notify("Reunião gravando — pare a gravação antes de ditar.");
    return;
  }
  shortcutController.toggle().catch(reportShortcutError);
}

async function onDashboardReady(window) {
  const interrupted = () => {
    dictation.handleRendererInterrupted();
    meetings.handleRendererInterrupted();
  };
  window.webContents.on("render-process-gone", interrupted);
  window.webContents.on("did-start-navigation", interrupted);
  return testHarness.onDashboardReady(window);
}

async function onCapsuleReady(window) {
  return testHarness.onCapsuleReady(window, applyUiState);
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
  // Only the login item passes --hidden. A deliberate launch from Start (or
  // right after installation) must always show the dashboard, even when the
  // user chose to keep automatic Windows startup unobtrusive.
  const shouldStartHidden = process.argv.includes("--hidden");
  if (singleInstanceTestRun) {
    console.log("LOCAL_FLOW_SINGLE_INSTANCE_PRIMARY_READY");
    return;
  }
  const revisionService = new RevisionService({
    endpoint: process.env.LOCAL_FLOW_REVISION_ENDPOINT,
    defaultModel: settings.revisionModel,
    timeoutMs: settings.revisionTimeoutMs,
  });
  const meetingSummaryService = new MeetingSummaryService({
    endpoint: process.env.LOCAL_FLOW_REVISION_ENDPOINT,
    defaultModel: settings.revisionModel,
  });
  const modelInstaller = new ModelInstaller({ modelsDir: appPaths.modelsDir });
  const historyStore = new TranscriptionHistoryStore({
    filePath: path.join(app.getPath("userData"), "transcription-history.json"),
  });
  const meetingStore = new MeetingStore({
    baseDir: path.join(app.getPath("userData"), "meeting-captures"),
  });
  const meetingCaptureStore = new MeetingCaptureStore({ baseDir: meetingStore.baseDir });
  await historyStore.migrateLegacyOnce(
    path.join(app.getPath("userData"), "last-transcription.json"),
  );
  if (
    await runSetupSelfTest({
      app,
      projectRoot,
      appPaths,
      modelInstaller,
      inspectRuntime: inspectAsrRuntime,
    })
  ) return;
  registerSetupIpc({
    ipcMain,
    projectRoot,
    appPaths,
    modelInstaller,
    inspectRuntime: inspectAsrRuntime,
    revisionService,
    logger,
    getActiveProfile: () => activeProfile,
  });
  const transcriptionPipeline = new TranscriptionPipeline({
    projectRoot,
    whisperCli: appPaths.whisperCli,
    modelsDir: appPaths.modelsDir,
    transcribeWav: transcribeDictation,
    revisionService,
  });
  const meetingService = new MeetingService({
    transcribeWav,
    projectRoot,
    whisperCli: appPaths.whisperCli,
    modelsDir: appPaths.modelsDir,
  });
  if (
    await runHeadlessPipelineTest({
      app,
      clipboard,
      env: process.env,
      transcriptionPipeline,
    })
  ) return;

  windowsBridge = new WindowsBridge({
    scriptPath: appPaths.foregroundHelper,
  });
  windowsBridge.start();
  clipboardService = new ClipboardService({ clipboard, windowsBridge });
  const loginItemService = new LoginItemService({ app, projectRoot });
  const canManageLoginItem = !automatedRun && !singleInstanceTestRun;
  if (canManageLoginItem) {
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
    transcriptionPipeline,
    windowManager,
    windowsBridge,
  });

  // IPC must exist before the windows load, or an early renderer call fails.
  dictation = new DictationSession({
    clipboard,
    clipboardService,
    historyStore,
    logger,
    settingsStore,
    transcriptionPipeline,
    windowManager,
  });
  meetings = new MeetingController({
    windowManager,
    settingsStore,
    logger,
    meetingService,
    meetingSummaryService,
    meetingStore,
    meetingCaptureStore,
    notify,
    applyUiState,
    getActiveProfile: () => activeProfile,
    isDictationBusy: () => dictation.isBusy(),
    isDictationRecording: () =>
      ["starting", "recording"].includes(shortcutController?.state),
  });
  const lastTranscriptionPaster = new LastTranscriptionPaster({
    historyStore,
    captureTarget: captureDictationTarget,
    clipboardService,
    settingsStore,
    isBusy: () => dictation.isBusy(),
    // A meeting capture keeps its REC capsule; the paste still happens.
    showState: (uiState) => {
      if (!meetings.ownsCapsule()) applyUiState(uiState);
    },
    getProfile: () => activeProfile,
    logger,
  });
  shortcuts = new ShortcutRegistry({
    app,
    globalShortcut,
    settingsStore,
    windowManager,
    onDictation: handleGlobalShortcut,
    onMeeting: () => meetings.toggle(),
    onRepaste: () => lastTranscriptionPaster.paste(),
    disableEscape: () => escapeShortcut?.setEnabled(false),
    syncEscape: () => dictation.syncEscapeShortcut(),
  });
  dictation.registerIpc(ipcMain);
  meetings.registerIpc(ipcMain);
  registerAppIpc({
    ipcMain,
    app,
    clipboard,
    projectRoot,
    appPaths,
    inspectRuntime: inspectAsrRuntime,
    revisionService,
    settingsStore,
    historyStore,
    loginItemService,
    canManageLoginItem,
    windowManager,
    shortcuts,
    logger,
    getHotkeyTrigger: () => hotkeyTrigger,
    applyUiState,
    getActiveProfile: () => activeProfile,
    setActiveProfile: (profile) => { activeProfile = profile; },
  });
  ipcMain.on("ui:update-state", (_event, payload) => {
    if (payload?.source === "dictation") {
      dictation.onRendererState(payload);
      if (meetings.ownsCapsule()) return;
    }
    applyUiState(payload);
  });

  windowManager.setProfile(activeProfile);
  windowManager.createAll({
    dashboardQuery:
      process.env.LOCAL_FLOW_MIC_SELF_TEST === "1"
        ? { selfTest: "microphone" }
        : process.env.LOCAL_FLOW_PERSONALIZATION_PREVIEW === "1"
          ? { personalizationPreview: "1" }
        : process.env.LOCAL_FLOW_SETTINGS_PREVIEW === "1"
          ? { settingsPreview: "1" }
        : undefined,
  });
  meetings.recoverPending();
  configureMicrophonePermission({
    session,
    getDashboardWebContents: () => windowManager.dashboardWindow?.webContents,
  });
  // Loopback do áudio do sistema para a captura de reunião (Fase A). O renderer
  // chama getDisplayMedia({ video: true, audio: true }); satisfazemos com uma
  // fonte de tela para o vídeo (descartado no renderer) e o áudio de loopback.
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      desktopCapturer
        .getSources({ types: ["screen"] })
        .then((sources) => {
          callback({ video: sources[0], audio: "loopback" });
        })
        .catch(() => callback({}));
    },
    { useSystemPicker: false },
  );
  escapeShortcut = new EscapeShortcut({
    globalShortcut,
    onEscape: () => dictation.cancel("escape"),
    onUnavailable: () => logger.warn("escape_shortcut_unavailable"),
  });
  createShortcutController();
  dictation.attachControls({ shortcutController, escapeShortcut });
  shortcuts.registerDictation();
  if (settings.nativeHotkey && !automatedRun) {
    hotkeyTrigger = createHotkeyTrigger({
      scriptPath: appPaths.hotkeyListener,
      shortcutController,
      windowManager,
      getProfile: () => activeProfile,
      onEscape: () => dictation.cancel("escape"),
      logger,
    });
    dictation.attachControls({ hotkeyTrigger });
    hotkeyTrigger.listener.start();
  }

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
    dictation.cancel(reason);
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
  escapeShortcut?.dispose();
  globalShortcut.unregisterAll();
  hotkeyTrigger?.listener.dispose();
  windowsBridge?.dispose();
  parakeetServer.dispose();
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
