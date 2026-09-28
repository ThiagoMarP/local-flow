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
const { writeFile } = require("node:fs/promises");
const { resolveAppPaths } = require("./services/app-paths.cjs");
const { ClipboardService } = require("./services/clipboard-service.cjs");
const { createTranscriber, inspectAsrRuntime } = require("./services/asr-service.cjs");
const { cleanOldEntries } = require("./services/housekeeping.cjs");
const { LoginItemService } = require("./services/login-item-service.cjs");
const { ModelInstaller } = require("./services/model-installer.cjs");
const { PrivacyLogger } = require("./services/privacy-logger.cjs");
const { resolvePersonalizationOptions } = require("./services/personalization-service.cjs");
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
const { configureMicrophonePermission } = require("./permissions.cjs");
const { runSetupSelfTest, registerSetupIpc } = require("./setup-ipc.cjs");
const { ToggleDictationController } = require("./shortcut-controller.cjs");
const { EscapeShortcut } = require("./escape-shortcut.cjs");
const { waitForCancelledRunCleanup } = require("./cancelled-run-wait.cjs");
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
let loginItemService;
let revisionService, transcriptionPipeline, meetingService;
let meetingSummaryService;
let historyStore;
let meetingStore;
let meetingCaptureStore;
let modelInstaller;
let windowManager;
let testHarness;
let shortcutController;
let hotkeyTrigger;
let shortcutRegistered = false;
let shortcutRegistrationError = "";
let activeShortcut = "CommandOrControl+Shift+Space";
let transcriptionRunning = false;
let activeTranscriptionSettled = null;
let activeTranscriptionAbortController = null;
let activeTranscriptionRunId = null;
let activeTranscriptionShortcutGeneration = null;
let dictationRendererRunId = null;
let dictationRendererState = "idle";
let transcriptionDeliveryStarted = false;
let deliveryCommittedRunId = null;
let deliveryCommitOrphaned = false;
let escapeCancelPending = false;
let escapeShortcut;
const cancelledRunIds = new Map();
const waitingTranscriptionRunIds = new Set();
let activeProfile = "standard";
let meetingCapturing = false;
let meetingStopping = false;
let activeMeetingSessionId = null;
let latestMeetingId = null;
let meetingChunkQueue = Promise.resolve();
let lastMeetingToggleAt = 0;
let activeMeetingShortcut = "CommandOrControl+Alt+R";
// Transcrições de reunião rodam em segundo plano e em série (uma de cada vez),
// para o renderer não ficar travado durante o whisper + Ollama.
let meetingQueue = Promise.resolve();

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
const transcribeDictation = createTranscriber({ parakeetCli: appPaths.parakeetCli });

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

function normalizedRunId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 128
    ? value
    : null;
}

function rememberCancelledRun(runId) {
  if (!runId) return;
  const now = Date.now();
  for (const [id, at] of cancelledRunIds) {
    if (now - at > 120_000) cancelledRunIds.delete(id);
  }
  cancelledRunIds.set(runId, now);
  while (cancelledRunIds.size > 32) {
    cancelledRunIds.delete(cancelledRunIds.keys().next().value);
  }
}

function wasRunCancelled(runId) {
  if (!runId) return false;
  const at = cancelledRunIds.get(runId);
  if (!at) return false;
  if (Date.now() - at > 120_000) {
    cancelledRunIds.delete(runId);
    return false;
  }
  return true;
}

function dictationCanBeCancelled() {
  if (transcriptionDeliveryStarted || escapeCancelPending) return false;
  const oldRunAborted = Boolean(activeTranscriptionAbortController?.signal.aborted);
  const rendererBusy = ["requesting", "recording", "processing", "revising"]
    .includes(dictationRendererState);
  const shortcutBusy = ["starting", "recording", "processing"]
    .includes(shortcutController?.state);
  return (transcriptionRunning && !oldRunAborted) ||
    (rendererBusy && (!oldRunAborted ||
      dictationRendererRunId !== activeTranscriptionRunId)) ||
    (shortcutBusy && (!oldRunAborted ||
      shortcutController.generation !== activeTranscriptionShortcutGeneration));
}

function syncEscapeShortcut() {
  escapeShortcut?.setEnabled(dictationCanBeCancelled());
}

function abortError() {
  const error = new Error("Ditado cancelado.");
  error.name = "AbortError";
  return error;
}

function cancelActiveDictation(source = "escape", requestedRunId = null) {
  const runId = normalizedRunId(requestedRunId);
  if (transcriptionDeliveryStarted) {
    syncEscapeShortcut();
    return { accepted: false, reason: "already-delivering" };
  }
  const newGestureBeforeRendererState =
    activeTranscriptionAbortController?.signal.aborted &&
    ["starting", "recording", "processing"].includes(shortcutController?.state) &&
    shortcutController.generation !== activeTranscriptionShortcutGeneration;
  const currentRunId = dictationRendererRunId ||
    (newGestureBeforeRendererState ? null : activeTranscriptionRunId);
  if (runId && wasRunCancelled(runId)) {
    return { accepted: true, reason: "already-cancelled" };
  }
  if (runId && runId !== currentRunId) {
    return { accepted: false, reason: "stale-run" };
  }
  if (!dictationCanBeCancelled() && !runId) {
    return { accepted: false, reason: "idle" };
  }

  rememberCancelledRun(runId || currentRunId);
  escapeCancelPending = true;
  activeTranscriptionAbortController?.abort();
  shortcutController?.fail();
  hotkeyTrigger?.controller.reset();
  const window = windowManager?.dashboardWindow;
  if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
    window.webContents.send("dictation:command", {
      action: "cancel",
      source,
      runId: runId || currentRunId,
    });
  }
  dictationRendererState = "idle";
  dictationRendererRunId = null;
  syncEscapeShortcut();
  return { accepted: true };
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
    onStateChange: () => syncEscapeShortcut(),
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

function handleGlobalShortcut() {
  if (handleShortcutTestTrigger({ app, accelerator: activeShortcut })) {
    return;
  }
  // Mutuamente exclusivo com a GRAVAÇÃO de reunião (os dois usam o microfone).
  // O processamento em 2º plano da reunião não bloqueia o ditado.
  if ((meetingCapturing || meetingStopping || activeMeetingSessionId) &&
    shortcutController.state === "idle") {
    notifyMeeting("Reunião gravando — pare a gravação antes de ditar.");
    return;
  }
  shortcutController.toggle().catch(reportShortcutError);
}

// --- Captura de reunião (Fase A, provisório) ---------------------------------
// Atalho dedicado de start/stop que apenas avisa o renderer; a captura dupla
// (microfone + áudio do sistema) vive no renderer. A Fase D substitui isto por
// um atalho configurável + estados de cápsula próprios.
function notifyMeeting(body) {
  try {
    if (Notification.isSupported()) {
      new Notification({ title: "Local Flow", body, silent: true }).show();
    }
  } catch {
    // notificação é só feedback de cortesia — nunca deve quebrar a captura
  }
}

function handleMeetingShortcut(desiredAction) {
  // globalShortcut dispara repetidamente enquanto a tecla fica pressionada;
  // ignoramos repetições muito próximas para não criar um enxame de start/stop.
  if (!windowManager?.dashboardWindow ||
    windowManager.dashboardWindow.isDestroyed() ||
    windowManager.dashboardWindow.webContents.isDestroyed()) {
    return { ok: false, reason: "A janela do Local Flow ainda não está pronta." };
  }
  const now = Date.now();
  if (now - lastMeetingToggleAt < 600) return { ok: false, reason: "Aguarde um instante." };
  if (meetingStopping) return { ok: false, reason: "Aguarde a reunião terminar de salvar." };
  if (!meetingCapturing && activeMeetingSessionId) {
    return { ok: false, reason: "A reunião anterior ainda está sendo salva." };
  }
  if (desiredAction === "start" && meetingCapturing) {
    return { ok: false, reason: "A reunião já está gravando." };
  }
  if (desiredAction === "stop" && !meetingCapturing) {
    return { ok: false, reason: "Não há reunião em gravação." };
  }
  // Mutuamente exclusivo com a GRAVAÇÃO do ditado (os dois usam o microfone). O
  // ditado em processamento (transcrevendo) não bloqueia iniciar uma reunião.
  if (
    !meetingCapturing &&
    ["starting", "recording"].includes(shortcutController?.state)
  ) {
    lastMeetingToggleAt = now;
    notifyMeeting("Ditado em andamento — finalize antes de gravar a reunião.");
    return { ok: false, reason: "Finalize o ditado antes de gravar a reunião." };
  }
  lastMeetingToggleAt = now;
  meetingCapturing = !meetingCapturing;
  const action = meetingCapturing ? "start" : "stop";
  if (action === "stop") meetingStopping = true;
  console.log(`LOCAL_FLOW_MEETING_TOGGLE=${JSON.stringify({ action })}`);
  windowManager?.dashboardWindow?.webContents.send("meeting:command", {
    action,
  });
  return { ok: true, action };
}

function registerMeetingShortcut(shortcut = settingsStore.get().meetingShortcut) {
  activeMeetingShortcut = shortcut;
  globalShortcut.register(shortcut, handleMeetingShortcut);
}

function registerDictationShortcut(shortcut = settingsStore.get().shortcut) {
  escapeShortcut?.setEnabled(false);
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
  // registerDictationShortcut limpa todos os atalhos globais primeiro, então o
  // atalho de reunião precisa ser re-registrado aqui para sobreviver.
  registerMeetingShortcut();
  syncEscapeShortcut();
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
  const interrupted = () => {
    // A dead/reloading renderer cannot acknowledge a cancellation or send a
    // terminal UI state. Release Escape immediately so other apps retain it.
    if (!transcriptionDeliveryStarted) {
      rememberCancelledRun(activeTranscriptionRunId);
      rememberCancelledRun(dictationRendererRunId);
      for (const waitingRunId of waitingTranscriptionRunIds) {
        rememberCancelledRun(waitingRunId);
      }
      activeTranscriptionAbortController?.abort();
    } else if (!transcriptionRunning) {
      // Delivery finished, but the renderer disappeared before acknowledging
      // success. No future terminal event can clear this commit marker.
      transcriptionDeliveryStarted = false;
      deliveryCommittedRunId = null;
      deliveryCommitOrphaned = false;
    } else {
      deliveryCommitOrphaned = true;
    }
    shortcutController?.fail();
    hotkeyTrigger?.controller.reset();
    dictationRendererState = "idle";
    dictationRendererRunId = null;
    escapeCancelPending = false;
    syncEscapeShortcut();
    // A renderer can disappear while the permission prompt is still open,
    // before it has created a capture session. Release the shortcut toggle in
    // that case too, or the next press would try to stop a nonexistent meeting.
    const wasCapturing = meetingCapturing;
    meetingCapturing = false;
    meetingStopping = false;
    if (!activeMeetingSessionId) {
      if (wasCapturing) {
        logger?.warn("meeting_renderer_interrupted_before_capture");
      }
      return;
    }
    finalizeActiveMeeting({ interrupted: true }).catch((error) =>
      logger?.warn("meeting_renderer_interrupted", { reason: error?.message || "Error" }),
    );
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
  revisionService = new RevisionService({
    endpoint: process.env.LOCAL_FLOW_REVISION_ENDPOINT,
    defaultModel: settings.revisionModel,
    timeoutMs: settings.revisionTimeoutMs,
  });
  meetingSummaryService = new MeetingSummaryService({
    endpoint: process.env.LOCAL_FLOW_REVISION_ENDPOINT,
    defaultModel: settings.revisionModel,
  });
  modelInstaller = new ModelInstaller({ modelsDir: appPaths.modelsDir });
  historyStore = new TranscriptionHistoryStore({
    filePath: path.join(app.getPath("userData"), "transcription-history.json"),
  });
  meetingStore = new MeetingStore({
    baseDir: path.join(app.getPath("userData"), "meeting-captures"),
  });
  meetingCaptureStore = new MeetingCaptureStore({ baseDir: meetingStore.baseDir });
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
  transcriptionPipeline = new TranscriptionPipeline({
    projectRoot,
    whisperCli: appPaths.whisperCli,
    modelsDir: appPaths.modelsDir,
    transcribeWav: transcribeDictation,
    revisionService,
  });
  meetingService = new MeetingService({
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
    transcriptionPipeline,
    windowManager,
    windowsBridge,
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
  meetingCaptureStore.recoverPending().then((pending) => {
    for (const capture of pending.sort((a, b) => a.at - b.at)) {
      enqueueMeeting(capture);
    }
  }).catch((error) => logger.warn("meeting_recovery_failed", {
    reason: error?.message || "Error",
  }));
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
    onEscape: () => cancelActiveDictation("escape"),
    onUnavailable: () => logger.warn("escape_shortcut_unavailable"),
  });
  createShortcutController();
  registerDictationShortcut();
  if (settings.nativeHotkey && !automatedRun) {
    hotkeyTrigger = createHotkeyTrigger({
      scriptPath: appPaths.hotkeyListener,
      shortcutController,
      windowManager,
      getProfile: () => activeProfile,
      onEscape: () => cancelActiveDictation("escape"),
      logger,
    });
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
    cancelActiveDictation(reason);
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

ipcMain.handle("runtime:inspect", async () => {
  const [whisper, revision] = await Promise.all([
    inspectAsrRuntime(projectRoot, {
      whisperCli: appPaths.whisperCli,
      parakeetCli: appPaths.parakeetCli,
      modelsDir: appPaths.modelsDir,
    }),
    revisionService.inspect(),
  ]);
  return {
    ...whisper,
    revision,
    shortcut: {
      accelerator: activeShortcut,
      display: formatShortcut(activeShortcut),
      mode: "toggle",
      registered: shortcutRegistered,
      error: shortcutRegistrationError,
    },
    hotkey: {
      enabled: settingsStore.get().nativeHotkey,
      ready: Boolean(hotkeyTrigger?.listener.ready),
      display: "Ctrl + Win",
    },
    settings: settingsStore.getPublic(),
    loginItem:
      automatedRun || singleInstanceTestRun
        ? null
        : loginItemService.get(),
  };
});

ipcMain.handle("transcription:run", async (_event, payload) => {
  const runId = normalizedRunId(payload?.runId);
  if (transcriptionRunning && activeTranscriptionAbortController?.signal.aborted &&
    activeTranscriptionSettled) {
    if (runId) waitingTranscriptionRunIds.add(runId);
    try {
      await waitForCancelledRunCleanup(activeTranscriptionSettled);
    } finally {
      if (runId) waitingTranscriptionRunIds.delete(runId);
    }
  }
  // Escape could cancel this new run while it waits for the old subprocess.
  if (wasRunCancelled(runId)) throw abortError();
  if (transcriptionRunning) {
    throw new Error("Já existe uma transcrição em andamento.");
  }
  transcriptionRunning = true;
  let settleThisRun;
  const thisRunSettled = new Promise((resolve) => { settleThisRun = resolve; });
  activeTranscriptionSettled = thisRunSettled;
  transcriptionDeliveryStarted = false;
  deliveryCommittedRunId = null;
  deliveryCommitOrphaned = false;
  activeTranscriptionRunId = runId;
  const runAbortController = new AbortController();
  activeTranscriptionAbortController = runAbortController;
  syncEscapeShortcut();
  const shortcutTarget =
    shortcutController?.state === "processing"
      ? shortcutController.target
      : null;
  const shortcutGeneration = shortcutTarget
    ? shortcutController.generation
    : null;
  activeTranscriptionShortcutGeneration = shortcutGeneration;
  const ownsShortcutRun = () => shortcutGeneration !== null &&
    shortcutController?.ownsProcessing(shortcutGeneration, shortcutTarget);
  try {
    const settings = settingsStore.get();
    const profile = payload?.profile || settings.profile;
    const vocabulary = Array.isArray(payload?.vocabulary)
      ? payload.vocabulary
      : settings.vocabulary;
    const result = await transcriptionPipeline.run({
      wavBuffer: Buffer.from(payload.audio),
      profile,
      vocabulary,
      threads: os.cpus().length,
      revisionMode: payload?.revisionMode || settings.revisionMode,
      revisionModel: payload?.revisionModel || settings.revisionModel,
      revisionTimeoutMs: settings.revisionTimeoutMs,
      ...resolvePersonalizationOptions(payload, settings),
      signal: runAbortController.signal,
      onProgress: (progress) => {
        if (!runAbortController.signal.aborted) {
          _event.sender.send("transcription:progress", { ...progress, runId });
        }
      },
    });
    if (runAbortController.signal.aborted || wasRunCancelled(runId)) {
      throw abortError();
    }
    // The native paste helper cannot undo a Ctrl+V after delivery begins.
    // Escape stops capturing here, before any clipboard mutation starts.
    transcriptionDeliveryStarted = true;
    deliveryCommittedRunId = runId;
    syncEscapeShortcut();
    _event.sender.send("transcription:progress", { stage: "delivering", runId });
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
    if (ownsShortcutRun()) shortcutController.complete();
    const historyEntry = await historyStore
      ?.add({
        text: result.text,
        originalText: result.originalText !== result.text
          ? result.originalText
          : undefined,
        at: Date.now(),
      })
      .catch((error) =>
        logger.warn("transcription_history_save_failed", {
          reason: error?.name || "Error",
        }),
      );
    await logger.info("dictation_completed", {
      profile,
      elapsedMs: result.elapsedMs,
      durationSeconds: result.durationSeconds,
      autoPasted: insertion.autoPasted,
      clipboardRestored: insertion.clipboardRestored,
      fallbackReason: insertion.reason,
      revisionMode: result.revision.mode,
      revisionApplied: result.revision.applied,
      revisionFallback: result.revision.fallback,
      revisionReason: result.revision.reason,
      revisionElapsedMs: result.revision.elapsedMs,
      revisionPath: result.revision.path,
      writingProfile: result.personalization.writingProfile,
      replacementsApplied:
        result.personalization.replacementsApplied,
      snippetsExpanded: result.personalization.snippetsExpanded,
    });
    return {
      ...result,
      historyId: historyEntry?.id || null,
      copiedToClipboard: true,
      ...insertion,
    };
  } catch (error) {
    if (ownsShortcutRun()) shortcutController.fail();
    if (error?.name !== "AbortError") {
      await logger.error("dictation_failed", error);
    }
    throw error;
  } finally {
    if (activeTranscriptionAbortController === runAbortController) {
      activeTranscriptionAbortController = null;
      activeTranscriptionRunId = null;
      activeTranscriptionShortcutGeneration = null;
    }
    transcriptionRunning = false;
    if (activeTranscriptionSettled === thisRunSettled) {
      activeTranscriptionSettled = null;
    }
    settleThisRun();
    if (deliveryCommitOrphaned && deliveryCommittedRunId === runId) {
      transcriptionDeliveryStarted = false;
      deliveryCommittedRunId = null;
      deliveryCommitOrphaned = false;
    }
    syncEscapeShortcut();
  }
});

ipcMain.handle("transcription:cancel", (_event, runId) =>
  cancelActiveDictation("escape", runId),
);

function publishMeetingStatus(state, message, id, { current = true } = {}) {
  windowManager?.dashboardWindow?.webContents.send("meeting:status", {
    state,
    message,
    id,
    current,
  });
}

// Background phase of a meeting capture: transcribe both channels, interleave,
// summarize, persist transcript.txt/resumo.md, refresh meta.json and fire the
// completion pulse. Runs off the IPC response so the renderer can record again
// immediately.
async function processMeeting({ id, dir, at, chunkCount, micSeconds, systemSeconds, interrupted }) {
  let transcript = null;
  let turns = 0;
  let partial = false;
  let failures = [];
  try {
    const meeting = await meetingService.runFromChunkFiles({
      dir,
      chunkCount,
      profile: settingsStore.get().meetingProfile,
      threads: os.cpus().length,
      vocabulary: settingsStore.get().vocabulary,
    });
    transcript = meeting.transcript;
    turns = meeting.turns.length;
    partial = Boolean(meeting.partial);
    failures = meeting.failures || [];
    await writeFile(path.join(dir, "transcript.txt"), transcript, "utf8");
    console.log(
      `LOCAL_FLOW_MEETING_TRANSCRIBED=${JSON.stringify({
        dir,
        turns,
        chars: transcript.length,
        elapsedMs: meeting.elapsedMs,
      })}`,
    );
  } catch (error) {
    console.log(
      `LOCAL_FLOW_MEETING_TRANSCRIBE_FAILED=${JSON.stringify({
        reason: error?.message || "Error",
      })}`,
    );
    await logger.warn("meeting_transcribe_failed", {
      reason: error?.message || "Error",
    });
  }

  let summarized = false;
  if (transcript) {
    try {
      const summary = await meetingSummaryService.summarize(transcript, {
        model: settingsStore.get().meetingSummaryModel,
      });
      if (summary.applied) {
        summarized = true;
        await writeFile(path.join(dir, "resumo.md"), summary.markdown, "utf8");
        console.log(
          `LOCAL_FLOW_MEETING_SUMMARIZED=${JSON.stringify({
            dir,
            chars: summary.markdown.length,
            elapsedMs: summary.elapsedMs,
          })}`,
        );
      } else {
        console.log(
          `LOCAL_FLOW_MEETING_SUMMARY_SKIPPED=${JSON.stringify({
            reason: summary.reason,
          })}`,
        );
      }
    } catch (error) {
      await logger.warn("meeting_summary_failed", {
        reason: error?.message || "Error",
      });
    }
  }

  await meetingCaptureStore.finish(id, {
    state: transcript ? (partial ? "partial" : "done") : "failed",
    error: partial
      ? `${failures.length} trecho(s) não puderam ser transcritos.`
      : transcript ? null : "Não foi possível transcrever o áudio.",
    failures,
    turns,
    summarized,
  });
  await logger.info("meeting_capture_saved", {
    dir,
    micSeconds,
    systemSeconds,
    turns,
    summarized,
  });
  const message = transcript
    ? `${partial ? "Reunião transcrita parcialmente" : interrupted ? "Reunião interrompida recuperada" : "Reunião transcrita"} · ${turns} fala(s)${summarized ? " e resumo" : " (resumo indisponível)"}`
    : `Reunião salva, mas a transcrição falhou. Áudio preservado no disco.`;
  notifyMeeting(message);
  const current = latestMeetingId === id;
  publishMeetingStatus(transcript ? (partial ? "partial" : "success") : "error", message, id, { current });
  // A reunião termina em segundo plano e pode coincidir com um ditado novo.
  // "processing" também é usado pelo ditado; seu resultado visual tem prioridade.
  const dictationBusy = transcriptionRunning ||
    ["requesting", "recording", "processing", "revising"].includes(dictationRendererState) ||
    ["starting", "recording", "processing"].includes(shortcutController?.state);
  if (current && !dictationBusy && windowManager?.currentUiState?.state === "processing") {
    applyUiState({
      state: transcript && !partial ? "success" : "error",
      profile: activeProfile,
      message: transcript
        ? partial ? "Transcrição parcial da reunião" : "Reunião transcrita"
        : "Falha na transcrição da reunião",
    });
  }
}

function enqueueMeeting(capture) {
  const { id, dir, at, chunkCount, micSeconds, systemSeconds, interrupted } = capture;
  if (!chunkCount) return;
  latestMeetingId = id;
  publishMeetingStatus("processing", interrupted
    ? "Recuperando gravação interrompida…"
    : "Transcrevendo reunião em segundo plano…", id);
  meetingQueue = meetingQueue
    .then(() => processMeeting({ id, dir, at, chunkCount, micSeconds, systemSeconds, interrupted }))
    .catch(async (error) => {
      await meetingCaptureStore.finish(id, { state: "failed", error: "Não foi possível processar a reunião." }).catch(() => {});
      await logger.warn("meeting_process_failed", { reason: error?.message || "Error" });
      publishMeetingStatus("error", "Não foi possível processar a reunião; o áudio continua salvo no disco.", id,
        { current: latestMeetingId === id });
    });
}

async function finalizeActiveMeeting({ interrupted = false } = {}) {
  const id = activeMeetingSessionId;
  if (!id) return null;
  activeMeetingSessionId = null;
  meetingCapturing = false;
  await meetingChunkQueue;
  const capture = await meetingCaptureStore.complete(id, { interrupted });
  if (capture.chunkCount) enqueueMeeting(capture);
  else publishMeetingStatus("error", "A reunião terminou antes de salvar áudio.", id);
  return { id, dir: capture.dir, chunkCount: capture.chunkCount,
    durationSeconds: capture.durationSeconds, interrupted: capture.interrupted };
}

ipcMain.handle("meeting:toggle", (_event, desiredAction) => handleMeetingShortcut(desiredAction));
ipcMain.handle("meeting:capture-state", () => ({ capturing: meetingCapturing }));
ipcMain.handle("meeting:capture-start", async (_event, payload) => {
  if (activeMeetingSessionId) throw new Error("Já existe uma reunião em gravação.");
  const capture = await meetingCaptureStore.start({ mode: payload?.mode });
  activeMeetingSessionId = capture.id;
  meetingChunkQueue = Promise.resolve();
  return { id: capture.id };
});
ipcMain.handle("meeting:capture-chunk", (_event, payload) => {
  if (!payload?.id || payload.id !== activeMeetingSessionId) {
    throw new Error("Sessão de reunião não está ativa.");
  }
  const write = meetingChunkQueue.then(() => meetingCaptureStore.append(payload));
  meetingChunkQueue = write.catch(() => {});
  return write;
});
ipcMain.handle("meeting:capture-complete", async (_event, payload) => {
  if (!payload?.id || payload.id !== activeMeetingSessionId) {
    throw new Error("Sessão de reunião não está ativa.");
  }
  const saved = await finalizeActiveMeeting({ interrupted: payload.interrupted });
  meetingCapturing = false;
  meetingStopping = false;
  console.log(
    `LOCAL_FLOW_MEETING_SAVED=${JSON.stringify({
      dir: saved.dir,
      chunks: saved.chunkCount,
      seconds: saved.durationSeconds,
    })}`,
  );
  return saved;
});

ipcMain.handle("meetings:list", () =>
  meetingStore ? meetingStore.list() : [],
);
ipcMain.handle("meetings:get", (_event, id) => meetingStore.get(id));
ipcMain.handle("meetings:remove", (_event, id) =>
  meetingStore.remove(id),
);

ipcMain.handle("clipboard:write", (_event, text) => {
  clipboard.writeText(String(text));
  return true;
});

ipcMain.handle("history:getLast", () =>
  historyStore ? historyStore.last() : null,
);
ipcMain.handle("history:list", () =>
  historyStore ? historyStore.list() : [],
);
ipcMain.handle("history:saveCorrection", (_event, id, text) =>
  historyStore
    ? historyStore.saveCorrection(String(id), text)
    : Promise.reject(new Error("Histórico indisponível.")),
);
ipcMain.handle("history:remove", (_event, id) =>
  historyStore ? historyStore.remove(String(id)) : [],
);
ipcMain.handle("history:clear", () =>
  historyStore ? historyStore.clear() : false,
);

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
    if (next.meetingShortcut !== previous.meetingShortcut) {
      globalShortcut.unregister(activeMeetingShortcut);
      registerMeetingShortcut(next.meetingShortcut);
    }
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
  // Meetings also publish UI state. Only dictation states may arm Escape or
  // update the dictation shortcut's recovery state.
  if (payload?.source === "dictation") {
    dictationRendererState = payload?.state || "idle";
    const runId = normalizedRunId(payload?.runId);
    if (runId) dictationRendererRunId = runId;
    if (["idle", "success", "error"].includes(dictationRendererState)) {
      if (transcriptionDeliveryStarted &&
        (!deliveryCommittedRunId || runId === deliveryCommittedRunId)) {
        transcriptionDeliveryStarted = false;
        deliveryCommittedRunId = null;
      }
      dictationRendererRunId = null;
      escapeCancelPending = false;
    }
    // The dashboard renderer owns the real microphone state; feed it to the
    // controller so a desynced/stuck shortcut can heal itself on the next press.
    shortcutController?.notifyRendererState(dictationRendererState);
    syncEscapeShortcut();
  }
  if (payload?.source === "dictation" && (meetingCapturing || meetingStopping)) {
    return;
  }
  applyUiState(payload);
});
ipcMain.on("dictation:event", (_event, payload) => {
  const runId = normalizedRunId(payload?.runId);
  if (runId && dictationRendererRunId && runId !== dictationRendererRunId) {
    return;
  }
  if (["error", "cancelled", "completed"].includes(payload?.type)) {
    dictationRendererState = payload.type === "completed" ? "success" : "idle";
    dictationRendererRunId = null;
    escapeCancelPending = false;
    if (transcriptionDeliveryStarted &&
      (!deliveryCommittedRunId || runId === deliveryCommittedRunId)) {
      transcriptionDeliveryStarted = false;
      deliveryCommittedRunId = null;
    }
  }
  if (["error", "cancelled"].includes(payload?.type)) {
    shortcutController?.fail();
  }
  syncEscapeShortcut();
});
ipcMain.on("meeting:event", (_event, payload) => {
  console.log(`LOCAL_FLOW_MEETING_EVENT=${JSON.stringify(payload || {})}`);
  if (payload?.type === "started") {
    const stopKey = settingsStore.getPublic().meetingShortcutDisplay;
    let body;
    if (payload?.mode === "mic") {
      body = `Gravando só o seu microfone… ${stopKey} para parar.`;
    } else if (payload?.mode === "system") {
      body = `Gravando só o áudio do sistema… ${stopKey} para parar.`;
    } else if (payload?.hasSystemAudio) {
      body = `Gravando reunião… ${stopKey} para parar.`;
    } else {
      body = `Gravando, mas sem áudio do sistema (nada tocando?).`;
    }
    notifyMeeting(body);
  } else if (payload?.type === "error") {
    // Mantém o toggle do main em sincronia: se a captura falhou ao iniciar, o
    // próximo atalho volta a ser "start".
    meetingCapturing = false;
    meetingStopping = false;
    const message = String(payload?.message || "Não foi possível gravar a reunião.").slice(0, 160);
    notifyMeeting(message);
    publishMeetingStatus("error", message, activeMeetingSessionId);
  }
});
ipcMain.handle(
  "ui:get-state",
  () => windowManager.currentUiState,
);
ipcMain.handle("capsule:action", (_event, action) => {
  windowManager.dismissCapsule();
  logger.info("capsule_dismissed", {
    action: action === "discard" ? "discard" : "confirm",
  });
  return true;
});
ipcMain.handle("app:show-dashboard", () => {
  windowManager.showDashboard();
  return true;
});
ipcMain.handle("app:hide-dashboard", () => {
  windowManager.hideDashboard();
  return true;
});
