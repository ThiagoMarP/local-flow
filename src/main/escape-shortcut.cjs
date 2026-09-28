// The bare Escape key must only be a global shortcut while a dictation can
// still be discarded. Registering it at startup would steal Escape from every
// other application even when Local Flow is idle.
class EscapeShortcut {
  constructor({ globalShortcut, onEscape, onUnavailable = () => {} }) {
    this.globalShortcut = globalShortcut;
    this.onEscape = onEscape;
    this.onUnavailable = onUnavailable;
    this.enabled = false;
    this.registered = false;
  }

  setEnabled(enabled) {
    const next = Boolean(enabled);
    if (next === this.enabled) return this.registered;
    this.enabled = next;
    if (!next) {
      if (this.registered) this.globalShortcut.unregister("Escape");
      this.registered = false;
      return false;
    }
    this.registered = this.globalShortcut.register("Escape", this.onEscape);
    if (!this.registered) this.onUnavailable();
    return this.registered;
  }

  dispose() {
    this.setEnabled(false);
  }
}

module.exports = { EscapeShortcut };
