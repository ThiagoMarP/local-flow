const { spawn } = require("node:child_process");
const { createInterface } = require("node:readline");
const { HotkeyController } = require("./hotkey-controller.cjs");

// Spawns the native Ctrl+Win keyboard hook and feeds its key transitions into a
// HotkeyController. Mirrors the persistent-PowerShell pattern of WindowsBridge.
class HotkeyListener {
  constructor({ scriptPath, controller, onStatus = () => {}, onEscape = () => {}, logger } = {}) {
    if (!scriptPath) throw new Error("scriptPath é obrigatório.");
    if (!controller) throw new Error("controller é obrigatório.");
    this.scriptPath = scriptPath;
    this.controller = controller;
    this.onStatus = onStatus;
    this.onEscape = onEscape;
    this.logger = logger;
    this.process = null;
    this.ready = false;
    this.stopping = false;
    this.restartTimer = null;
  }

  start() {
    if (this.process) return;
    this.stopping = false;
    this.process = spawn(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        this.scriptPath,
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    createInterface({ input: this.process.stdout }).on("line", (line) =>
      this.handleLine(line),
    );
    this.process.once("exit", (code) => {
      const wasReady = this.ready;
      this.ready = false;
      this.process = null;
      this.controller.reset();
      this.onStatus({ active: false, ready: false, code });
      if (!this.stopping && wasReady) {
        this.logger?.warn?.("hotkey_listener_exited", { code });
        this.restartTimer = setTimeout(() => {
          if (!this.stopping) this.start();
        }, 1000);
      }
    });
    this.process.once("error", (error) => {
      this.process = null;
      this.ready = false;
      this.logger?.error?.("hotkey_listener_error", error);
      this.onStatus({ active: false, ready: false });
    });
  }

  handleLine(line) {
    let payload;
    try {
      payload = JSON.parse(line);
    } catch {
      return;
    }
    switch (payload.event) {
      case "ready":
        this.ready = true;
        this.onStatus({ active: true, ready: true });
        break;
      case "down":
        this.controller.pressDown();
        break;
      case "up":
        this.controller.pressUp();
        break;
      case "escape":
        // A later release of Ctrl+Win must not stop/transcribe a discarded
        // push-to-talk recording.
        this.controller.reset();
        this.onEscape();
        break;
      case "error":
        this.ready = false;
        this.logger?.warn?.("hotkey_hook_error", { code: payload.code });
        this.onStatus({ active: false, ready: false, code: payload.code });
        break;
      default:
        break;
    }
  }

  dispose() {
    this.stopping = true;
    clearTimeout(this.restartTimer);
    this.controller.reset();
    if (!this.process) return;
    this.process.kill();
    this.process = null;
    this.ready = false;
  }
}

// Wires the three gestures to the existing dictation controller. Hold uses the
// debounce-free start/stop; double tap reuses the toggle (fixed mode).
function createHotkeyTrigger({
  scriptPath,
  shortcutController,
  windowManager,
  getProfile = () => "standard",
  onEscape = () => {},
  logger,
  holdThresholdMs,
  doubleTapWindowMs,
}) {
  const onError = (error) => {
    shortcutController.fail();
    logger?.error?.("hotkey_gesture_failed", error);
    windowManager?.applyUiState?.({
      state: "error",
      message: "O atalho não pôde iniciar o ditado.",
      profile: getProfile(),
    });
  };
  const guard = (promise) =>
    Promise.resolve(promise).catch(onError);

  const controller = new HotkeyController({
    holdThresholdMs,
    doubleTapWindowMs,
    onHoldStart: () => guard(shortcutController.start()),
    onHoldStop: () => guard(shortcutController.stop()),
    onLockToggle: () => guard(shortcutController.toggle()),
  });

  const listener = new HotkeyListener({
    scriptPath,
    controller,
    logger,
    onStatus: (status) => windowManager?.setHotkeyStatus?.(status),
    onEscape,
  });

  return { controller, listener };
}

module.exports = { HotkeyListener, createHotkeyTrigger };
