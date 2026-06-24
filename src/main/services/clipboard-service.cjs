class ClipboardService {
  constructor({ clipboard, windowsBridge, delay = 450 } = {}) {
    this.clipboard = clipboard;
    this.windowsBridge = windowsBridge;
    this.delay = delay;
  }

  snapshotText() {
    const formats = this.clipboard.availableFormats();
    const text = this.clipboard.readText();
    return {
      text,
      canRestore:
        text.length > 0 || formats.some((format) => /text/i.test(format)),
    };
  }

  async insert(text, target, settings) {
    this.clipboard.writeText(text);
    if (!settings.autoPaste) {
      return this.fallback("auto-paste-disabled");
    }
    if (!target?.hwnd || target.isSelf) {
      return this.fallback(
        target?.isSelf ? "local-flow-active" : "target-unavailable",
      );
    }

    let pasteResult;
    try {
      pasteResult = await this.windowsBridge.pasteTo(target.hwnd);
    } catch (error) {
      return this.fallback("windows-helper-failed", {
        errorCode: error.code || error.name,
      });
    }
    if (!pasteResult?.pasted) {
      return this.fallback("focus-or-paste-failed", pasteResult || null);
    }

    let clipboardRestored = false;
    if (settings.restoreClipboard && target.clipboard?.canRestore) {
      await new Promise((resolve) => setTimeout(resolve, this.delay));
      this.clipboard.writeText(target.clipboard.text);
      clipboardRestored = true;
    }
    return {
      autoPasted: true,
      clipboardRestored,
      reason: null,
    };
  }

  fallback(reason, diagnostics = null) {
    return {
      autoPasted: false,
      clipboardRestored: false,
      reason,
      diagnostics,
    };
  }
}

module.exports = { ClipboardService };

