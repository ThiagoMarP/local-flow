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
    this.lastToggleAt = -Infinity;
  }

  async toggle() {
    const now = this.clock();
    if (now - this.lastToggleAt < this.debounceMs) {
      return { accepted: false, reason: "debounce", state: this.state };
    }
    this.lastToggleAt = now;

    if (this.state === "idle") {
      this.setState("starting");
      try {
        this.target = await this.captureTarget();
        await this.onStart(this.target);
        this.setState("recording");
        return { accepted: true, action: "start", target: this.target };
      } catch (error) {
        this.reset();
        throw error;
      }
    }

    if (this.state === "recording") {
      this.setState("processing");
      try {
        await this.onStop(this.target);
        return { accepted: true, action: "stop", target: this.target };
      } catch (error) {
        this.reset();
        throw error;
      }
    }

    return { accepted: false, reason: "busy", state: this.state };
  }

  setState(state) {
    this.state = state;
    this.onStateChange(state, this.target);
  }

  complete() {
    this.reset();
  }

  fail() {
    this.reset();
  }

  reset() {
    this.state = "idle";
    this.target = null;
    this.onStateChange(this.state, this.target);
  }
}

module.exports = { ToggleDictationController };

