// Global dictation and meeting shortcuts. Electron's globalShortcut only offers
// unregisterAll() cheaply, so re-registering dictation also re-registers the
// meeting shortcut.
class ShortcutRegistry {
  constructor({
    app,
    globalShortcut,
    settingsStore,
    windowManager,
    onDictation,
    onMeeting,
    disableEscape,
    syncEscape,
  }) {
    this.app = app;
    this.globalShortcut = globalShortcut;
    this.settingsStore = settingsStore;
    this.windowManager = windowManager;
    this.onDictation = onDictation;
    this.onMeeting = onMeeting;
    this.disableEscape = disableEscape;
    this.syncEscape = syncEscape;
    this.activeShortcut = "CommandOrControl+Shift+Space";
    this.activeMeetingShortcut = "CommandOrControl+Alt+R";
    this.registered = false;
    this.registrationError = "";
  }

  format(accelerator) {
    return (
      this.settingsStore
        ?.getPublic()
        .allowedShortcuts.find((item) => item.value === accelerator)
        ?.label || accelerator
    );
  }

  registerMeeting(shortcut = this.settingsStore.get().meetingShortcut) {
    this.activeMeetingShortcut = shortcut;
    this.globalShortcut.register(shortcut, () => this.onMeeting());
  }

  replaceMeeting(shortcut) {
    this.globalShortcut.unregister(this.activeMeetingShortcut);
    this.registerMeeting(shortcut);
  }

  registerDictation(shortcut = this.settingsStore.get().shortcut) {
    this.disableEscape();
    this.globalShortcut.unregisterAll();
    this.activeShortcut = shortcut;
    this.registered = this.globalShortcut.register(
      this.activeShortcut,
      () => this.onDictation(this.activeShortcut),
    );
    this.registrationError = this.registered
      ? ""
      : `${this.format(this.activeShortcut)} já está sendo usado por outro aplicativo.`;
    this.windowManager?.setShortcutStatus({
      registered: this.registered,
      display: this.format(this.activeShortcut),
    });
    // unregisterAll() above removed the meeting shortcut too.
    this.registerMeeting();
    this.syncEscape();
    console.log(
      `LOCAL_FLOW_SHORTCUT_READY=${JSON.stringify({
        accelerator: this.activeShortcut,
        registered: this.registered,
      })}`,
    );
    if (this.registered && process.env.LOCAL_FLOW_SHORTCUT_TEST === "1") {
      setTimeout(() => this.app.quit(), 300);
    }
  }

  // Falls back to the previous shortcut when the new one is taken.
  update(nextShortcut) {
    const previous = this.activeShortcut;
    this.registerDictation(nextShortcut);
    if (this.registered) return true;
    this.registerDictation(previous);
    return false;
  }

  status() {
    return {
      accelerator: this.activeShortcut,
      display: this.format(this.activeShortcut),
      mode: "toggle",
      registered: this.registered,
      error: this.registrationError,
    };
  }
}

module.exports = { ShortcutRegistry };
