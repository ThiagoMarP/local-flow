const { REPASTE_SHORTCUT_OFF } = require("./services/settings-store.cjs");

// Global dictation, meeting and repaste shortcuts. Electron's globalShortcut
// only offers unregisterAll() cheaply, so re-registering dictation also
// re-registers the other two.
class ShortcutRegistry {
  constructor({
    app,
    globalShortcut,
    settingsStore,
    windowManager,
    onDictation,
    onMeeting,
    onRepaste,
    disableEscape,
    syncEscape,
  }) {
    this.app = app;
    this.globalShortcut = globalShortcut;
    this.settingsStore = settingsStore;
    this.windowManager = windowManager;
    this.onDictation = onDictation;
    this.onMeeting = onMeeting;
    this.onRepaste = onRepaste;
    this.disableEscape = disableEscape;
    this.syncEscape = syncEscape;
    this.activeShortcut = "CommandOrControl+Shift+Space";
    this.activeMeetingShortcut = "CommandOrControl+Alt+R";
    this.registered = false;
    this.registrationError = "";
    // The repaste shortcut the user chose, or "off". Read from settings on
    // the first registration, then owned here so re-registering dictation
    // (unregisterAll) restores the active one.
    this.activeRepasteShortcut = null;
    this.repasteRegistered = false;
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

  // The paste helper waits for the shortcut's modifiers to be released before
  // it sends its own Ctrl+V, so any Ctrl+Alt+… combo is safe here.
  registerRepaste(
    shortcut = this.activeRepasteShortcut ?? this.settingsStore.get().repasteShortcut,
  ) {
    if (!this.onRepaste) return false;
    this.activeRepasteShortcut = shortcut;
    const disabled = shortcut === REPASTE_SHORTCUT_OFF;
    this.repasteRegistered = disabled
      ? false
      : this.globalShortcut.register(shortcut, () => this.onRepaste());
    this.windowManager?.setRepasteStatus?.({
      registered: this.repasteRegistered,
      disabled,
      display: this.formatRepaste(shortcut),
    });
    return disabled || this.repasteRegistered;
  }

  // Falls back to the previous shortcut when the new one is taken.
  updateRepaste(nextShortcut) {
    const previous = this.activeRepasteShortcut;
    if (previous && previous !== REPASTE_SHORTCUT_OFF && this.repasteRegistered) {
      this.globalShortcut.unregister(previous);
    }
    if (this.registerRepaste(nextShortcut)) return true;
    if (previous) this.registerRepaste(previous);
    return false;
  }

  formatRepaste(accelerator) {
    return (
      this.settingsStore
        ?.getPublic()
        .allowedRepasteShortcuts?.find((item) => item.value === accelerator)
        ?.label || accelerator
    );
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
    // unregisterAll() above removed the meeting and repaste shortcuts too.
    this.registerMeeting();
    this.registerRepaste();
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
      repaste: {
        accelerator: this.activeRepasteShortcut,
        display: this.formatRepaste(this.activeRepasteShortcut),
        registered: this.repasteRegistered,
      },
    };
  }
}

module.exports = { ShortcutRegistry };
