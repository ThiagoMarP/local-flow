const {
  BrowserWindow,
  Menu,
  nativeImage,
  screen,
  Tray,
} = require("electron");
const path = require("node:path");
const { calculateCapsuleBounds } = require("../window-layout.cjs");
const { normalizeUiState } = require("../ui-state.cjs");
const { buildTrayTemplate } = require("../tray-menu.cjs");

// Wide enough for a short error phrase. The window is click-through outside
// the pill, so the extra transparent width costs nothing.
const CAPSULE_WIDTH = 248;
const CAPSULE_HEIGHT = 78;
const SUCCESS_HIDE_MS = 700;
// Long enough to read "Ctrl+V" or a short error without hovering.
const MANUAL_PASTE_HIDE_MS = 1600;
const ERROR_HIDE_MS = 4000;
const HOVER_EXIT_HIDE_MS = 1200;

function isHoverableCapsuleState(uiState) {
  return uiState.state === "error" ||
    (uiState.state === "success" && uiState.manualPaste);
}

// Concluded states close themselves; every other state (idle included) waits
// for the next update.
function capsuleHideDelay(uiState) {
  if (uiState.state === "error") return ERROR_HIDE_MS;
  if (uiState.state !== "success") return 0;
  return uiState.manualPaste ? MANUAL_PASTE_HIDE_MS : SUCCESS_HIDE_MS;
}

class WindowManager {
  constructor({
    projectRoot,
    logger,
    automatedRun,
    persistentWindowRun,
    shouldStartHidden,
    onDashboardReady,
    onCapsuleReady,
    onQuit,
    displayScreen = screen,
    BrowserWindowClass = BrowserWindow,
    MenuClass = Menu,
  }) {
    this.projectRoot = projectRoot;
    this.logger = logger;
    this.automatedRun = automatedRun;
    this.persistentWindowRun = persistentWindowRun;
    this.shouldStartHidden = shouldStartHidden;
    this.onDashboardReady = onDashboardReady;
    this.onCapsuleReady = onCapsuleReady;
    this.onQuit = onQuit;
    this.displayScreen = displayScreen;
    this.BrowserWindowClass = BrowserWindowClass;
    this.MenuClass = MenuClass;
    // Tray actions wired by main, the revision mode shown in the tray submenu,
    // and a key of the last menu built so unchanged state does not rebuild it.
    this.trayActions = {};
    this.revisionMode = "literal";
    this.revisionEnabled = true;
    this.revisionModes = [];
    this.trayMenuKey = null;
    this.dashboardWindow = null;
    this.capsuleWindow = null;
    this.tray = null;
    this.isQuitting = false;
    this.capsuleHideTimer = null;
    this.capsuleWatchdog = null;
    this.capsuleCursorPoll = null;
    this.followCursorDisplay = false;
    this.capsuleDisplayId = null;
    this.lastCapsuleBounds = null;
    this.capsuleHoverable = false;
    this.capsuleHovered = false;
    this.capsuleAutoHide = true;
    this.activeProfile = "standard";
    this.shortcut = {
      registered: false,
      display: "Ctrl+Shift+Espaço",
    };
    this.hotkeyStatus = { enabled: true, ready: false, display: "Ctrl + Win" };
    this.repasteStatus = { registered: false, disabled: false, display: "Ctrl+Alt+V" };
    this.currentUiState = normalizeUiState({
      state: "idle",
      message: "Pronto",
      profile: this.activeProfile,
    });
  }

  createAll({ dashboardQuery } = {}) {
    this.createDashboard({ query: dashboardQuery });
    this.createCapsule();
    this.displayScreen.on("display-metrics-changed", () =>
      this.positionCapsule({ force: true }),
    );
    this.displayScreen.on("display-added", () =>
      this.positionCapsule({ force: true }),
    );
    this.displayScreen.on("display-removed", () =>
      this.positionCapsule({ force: true }),
    );
    // The capsule is intentionally never hidden. A Windows display/DPI change
    // can occasionally leave a transparent, non-focusable window invisible
    // while the main process (and therefore the shortcuts) keeps running.
    // Check infrequently to restore it without affecting active dictation.
    if (!this.automatedRun) {
      this.capsuleWatchdog = setInterval(
        () => this.ensureCapsuleVisible(),
        5000,
      );
    }
  }

  secureWindow(window) {
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, url) => {
      if (!url.startsWith("file://")) event.preventDefault();
    });
  }

  monitorWindow(window, kind) {
    window.webContents.on("render-process-gone", (_event, details) => {
      this.logger?.warn("renderer_gone", {
        kind,
        reason: details.reason,
        exitCode: details.exitCode,
      });
      if (this.isQuitting || this.automatedRun) return;
      setTimeout(() => {
        if (kind === "dashboard") {
          if (
            this.dashboardWindow &&
            !this.dashboardWindow.isDestroyed()
          ) {
            this.dashboardWindow.destroy();
          }
          this.createDashboard();
        } else {
          if (
            this.capsuleWindow &&
            !this.capsuleWindow.isDestroyed()
          ) {
            this.capsuleWindow.destroy();
          }
          this.createCapsule();
        }
      }, 500);
    });
    window.webContents.on("unresponsive", () => {
      this.logger?.warn("renderer_unresponsive", { kind });
    });
  }

  createDashboard({ query } = {}) {
    this.dashboardWindow = new this.BrowserWindowClass({
      width: 820,
      height: 720,
      minWidth: 680,
      minHeight: 600,
      backgroundColor: "#00000000",
      backgroundMaterial: "acrylic",
      title: "Local Flow",
      icon: path.join(this.projectRoot, "assets", "icon.ico"),
      show:
        (!this.automatedRun && !this.shouldStartHidden) ||
        Boolean(process.env.LOCAL_FLOW_CAPTURE_PATH) ||
        process.env.LOCAL_FLOW_LIFECYCLE_TEST === "1",
      webPreferences: {
        preload: path.join(
          this.projectRoot,
          "src",
          "preload",
          "preload.cjs",
        ),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    this.dashboardWindow.removeMenu();
    this.secureWindow(this.dashboardWindow);
    this.monitorWindow(this.dashboardWindow, "dashboard");
    this.dashboardWindow.loadFile(
      path.join(this.projectRoot, "src", "renderer", "index.html"),
      query ? { query } : undefined,
    );
    this.dashboardWindow.on("close", (event) => {
      if (!this.isQuitting && this.persistentWindowRun) {
        event.preventDefault();
        this.dashboardWindow.hide();
        this.rebuildTrayMenu();
      }
    });
    // Drop the reference the moment the window is gone. Without this the field
    // keeps pointing at a destroyed BrowserWindow, and every later property
    // access throws "TypeError: Object has been destroyed" instead of simply
    // reading as absent.
    this.dashboardWindow.on("closed", () => {
      this.dashboardWindow = null;
    });
    this.dashboardWindow.webContents.once(
      "did-finish-load",
      () => this.onDashboardReady?.(this.dashboardWindow),
    );
  }

  createCapsule() {
    this.capsuleWindow = new this.BrowserWindowClass({
      width: CAPSULE_WIDTH,
      height: CAPSULE_HEIGHT,
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
        preload: path.join(
          this.projectRoot,
          "src",
          "preload",
          "preload.cjs",
        ),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this.secureWindow(this.capsuleWindow);
    this.monitorWindow(this.capsuleWindow, "capsule");
    // "floating" can sit below some maximized/full-screen Windows apps. The
    // capsule is click-through except for its explicit action buttons, so use
    // the higher level that keeps status feedback visible in those apps too.
    this.capsuleWindow.setAlwaysOnTop(true, "screen-saver");
    this.capsuleWindow.setIgnoreMouseEvents(true);
    this.capsuleWindow.loadFile(
      path.join(this.projectRoot, "src", "renderer", "capsule.html"),
    );
    this.lastCapsuleBounds = null;
    this.positionCapsule();
    const capsule = this.capsuleWindow;
    this.capsuleWindow.on("closed", () => {
      if (this.capsuleWindow === capsule) this.capsuleWindow = null;
    });
    this.capsuleWindow.on("hide", () => this.restoreCapsuleSoon("hidden"));
    this.capsuleWindow.on("minimize", () =>
      this.restoreCapsuleSoon("minimized"),
    );
    // Capture the window this callback belongs to: by the time did-finish-load
    // fires, a crash-recovery pass may have replaced this.capsuleWindow, and
    // the old closure must not touch the new window (or a destroyed one).
    capsule.webContents.once("did-finish-load", () => {
      if (capsule.isDestroyed()) return;
      capsule.webContents.send("ui:state", this.currentUiState);
      // Always visible: at rest it's a thin line at the top, growing into the
      // full pill while recording/transcribing.
      if (!this.automatedRun) capsule.showInactive();
      this.onCapsuleReady?.(capsule);
    });
  }

  createTray() {
    this.tray = new Tray(this.createTrayIcon());
    this.tray.setToolTip("Local Flow");
    this.tray.on("double-click", () => this.showDashboard());
    this.rebuildTrayMenu();
  }

  createTrayIcon() {
    // Mesmo icon.ico da janela (átomo completo, multi-tamanho). O Windows escolhe
    // o tamanho embutido mais adequado ao DPI, evitando desfoque por ampliação.
    return nativeImage.createFromPath(
      path.join(this.projectRoot, "assets", "icon.ico"),
    );
  }

  rebuildTrayMenu() {
    if (!this.tray) return;
    const content = {
      dictationState: this.currentUiState.state,
      dashboardVisible: Boolean(this.dashboardWindow?.isVisible()),
      profile: this.activeProfile,
      hotkey: this.hotkeyStatus,
      shortcut: this.shortcut,
      repaste: this.repasteStatus,
      revisionMode: this.revisionMode,
      revisionEnabled: this.revisionEnabled,
      revisionModes: this.revisionModes,
    };
    // applyUiState runs on every microphone level sample; only rebuild when
    // something the menu shows actually changed.
    const key = JSON.stringify(content);
    if (key === this.trayMenuKey) return;
    this.trayMenuKey = key;
    const noop = () => {};
    this.tray.setContextMenu(
      this.MenuClass.buildFromTemplate(
        buildTrayTemplate({
          ...content,
          actions: {
            toggleDictation: this.trayActions.toggleDictation || noop,
            copyLast: this.trayActions.copyLast || noop,
            setRevisionMode: this.trayActions.setRevisionMode || noop,
            setRevisionEnabled: this.trayActions.setRevisionEnabled || noop,
            showDashboard: () => this.showDashboard(),
            toggleDashboard: () => {
              if (this.dashboardWindow?.isVisible()) this.hideDashboard();
              else this.showDashboard();
            },
            quit: () => {
              this.isQuitting = true;
              this.onQuit?.();
            },
          },
        }),
      ),
    );
  }

  setTrayActions(actions) {
    this.trayActions = { ...actions };
    this.trayMenuKey = null;
    this.rebuildTrayMenu();
  }

  // `modes` ({ value, label }[]) only needs passing once.
  setRevisionEnabled(enabled) {
    this.revisionEnabled = enabled !== false;
    this.rebuildTrayMenu();
  }

  setRevisionMode(mode, modes) {
    this.revisionMode = mode;
    if (modes) this.revisionModes = modes;
    this.rebuildTrayMenu();
  }

  setShortcutStatus(shortcut) {
    this.shortcut = { ...this.shortcut, ...shortcut };
    this.rebuildTrayMenu();
  }

  setHotkeyStatus(status) {
    this.hotkeyStatus = { ...this.hotkeyStatus, ...status };
    this.rebuildTrayMenu();
  }

  setRepasteStatus(status) {
    this.repasteStatus = { ...this.repasteStatus, ...status };
    this.rebuildTrayMenu();
  }

  setProfile(profile) {
    this.activeProfile = profile;
    this.rebuildTrayMenu();
  }

  findCapsuleDisplay() {
    if (this.followCursorDisplay) {
      // Electron's screen coordinates and BrowserWindow bounds both use DIP,
      // including negative origins on monitors above/left of the primary one.
      try {
        const display = this.displayScreen.getDisplayNearestPoint(
          this.displayScreen.getCursorScreenPoint(),
        );
        if (display) return display;
      } catch {
        // Display topology can change between the two calls. Fall through to
        // the last surviving display instead of moving the capsule off-screen.
      }
    }
    if (this.capsuleDisplayId !== null) {
      const previous = this.displayScreen
        .getAllDisplays()
        .find((display) => display.id === this.capsuleDisplayId);
      if (previous) return previous;
    }
    if (this.dashboardWindow && !this.dashboardWindow.isDestroyed()) {
      return this.displayScreen.getDisplayMatching(
        this.dashboardWindow.getBounds(),
      );
    }
    return this.displayScreen.getPrimaryDisplay();
  }

  positionCapsule({ force = false } = {}) {
    if (this.isQuitting || !this.capsuleWindow || this.capsuleWindow.isDestroyed()) {
      return;
    }
    const display = this.findCapsuleDisplay();
    if (!display?.workArea) return;
    const bounds = calculateCapsuleBounds(display.workArea, {
      width: CAPSULE_WIDTH,
      height: CAPSULE_HEIGHT,
      margin: 2,
      anchor: "top",
    });
    const previous = this.lastCapsuleBounds;
    if (force || !previous || Object.keys(bounds).some((key) => bounds[key] !== previous[key])) {
      this.capsuleWindow.setBounds(bounds);
      this.lastCapsuleBounds = bounds;
    }
    this.capsuleDisplayId = display.id;
  }

  updateCursorTracking() {
    const state = this.currentUiState.state;
    const follow = ["recording", "meeting", "processing", "revising"].includes(state);
    this.followCursorDisplay = follow;
    if (follow && !this.capsuleCursorPoll) {
      // Only the monitor changes, not the X/Y position within that monitor.
      // A short interval catches a cursor crossing screens without a global
      // mouse hook and remains dormant outside recording and processing.
      this.capsuleCursorPoll = setInterval(() => this.positionCapsule(), 250);
    } else if (!follow && this.capsuleCursorPoll) {
      clearInterval(this.capsuleCursorPoll);
      this.capsuleCursorPoll = null;
    }
  }

  restoreCapsuleSoon(reason) {
    if (this.isQuitting || this.automatedRun) return;
    setTimeout(() => this.ensureCapsuleVisible(reason), 50);
  }

  ensureCapsuleVisible(reason = "watchdog") {
    if (this.isQuitting || this.automatedRun) return;
    if (!this.capsuleWindow || this.capsuleWindow.isDestroyed()) {
      this.logger?.warn("capsule_recreated", { reason });
      this.createCapsule();
      return;
    }

    const capsule = this.capsuleWindow;
    const wasMinimized = capsule.isMinimized?.() === true;
    const wasHidden = capsule.isVisible?.() === false;
    if (wasMinimized) capsule.restore();
    // Reassert the top level even if Windows changed the z-order. `showInactive`
    // preserves the currently focused app, which is essential for auto-paste.
    capsule.setAlwaysOnTop(true, "screen-saver");
    this.positionCapsule({ force: true });
    if (wasMinimized || wasHidden) {
      capsule.showInactive();
      this.logger?.warn("capsule_restored", {
        reason,
        minimized: wasMinimized,
        hidden: wasHidden,
      });
    }
  }

  showDashboard() {
    if (!this.dashboardWindow || this.dashboardWindow.isDestroyed()) {
      this.createDashboard();
      return;
    }
    this.dashboardWindow.show();
    this.dashboardWindow.focus();
    this.rebuildTrayMenu();
  }

  // Opens the dashboard on a given page (e.g. where a capsule error's full
  // message is shown).
  openDashboardPage(page) {
    const existed = Boolean(this.dashboardWindow && !this.dashboardWindow.isDestroyed());
    this.showDashboard();
    if (existed) this.dashboardWindow.webContents.send("app:navigate", page);
  }

  hideDashboard() {
    this.dashboardWindow?.hide();
    this.rebuildTrayMenu();
  }

  applyUiState(payload, options = {}) {
    this.currentUiState = normalizeUiState(payload);
    this.updateCursorTracking();
    // setProfile rebuilds the tray, which also picks up the dictation state.
    this.setProfile(this.currentUiState.profile);
    if (!this.capsuleWindow || this.capsuleWindow.isDestroyed()) {
      this.createCapsule();
      this.capsuleWindow.webContents.once("did-finish-load", () => {
        this.applyUiState(this.currentUiState, options);
      });
      return;
    }

    clearTimeout(this.capsuleHideTimer);
    this.capsuleHovered = false;
    this.capsuleWindow.webContents.send(
      "ui:state",
      this.currentUiState,
    );
    // Only states that have something to read or click (an error, or the
    // "Ctrl+V" notice) react to the mouse. Even then the window stays
    // click-through: forwarded mouse moves let the capsule report when the
    // cursor is over the pill itself, and only then does it accept clicks, so
    // the transparent margin never swallows a click meant for the app below.
    this.capsuleHoverable = isHoverableCapsuleState(this.currentUiState);
    this.capsuleAutoHide = options.autoHide !== false;
    if (this.capsuleHoverable) {
      this.capsuleWindow.setIgnoreMouseEvents(true, { forward: true });
    } else {
      this.capsuleWindow.setIgnoreMouseEvents(true);
    }
    this.positionCapsule();
    this.capsuleWindow.showInactive();

    const hideAfterMs = capsuleHideDelay(this.currentUiState);
    if (this.capsuleAutoHide && hideAfterMs) {
      this.scheduleCapsuleHide(hideAfterMs);
    }
  }

  scheduleCapsuleHide(delayMs) {
    clearTimeout(this.capsuleHideTimer);
    const stateAtSchedule = this.currentUiState;
    this.capsuleHideTimer = setTimeout(() => {
      if (this.currentUiState === stateAtSchedule) this.dismissCapsule();
    }, delayMs);
  }

  // Reported by the capsule renderer. While the cursor rests on an error or
  // the Ctrl+V notice it stays up; leaving gives a short grace period.
  setCapsuleHover(hovering) {
    if (!this.capsuleHoverable) return;
    if (!this.capsuleWindow || this.capsuleWindow.isDestroyed()) return;
    if (hovering) {
      this.capsuleHovered = true;
      clearTimeout(this.capsuleHideTimer);
      this.capsuleWindow.setIgnoreMouseEvents(false);
      return;
    }
    // A leave without a matching enter (stale renderer hover) must not cut
    // the reading time short.
    if (!this.capsuleHovered) return;
    this.capsuleHovered = false;
    this.capsuleWindow.setIgnoreMouseEvents(true, { forward: true });
    if (this.capsuleAutoHide) this.scheduleCapsuleHide(HOVER_EXIT_HIDE_MS);
  }

  dismissCapsule() {
    clearTimeout(this.capsuleHideTimer);
    this.capsuleHoverable = false;
    this.capsuleHovered = false;
    this.currentUiState = normalizeUiState({
      state: "idle",
      message: "Pronto",
      profile: this.activeProfile,
    });
    if (this.capsuleWindow && !this.capsuleWindow.isDestroyed()) {
      this.capsuleWindow.setIgnoreMouseEvents(true);
      this.capsuleWindow.webContents.send("ui:state", this.currentUiState);
      this.positionCapsule();
      this.capsuleWindow.showInactive();
    }
  }

  beginQuit() {
    this.isQuitting = true;
    clearInterval(this.capsuleWatchdog);
    this.capsuleWatchdog = null;
    clearInterval(this.capsuleCursorPoll);
    this.capsuleCursorPoll = null;
  }
}

module.exports = { WindowManager };
