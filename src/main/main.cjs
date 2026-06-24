const {
  app,
  BrowserWindow,
  clipboard,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  session,
  Tray,
} = require("electron");
const { mkdir, readFile, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { ToggleDictationController } = require("./shortcut-controller.cjs");
const { calculateCapsuleBounds } = require("./window-layout.cjs");
const { normalizeUiState } = require("./ui-state.cjs");
const { WindowsBridge } = require("./windows-bridge.cjs");
const {
  inspectRuntime,
  transcribeWav,
} = require("./whisper-service.cjs");

const projectRoot = path.resolve(__dirname, "..", "..");
const DICTATION_SHORTCUT = "CommandOrControl+Shift+Space";
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
  Boolean(process.env.LOCAL_FLOW_INSERTION_TEST_AUDIO);
const persistentWindowRun =
  !automatedRun || process.env.LOCAL_FLOW_LIFECYCLE_TEST === "1";

let dashboardWindow;
let capsuleWindow;
let tray;
let transcriptionRunning = false;
let isQuitting = false;
let capsuleHideTimer;
let activeProfile = "standard";
let currentUiState = normalizeUiState({
  state: "idle",
  message: "Pronto",
  profile: activeProfile,
});
let windowsBridge;
let shortcutController;
let shortcutRegistered = false;
let shortcutRegistrationError = "";

if (process.env.LOCAL_FLOW_USER_DATA) {
  app.setPath("userData", path.resolve(process.env.LOCAL_FLOW_USER_DATA));
}

function secureWindow(window) {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file://")) {
      event.preventDefault();
    }
  });
}

function createDashboardWindow() {
  dashboardWindow = new BrowserWindow({
    width: 820,
    height: 720,
    minWidth: 680,
    minHeight: 600,
    backgroundColor: "#0b0d12",
    title: "Local Flow",
    show:
      !automatedRun ||
      Boolean(process.env.LOCAL_FLOW_CAPTURE_PATH) ||
      process.env.LOCAL_FLOW_LIFECYCLE_TEST === "1",
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  dashboardWindow.removeMenu();
  secureWindow(dashboardWindow);
  const query =
    process.env.LOCAL_FLOW_MIC_SELF_TEST === "1"
      ? { selfTest: "microphone" }
      : undefined;
  dashboardWindow.loadFile(
    path.join(__dirname, "..", "renderer", "index.html"),
    query ? { query } : undefined,
  );

  dashboardWindow.on("close", (event) => {
    if (!isQuitting && persistentWindowRun) {
      event.preventDefault();
      dashboardWindow.hide();
    }
  });

  dashboardWindow.webContents.once("did-finish-load", async () => {
    console.log("LOCAL_FLOW_READY");
    if (process.env.LOCAL_FLOW_SMOKE_TEST === "1") {
      setTimeout(() => app.quit(), 500);
      return;
    }
    if (process.env.LOCAL_FLOW_CAPTURE_PATH) {
      await captureWindow(
        dashboardWindow,
        process.env.LOCAL_FLOW_CAPTURE_PATH,
        "LOCAL_FLOW_CAPTURED",
      );
      return;
    }
    if (process.env.LOCAL_FLOW_E2E_AUDIO) {
      await runEndToEndTest(process.env.LOCAL_FLOW_E2E_AUDIO);
      return;
    }
    if (process.env.LOCAL_FLOW_INSERTION_TEST_AUDIO) {
      await runInsertionTest();
      return;
    }
    if (process.env.LOCAL_FLOW_LIFECYCLE_TEST === "1") {
      setTimeout(runLifecycleTest, 800);
    }
  });
}

function createCapsuleWindow() {
  capsuleWindow = new BrowserWindow({
    width: 420,
    height: 82,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    show: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  secureWindow(capsuleWindow);
  capsuleWindow.setAlwaysOnTop(true, "floating");
  capsuleWindow.setIgnoreMouseEvents(true);
  capsuleWindow.loadFile(
    path.join(__dirname, "..", "renderer", "capsule.html"),
  );
  positionCapsule();

  capsuleWindow.webContents.once("did-finish-load", async () => {
    console.log("LOCAL_FLOW_CAPSULE_READY");
    capsuleWindow.webContents.send("ui:state", currentUiState);
    if (process.env.LOCAL_FLOW_CAPTURE_CAPSULE_PATH) {
      const demoState = normalizeUiState({
        state: process.env.LOCAL_FLOW_CAPSULE_STATE || "recording",
        message:
          {
            recording: "Ouvindo…",
            processing: "Transcrevendo…",
            success: "Texto copiado",
            error: "Não foi possível transcrever",
          }[process.env.LOCAL_FLOW_CAPSULE_STATE || "recording"] ||
          "Local Flow",
        profile: "standard",
        elapsedMs:
          (process.env.LOCAL_FLOW_CAPSULE_STATE || "recording") ===
          "recording"
            ? 8400
            : 0,
        level: 0.72,
      });
      applyUiState(demoState, { autoHide: false });
      await captureWindow(
        capsuleWindow,
        process.env.LOCAL_FLOW_CAPTURE_CAPSULE_PATH,
        "LOCAL_FLOW_CAPSULE_CAPTURED",
      );
    }
  });
}

function positionCapsule() {
  if (!capsuleWindow || capsuleWindow.isDestroyed()) return;
  let display = screen.getPrimaryDisplay();
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    display = screen.getDisplayMatching(dashboardWindow.getBounds());
  }
  capsuleWindow.setBounds(
    calculateCapsuleBounds(display.workArea, {
      width: 420,
      height: 82,
      margin: 24,
    }),
  );
}

function createTrayIcon() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
      <defs>
        <linearGradient id="g" x1="0" x2="1">
          <stop stop-color="#6a8bff"/>
          <stop offset="1" stop-color="#a56eff"/>
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="10" fill="#111620"/>
      <path d="M8 17h3l2-7 4 13 3-9 2 3h2" fill="none"
        stroke="url(#g)" stroke-width="2.6" stroke-linecap="round"
        stroke-linejoin="round"/>
    </svg>`;
  return nativeImage
    .createFromDataURL(
      `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
    )
    .resize({ width: 16, height: 16 });
}

function rebuildTrayMenu() {
  if (!tray) return;
  const profileLabels = {
    fast: "Rápido · Small",
    standard: "Padrão · Medium",
    accurate: "Precisão · Large V3 Turbo",
  };
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Abrir Local Flow",
        click: showDashboard,
      },
      {
        label: dashboardWindow?.isVisible()
          ? "Ocultar painel"
          : "Mostrar painel",
        click: () => {
          if (dashboardWindow?.isVisible()) dashboardWindow.hide();
          else showDashboard();
          rebuildTrayMenu();
        },
      },
      { type: "separator" },
      {
        label: `Perfil: ${profileLabels[activeProfile]}`,
        enabled: false,
      },
      {
        label: shortcutRegistered
          ? "Atalho: Ctrl+Shift+Espaço"
          : "Atalho global indisponível",
        enabled: false,
      },
      { type: "separator" },
      {
        label: "Sair",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
}

function snapshotTextClipboard() {
  const formats = clipboard.availableFormats();
  const text = clipboard.readText();
  return {
    text,
    canRestore:
      text.length > 0 || formats.some((format) => /text/i.test(format)),
  };
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
      dashboardWindow.webContents.send("dictation:command", {
        action: "start",
        source: "shortcut",
      });
    },
    onStop: async () => {
      dashboardWindow.webContents.send("dictation:command", {
        action: "stop",
        source: "shortcut",
      });
    },
  });
}

function registerDictationShortcut() {
  shortcutRegistered = globalShortcut.register(
    DICTATION_SHORTCUT,
    () => {
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
                accelerator: DICTATION_SHORTCUT,
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
        applyUiState({
          state: "error",
          message: `Atalho falhou: ${error.message}`,
          profile: activeProfile,
        });
      });
    },
  );
  if (!shortcutRegistered) {
    shortcutRegistrationError =
      "Ctrl+Shift+Espaço já está sendo usado por outro aplicativo.";
  }
  console.log(
    `LOCAL_FLOW_SHORTCUT_READY=${JSON.stringify({
      accelerator: DICTATION_SHORTCUT,
      registered: shortcutRegistered,
    })}`,
  );
  rebuildTrayMenu();

  if (
    shortcutRegistered &&
    process.env.LOCAL_FLOW_SHORTCUT_TEST === "1"
  ) {
    setTimeout(() => app.quit(), 300);
  }
}

async function pasteShortcutResult(text, target) {
  clipboard.writeText(text);
  if (!target?.hwnd || target.isSelf) {
    return {
      autoPasted: false,
      clipboardRestored: false,
      reason: target?.isSelf ? "local-flow-active" : "target-unavailable",
    };
  }

  let pasteResult;
  try {
    pasteResult = await windowsBridge.pasteTo(target.hwnd);
  } catch (error) {
    return {
      autoPasted: false,
      clipboardRestored: false,
      reason: "windows-helper-failed",
      diagnostics: { error: error.message },
    };
  }
  if (!pasteResult?.pasted) {
    return {
      autoPasted: false,
      clipboardRestored: false,
      reason: "focus-or-paste-failed",
      diagnostics: pasteResult || null,
    };
  }

  let clipboardRestored = false;
  if (target.clipboard?.canRestore) {
    await new Promise((resolve) => setTimeout(resolve, 450));
    clipboard.writeText(target.clipboard.text);
    clipboardRestored = true;
  }
  return {
    autoPasted: true,
    clipboardRestored,
    reason: null,
  };
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip("Local Flow — ditado local");
  tray.on("double-click", showDashboard);
  rebuildTrayMenu();
  console.log("LOCAL_FLOW_TRAY_READY");
  if (process.env.LOCAL_FLOW_TRAY_TEST === "1") {
    setTimeout(() => app.quit(), 500);
  }
}

function showDashboard() {
  if (!dashboardWindow || dashboardWindow.isDestroyed()) {
    createDashboardWindow();
    return;
  }
  dashboardWindow.show();
  dashboardWindow.focus();
  rebuildTrayMenu();
}

function applyUiState(payload, options = {}) {
  currentUiState = normalizeUiState(payload);
  if (currentUiState.profile) {
    activeProfile = currentUiState.profile;
    rebuildTrayMenu();
  }
  if (!capsuleWindow || capsuleWindow.isDestroyed()) return;

  clearTimeout(capsuleHideTimer);
  capsuleWindow.webContents.send("ui:state", currentUiState);
  if (currentUiState.state === "idle") {
    capsuleWindow.hide();
    return;
  }
  positionCapsule();
  capsuleWindow.showInactive();

  if (
    options.autoHide !== false &&
    (currentUiState.state === "success" ||
      currentUiState.state === "error")
  ) {
    const stateAtSchedule = currentUiState.state;
    capsuleHideTimer = setTimeout(() => {
      if (currentUiState.state === stateAtSchedule) {
        currentUiState = normalizeUiState({
          state: "idle",
          message: "Pronto",
          profile: activeProfile,
        });
        capsuleWindow.hide();
      }
    }, 1800);
  }
}

async function captureWindow(window, targetPath, signal) {
  try {
    const target = path.resolve(targetPath);
    await mkdir(path.dirname(target), { recursive: true });
    window.showInactive();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const image = await window.webContents.capturePage();
    await writeFile(target, image.toPNG());
    console.log(`${signal}=${target}`);
    app.quit();
  } catch (error) {
    console.error(`${signal}_ERROR=${error.stack || error.message}`);
    app.exit(1);
  }
}

async function runEndToEndTest(audioPath) {
  try {
    const wavBuffer = await readFile(path.resolve(audioPath));
    const result = await transcribeWav({
      projectRoot,
      wavBuffer,
      profile: "fast",
      vocabulary: ["Electron", "TypeScript", "Whisper", "Ollama"],
      threads: 24,
    });
    clipboard.writeText(result.text);
    if (clipboard.readText() !== result.text) {
      throw new Error("O clipboard não preservou o texto transcrito.");
    }
    console.log(`LOCAL_FLOW_E2E_OK=${JSON.stringify(result)}`);
    app.quit();
  } catch (error) {
    console.error(`LOCAL_FLOW_E2E_ERROR=${error.stack || error.message}`);
    app.exit(1);
  }
}

async function runInsertionTest() {
  try {
    const delayMs = Number(
      process.env.LOCAL_FLOW_INSERTION_TEST_DELAY_MS || 0,
    );
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    const target = await windowsBridge.findByTitle(
      process.env.LOCAL_FLOW_INSERTION_TEST_TITLE,
    );
    if (!target) {
      throw new Error("A janela de teste de inserção não foi encontrada.");
    }
    clipboard.writeText("LOCAL_FLOW_CLIPBOARD_ORIGINAL");
    const dictationTarget = {
      ...target,
      isSelf: false,
      clipboard: snapshotTextClipboard(),
    };
    const wavBuffer = await readFile(
      path.resolve(process.env.LOCAL_FLOW_INSERTION_TEST_AUDIO),
    );
    const result = await transcribeWav({
      projectRoot,
      wavBuffer,
      profile: "fast",
      vocabulary: ["Electron", "TypeScript", "Whisper", "Ollama"],
      threads: 24,
    });
    const insertion = await pasteShortcutResult(
      result.text,
      dictationTarget,
    );
    if (!insertion.autoPasted) {
      throw new Error(
        `A inserção falhou: ${insertion.reason} ${JSON.stringify(insertion.diagnostics)}`,
      );
    }
    if (clipboard.readText() !== "LOCAL_FLOW_CLIPBOARD_ORIGINAL") {
      throw new Error("O clipboard textual não foi restaurado.");
    }
    console.log(
      `LOCAL_FLOW_INSERTION_OK=${JSON.stringify({
        text: result.text,
        ...insertion,
      })}`,
    );
    app.quit();
  } catch (error) {
    console.error(
      `LOCAL_FLOW_INSERTION_ERROR=${error.stack || error.message}`,
    );
    app.exit(1);
  }
}

async function runLifecycleTest() {
  try {
    dashboardWindow.close();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const hiddenButAlive =
      !dashboardWindow.isDestroyed() && !dashboardWindow.isVisible();
    const capsuleDoesNotFocus =
      typeof capsuleWindow.isFocusable !== "function" ||
      capsuleWindow.isFocusable() === false;
    showDashboard();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const reopened = dashboardWindow.isVisible();
    if (!tray || !hiddenButAlive || !reopened || !capsuleDoesNotFocus) {
      throw new Error(
        JSON.stringify({
          tray: Boolean(tray),
          hiddenButAlive,
          reopened,
          capsuleDoesNotFocus,
        }),
      );
    }
    console.log(
      `LOCAL_FLOW_LIFECYCLE_OK=${JSON.stringify({
        hiddenButAlive,
        reopened,
        capsuleDoesNotFocus,
      })}`,
    );
    isQuitting = true;
    app.quit();
  } catch (error) {
    console.error(
      `LOCAL_FLOW_LIFECYCLE_ERROR=${error.stack || error.message}`,
    );
    app.exit(1);
  }
}

function configureMicrophonePermission() {
  session.defaultSession.setPermissionCheckHandler(
    (webContents, permission, requestingOrigin, details) => {
      const requestsAudio =
        !details?.mediaType ||
        details.mediaType === "audio" ||
        details.mediaType === "unknown";
      return (
        webContents === dashboardWindow?.webContents &&
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
        webContents === dashboardWindow?.webContents &&
        details?.isMainFrame !== false &&
        String(details?.requestingUrl || "").startsWith("file://");
      callback(permission === "media" && requestsAudio && trustedPage);
    },
  );
}

app.whenReady().then(() => {
  windowsBridge = new WindowsBridge({
    scriptPath: path.join(
      projectRoot,
      "native",
      "windows",
      "foreground-helper.ps1",
    ),
  });
  windowsBridge.start();
  createDashboardWindow();
  createCapsuleWindow();
  configureMicrophonePermission();
  createShortcutController();
  registerDictationShortcut();
  if (
    !automatedRun ||
    process.env.LOCAL_FLOW_TRAY_TEST === "1" ||
    process.env.LOCAL_FLOW_LIFECYCLE_TEST === "1"
  ) {
    createTray();
  }

  screen.on("display-metrics-changed", positionCapsule);
  screen.on("display-added", positionCapsule);
  screen.on("display-removed", positionCapsule);

  app.on("activate", showDashboard);
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  windowsBridge?.dispose();
});

app.on("window-all-closed", () => {
  if (automatedRun) app.quit();
});

ipcMain.handle("runtime:inspect", async () => ({
  ...(await inspectRuntime(projectRoot)),
  shortcut: {
    accelerator: DICTATION_SHORTCUT,
    display: "Ctrl+Shift+Espaço",
    mode: "toggle",
    registered: shortcutRegistered,
    error: shortcutRegistrationError,
  },
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
    const result = await transcribeWav({
      projectRoot,
      wavBuffer: Buffer.from(payload.audio),
      profile: payload.profile,
      vocabulary: payload.vocabulary,
      threads: 24,
    });
    const insertion = shortcutTarget
      ? await pasteShortcutResult(result.text, shortcutTarget)
      : (() => {
          clipboard.writeText(result.text);
          return {
            autoPasted: false,
            clipboardRestored: false,
            reason: "manual-recording",
          };
        })();
    shortcutController?.complete();
    return {
      ...result,
      copiedToClipboard: true,
      ...insertion,
    };
  } catch (error) {
    shortcutController?.fail();
    throw error;
  } finally {
    transcriptionRunning = false;
  }
});

ipcMain.handle("clipboard:write", (_event, text) => {
  clipboard.writeText(String(text));
  return true;
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
  if (payload?.type === "error") {
    shortcutController?.fail();
  }
});

ipcMain.handle("ui:get-state", () => currentUiState);

ipcMain.handle("app:show-dashboard", () => {
  showDashboard();
  return true;
});

ipcMain.handle("app:hide-dashboard", () => {
  dashboardWindow?.hide();
  rebuildTrayMenu();
  return true;
});
