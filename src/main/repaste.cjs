// Global "paste the last transcription again": the fix for a paste that went
// to the wrong field or did not happen at all. It reuses the dictation's
// delivery path, so auto-paste, the focus checks and the Ctrl+V fallback
// behave exactly as they do at the end of a dictation.
class LastTranscriptionPaster {
  constructor({
    historyStore,
    captureTarget,
    clipboardService,
    settingsStore,
    isBusy,
    showState,
    getProfile,
    logger,
  }) {
    this.historyStore = historyStore;
    this.captureTarget = captureTarget;
    this.clipboardService = clipboardService;
    this.settingsStore = settingsStore;
    this.isBusy = isBusy;
    this.showState = showState;
    this.getProfile = getProfile;
    this.logger = logger;
    this.pending = false;
  }

  // `target` overrides the foreground capture (the tray passes one: opening it
  // takes focus from the app the user was in).
  async paste({ target: knownTarget } = {}) {
    // A dictation owns the clipboard and the capsule until it finishes.
    if (this.pending || this.isBusy()) return "busy";
    this.pending = true;
    try {
      // Capture first: the foreground window is the field the user was in
      // when they pressed the shortcut.
      const target = knownTarget ?? await this.captureTarget();
      const last = await this.historyStore?.last();
      const text = last?.correctedText || last?.text;
      if (!text) {
        this.show({ state: "error", message: "Nada para colar" });
        return "empty";
      }
      const insertion = await this.clipboardService.insert(
        text,
        target,
        this.settingsStore.get(),
      );
      this.show({
        state: "success",
        message: insertion.autoPasted ? "Colado" : "Use Ctrl+V",
        manualPaste: !insertion.autoPasted,
      });
      await this.logger?.info("last_transcription_repasted", {
        autoPasted: insertion.autoPasted,
        fallbackReason: insertion.reason,
      });
      return insertion.autoPasted ? "pasted" : "copied";
    } catch (error) {
      await this.logger?.error("last_transcription_repaste_failed", error);
      this.show({ state: "error", message: "Não consegui colar" });
      return "failed";
    } finally {
      this.pending = false;
    }
  }

  show(state) {
    this.showState({ ...state, profile: this.getProfile() });
  }
}

module.exports = { LastTranscriptionPaster };
