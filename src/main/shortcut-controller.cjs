class ToggleDictationController {
  constructor({
    captureTarget,
    onStart,
    onStop,
    onStateChange = () => {},
    debounceMs = 450,
    clock = () => Date.now(),
  }) {
    this.captureTarget = captureTarget;
    this.onStart = onStart;
    this.onStop = onStop;
    this.onStateChange = onStateChange;
    this.debounceMs = debounceMs;
    this.clock = clock;
    this.state = "idle";
    this.target = null;
    // How the current recording started: "hold" (push-to-talk, ends on
    // release) or "locked" (toggle, ends on the next gesture).
    this.mode = null;
    this.lastToggleAt = -Infinity;
    // A foreground-window lookup can still be pending when Escape cancels the
    // gesture. Its completion must not send a late start command.
    this.generation = 0;
    // Last state the renderer reported about the microphone. The renderer owns
    // the real recording, so this is our source of truth for self-healing when
    // our own state machine drifts (a dropped IPC, an ignored command, an empty
    // recording that never produced a transcription). `null` means "unknown" —
    // we never reset on an unknown state, only on a positive rest report.
    this.rendererState = null;
  }

  // Records the renderer's current microphone state (idle/recording/processing/
  // success/error). Driven from the renderer's UI-state reports in main.
  notifyRendererState(state) {
    if (typeof state === "string" && state) {
      this.rendererState = state;
    }
  }

  // True when the renderer has affirmatively reported it is NOT recording or
  // transcribing — i.e. nothing is actually in flight on its side.
  rendererAtRest() {
    return ["idle", "success", "error"].includes(this.rendererState);
  }

  // If we believe a dictation is in progress but the renderer has gone back to
  // rest, a command was lost or yielded no audio. Drop the stale state so the
  // next gesture starts fresh instead of wedging the shortcut forever.
  recoverIfStale() {
    if (this.state !== "idle" && this.rendererAtRest()) {
      this.reset();
    }
  }

  // Begin a recording. Used directly by the push-to-talk (hold) gesture, which
  // must not be debounced because the user controls the press/release timing.
  // A caller that already knows where the text goes (the tray, which has taken
  // focus from the user's app) passes `target` and skips the capture.
  async start({ target: knownTarget, mode = "hold" } = {}) {
    this.recoverIfStale();
    if (this.state !== "idle") {
      return { accepted: false, reason: "busy", state: this.state };
    }
    this.mode = mode;
    this.setState("starting");
    const generation = this.generation;
    try {
      const target = knownTarget ?? await this.captureTarget();
      if (generation !== this.generation) {
        return { accepted: false, reason: "cancelled", state: this.state };
      }
      this.target = target;
      await this.onStart(target);
      if (generation !== this.generation) {
        return { accepted: false, reason: "cancelled", state: this.state };
      }
      this.setState("recording");
      return { accepted: true, action: "start", target: this.target };
    } catch (error) {
      if (generation === this.generation) this.reset();
      throw error;
    }
  }

  async stop() {
    if (this.state !== "recording") {
      return { accepted: false, reason: "busy", state: this.state };
    }
    this.setState("processing");
    try {
      await this.onStop(this.target);
      return { accepted: true, action: "stop", target: this.target };
    } catch (error) {
      this.reset();
      throw error;
    }
  }

  // Toggle entry point for the accelerator and the double-tap gesture. The
  // debounce here swallows keyboard auto-repeat from the global accelerator.
  async toggle(options = {}) {
    const now = this.clock();
    if (now - this.lastToggleAt < this.debounceMs) {
      return { accepted: false, reason: "debounce", state: this.state };
    }
    this.lastToggleAt = now;
    this.recoverIfStale();
    if (this.state === "idle") return this.start({ ...options, mode: "locked" });
    if (this.state === "recording") return this.stop();
    return { accepted: false, reason: "busy", state: this.state };
  }

  // True while a push-to-talk recording is being held; the capsule shows a lock
  // for every other recording.
  isHoldGesture() {
    return this.mode === "hold" && ["starting", "recording"].includes(this.state);
  }

  setState(state) {
    this.state = state;
    this.onStateChange(state, this.target);
  }

  ownsProcessing(generation, target) {
    return this.state === "processing" &&
      this.generation === generation &&
      this.target === target;
  }

  complete() {
    this.reset();
  }

  fail() {
    this.reset();
  }

  reset() {
    this.generation += 1;
    this.state = "idle";
    this.target = null;
    this.mode = null;
    this.onStateChange(this.state, this.target);
  }
}

module.exports = { ToggleDictationController };

