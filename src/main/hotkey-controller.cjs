// Interprets raw "chord down / chord up" transitions from the native Ctrl+Win
// keyboard hook into three gestures:
//
//   - hold        → press and keep held: push-to-talk (record while held).
//   - double tap  → two quick taps: toggle a locked recording on/off.
//   - single tap  → ignored by default (avoids accidental triggers).
//
// All timing lives here, in plain JS, so it can be unit-tested with a fake
// clock. The PowerShell hook only reports key transitions.
class HotkeyController {
  constructor({
    onHoldStart = () => {},
    onHoldStop = () => {},
    onLockToggle = () => {},
    onSingleTap = () => {},
    holdThresholdMs = 220,
    doubleTapWindowMs = 320,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = {}) {
    this.onHoldStart = onHoldStart;
    this.onHoldStop = onHoldStop;
    this.onLockToggle = onLockToggle;
    this.onSingleTap = onSingleTap;
    this.holdThresholdMs = holdThresholdMs;
    this.doubleTapWindowMs = doubleTapWindowMs;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;

    this.down = false;
    this.holding = false;
    this.tapCount = 0;
    this.holdTimer = null;
    this.singleTapTimer = null;
  }

  pressDown() {
    if (this.down) return;
    this.down = true;
    // A new press cancels a pending single-tap decision: it may become the
    // second half of a double tap.
    this.clearTimer(this.singleTapTimer);
    this.singleTapTimer = null;
    this.holdTimer = this.setTimer(() => {
      this.holdTimer = null;
      if (!this.down) return;
      this.holding = true;
      this.tapCount = 0;
      this.onHoldStart();
    }, this.holdThresholdMs);
  }

  pressUp() {
    if (!this.down) return;
    this.down = false;
    this.clearTimer(this.holdTimer);
    this.holdTimer = null;

    if (this.holding) {
      this.holding = false;
      this.onHoldStop();
      return;
    }

    // Released before the hold threshold: it counts as a tap.
    this.tapCount += 1;
    if (this.tapCount >= 2) {
      this.tapCount = 0;
      this.onLockToggle();
      return;
    }
    this.singleTapTimer = this.setTimer(() => {
      this.singleTapTimer = null;
      this.tapCount = 0;
      this.onSingleTap();
    }, this.doubleTapWindowMs);
  }

  // Drops any in-flight gesture without firing callbacks. Used when the system
  // suspends or the screen locks mid-press.
  reset() {
    this.clearTimer(this.holdTimer);
    this.clearTimer(this.singleTapTimer);
    this.holdTimer = null;
    this.singleTapTimer = null;
    this.down = false;
    this.holding = false;
    this.tapCount = 0;
  }
}

module.exports = { HotkeyController };
