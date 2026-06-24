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
  }) {
    this.projectRoot = projectRoot;
    this.logger = logger;
    this.automatedRun = automatedRun;
    this.persistentWindowRun = persistentWindowRun;
    this.shouldStartHidden = shouldStartHidden;
    this.onDashboardReady = onDashboardReady;
    this.onCapsuleReady = onCapsuleReady;
    this.onQuit = onQuit;
    this.dashboardWindow = null;
    this.capsuleWindow = null;
    this.tray = null;
    this.isQuitting = false;
    this.capsuleHideTimer = null;
    this.activeProfile = "standard";
    this.shortcut = {
      registered: false,
      display: "Ctrl+Shift+Espaço",
    };
    this.currentUiState = normalizeUiState({
      state: "idle",
      message: "Pronto",
      profile: this.activeProfile,
    });
  }

  createAll({ dashboardQuery } = {}) {
    this.createDashboard({ query: dashboardQuery });
    if (this.automatedRun) this.createCapsule();
    screen.on("display-metrics-changed", () => this.positionCapsule());
    screen.on("display-added", () => this.positionCapsule());
    screen.on("display-removed", () => this.positionCapsule());
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
    this.dashboardWindow = new BrowserWindow({
      width: 820,
      height: 720,
      minWidth: 680,
      minHeight: 600,
      backgroundColor: "#0b0d12",
      title: "Local Flow",
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
    this.dashboardWindow.webContents.once(
      "did-finish-load",
      () => this.onDashboardReady?.(this.dashboardWindow),
    );
  }

  createCapsule() {
    this.capsuleWindow = new BrowserWindow({
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
    this.capsuleWindow.setAlwaysOnTop(true, "floating");
    this.capsuleWindow.setIgnoreMouseEvents(true);
    this.capsuleWindow.loadFile(
      path.join(this.projectRoot, "src", "renderer", "capsule.html"),
    );
    this.positionCapsule();
    this.capsuleWindow.webContents.once("did-finish-load", () => {
      this.capsuleWindow.webContents.send(
        "ui:state",
        this.currentUiState,
      );
      this.onCapsuleReady?.(this.capsuleWindow);
    });
  }

  createTray() {
    this.tray = new Tray(this.createTrayIcon());
    this.tray.setToolTip("Local Flow — ditado local");
    this.tray.on("double-click", () => this.showDashboard());
    this.rebuildTrayMenu();
  }

  createTrayIcon() {
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

  rebuildTrayMenu() {
    if (!this.tray) return;
    const profileLabels = {
      fast: "Rápido · Small",
      standard: "Padrão · Medium",
      accurate: "Precisão · Large V3 Turbo",
    };
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Abrir Local Flow", click: () => this.showDashboard() },
        {
          label: this.dashboardWindow?.isVisible()
            ? "Ocultar painel"
            : "Mostrar painel",
          click: () => {
            if (this.dashboardWindow?.isVisible()) this.hideDashboard();
            else this.showDashboard();
          },
        },
        { type: "separator" },
        {
          label: `Perfil: ${profileLabels[this.activeProfile]}`,
          enabled: false,
        },
        {
          label: this.shortcut.registered
            ? `Atalho: ${this.shortcut.display}`
            : "Atalho global indisponível",
          enabled: false,
        },
        { type: "separator" },
        {
          label: "Sair",
          click: () => {
            this.isQuitting = true;
            this.onQuit?.();
          },
        },
      ]),
    );
  }

  setShortcutStatus(shortcut) {
    this.shortcut = { ...this.shortcut, ...shortcut };
    this.rebuildTrayMenu();
  }

  setProfile(profile) {
    this.activeProfile = profile;
    this.rebuildTrayMenu();
  }

  positionCapsule() {
    if (!this.capsuleWindow || this.capsuleWindow.isDestroyed()) return;
    let display = screen.getPrimaryDisplay();
    if (this.dashboardWindow && !this.dashboardWindow.isDestroyed()) {
      display = screen.getDisplayMatching(this.dashboardWindow.getBounds());
    }
    this.capsuleWindow.setBounds(
      calculateCapsuleBounds(display.workArea, {
        width: 420,
        height: 82,
        margin: 24,
      }),
    );
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

  hideDashboard() {
    this.dashboardWindow?.hide();
    this.rebuildTrayMenu();
  }

  applyUiState(payload, options = {}) {
    this.currentUiState = normalizeUiState(payload);
    if (this.currentUiState.profile) {
      this.setProfile(this.currentUiState.profile);
    }
    if (!this.capsuleWindow || this.capsuleWindow.isDestroyed()) {
      if (this.currentUiState.state === "idle") return;
      this.createCapsule();
      this.capsuleWindow.webContents.once("did-finish-load", () => {
        this.applyUiState(this.currentUiState, options);
      });
      return;
    }

    clearTimeout(this.capsuleHideTimer);
    this.capsuleWindow.webContents.send(
      "ui:state",
      this.currentUiState,
    );
    if (this.currentUiState.state === "idle") {
      this.capsuleWindow.hide();
      return;
    }
    this.positionCapsule();
    this.capsuleWindow.showInactive();

    if (
      options.autoHide !== false &&
      ["success", "error"].includes(this.currentUiState.state)
    ) {
      const stateAtSchedule = this.currentUiState.state;
      this.capsuleHideTimer = setTimeout(() => {
        if (this.currentUiState.state === stateAtSchedule) {
          this.currentUiState = normalizeUiState({
            state: "idle",
            message: "Pronto",
            profile: this.activeProfile,
          });
          this.capsuleWindow.hide();
        }
      }, 1800);
    }
  }

  beginQuit() {
    this.isQuitting = true;
  }
}

module.exports = { WindowManager };
