const os = require("node:os");
const { resolvePersonalizationOptions } = require("./services/personalization-service.cjs");
const { waitForCancelledRunCleanup } = require("./cancelled-run-wait.cjs");

const CANCELLED_RUN_TTL_MS = 120_000;
const MAX_CANCELLED_RUNS = 32;
const RENDERER_BUSY_STATES = ["requesting", "recording", "processing", "revising"];
const SHORTCUT_BUSY_STATES = ["starting", "recording", "processing"];

function normalizedRunId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 128
    ? value
    : null;
}

// The revision switch wins over the chosen mode: off means the text is pasted
// as transcribed. The dashboard sends the switch with each dictation (it is
// current before the settings autosave lands); otherwise the saved value holds.
function resolveRevisionMode(payload, settings) {
  const enabled = typeof payload?.revisionEnabled === "boolean"
    ? payload.revisionEnabled
    : settings.revisionEnabled !== false;
  if (!enabled) return "literal";
  return payload?.revisionMode || settings.revisionMode;
}

function abortError() {
  const error = new Error("Ditado cancelado.");
  error.name = "AbortError";
  return error;
}

// Owns one dictation at a time: the transcription run, what the renderer says
// it is doing, Escape cancellation and the point of no return once the text
// starts being pasted. The shortcut controls are created after this session,
// so they arrive through attachControls().
class DictationSession {
  constructor({
    clipboard,
    clipboardService,
    historyStore,
    logger,
    settingsStore,
    transcriptionPipeline,
    windowManager,
  }) {
    this.clipboard = clipboard;
    this.clipboardService = clipboardService;
    this.historyStore = historyStore;
    this.logger = logger;
    this.settingsStore = settingsStore;
    this.transcriptionPipeline = transcriptionPipeline;
    this.windowManager = windowManager;
    this.shortcutController = null;
    this.hotkeyTrigger = null;
    this.escapeShortcut = null;

    this.transcriptionRunning = false;
    this.activeTranscriptionSettled = null;
    this.activeTranscriptionAbortController = null;
    this.activeTranscriptionRunId = null;
    this.activeTranscriptionShortcutGeneration = null;
    this.dictationRendererRunId = null;
    this.dictationRendererState = "idle";
    this.transcriptionDeliveryStarted = false;
    this.deliveryCommittedRunId = null;
    this.deliveryCommitOrphaned = false;
    this.escapeCancelPending = false;
    this.cancelledRunIds = new Map();
    this.waitingTranscriptionRunIds = new Set();
  }

  attachControls({ shortcutController, hotkeyTrigger, escapeShortcut }) {
    if (shortcutController !== undefined) this.shortcutController = shortcutController;
    if (hotkeyTrigger !== undefined) this.hotkeyTrigger = hotkeyTrigger;
    if (escapeShortcut !== undefined) this.escapeShortcut = escapeShortcut;
  }

  rememberCancelledRun(runId) {
    if (!runId) return;
    const now = Date.now();
    for (const [id, at] of this.cancelledRunIds) {
      if (now - at > CANCELLED_RUN_TTL_MS) this.cancelledRunIds.delete(id);
    }
    this.cancelledRunIds.set(runId, now);
    while (this.cancelledRunIds.size > MAX_CANCELLED_RUNS) {
      this.cancelledRunIds.delete(this.cancelledRunIds.keys().next().value);
    }
  }

  wasRunCancelled(runId) {
    if (!runId) return false;
    const at = this.cancelledRunIds.get(runId);
    if (!at) return false;
    if (Date.now() - at > CANCELLED_RUN_TTL_MS) {
      this.cancelledRunIds.delete(runId);
      return false;
    }
    return true;
  }

  // Anything that uses the dictation pipeline or the microphone, including the
  // shortcut gesture before the renderer has reported a state.
  isBusy() {
    return this.transcriptionRunning ||
      RENDERER_BUSY_STATES.includes(this.dictationRendererState) ||
      SHORTCUT_BUSY_STATES.includes(this.shortcutController?.state);
  }

  canBeCancelled() {
    if (this.transcriptionDeliveryStarted || this.escapeCancelPending) return false;
    const oldRunAborted = Boolean(this.activeTranscriptionAbortController?.signal.aborted);
    const rendererBusy = RENDERER_BUSY_STATES.includes(this.dictationRendererState);
    const shortcutBusy = SHORTCUT_BUSY_STATES.includes(this.shortcutController?.state);
    return (this.transcriptionRunning && !oldRunAborted) ||
      (rendererBusy && (!oldRunAborted ||
        this.dictationRendererRunId !== this.activeTranscriptionRunId)) ||
      (shortcutBusy && (!oldRunAborted ||
        this.shortcutController.generation !== this.activeTranscriptionShortcutGeneration));
  }

  syncEscapeShortcut() {
    this.escapeShortcut?.setEnabled(this.canBeCancelled());
  }

  cancel(source = "escape", requestedRunId = null) {
    const runId = normalizedRunId(requestedRunId);
    if (this.transcriptionDeliveryStarted) {
      this.syncEscapeShortcut();
      return { accepted: false, reason: "already-delivering" };
    }
    const shortcutController = this.shortcutController;
    const newGestureBeforeRendererState =
      this.activeTranscriptionAbortController?.signal.aborted &&
      ["starting", "recording", "processing"].includes(shortcutController?.state) &&
      shortcutController.generation !== this.activeTranscriptionShortcutGeneration;
    const currentRunId = this.dictationRendererRunId ||
      (newGestureBeforeRendererState ? null : this.activeTranscriptionRunId);
    if (runId && this.wasRunCancelled(runId)) {
      return { accepted: true, reason: "already-cancelled" };
    }
    if (runId && runId !== currentRunId) {
      return { accepted: false, reason: "stale-run" };
    }
    if (!this.canBeCancelled() && !runId) {
      return { accepted: false, reason: "idle" };
    }

    this.rememberCancelledRun(runId || currentRunId);
    this.escapeCancelPending = true;
    this.activeTranscriptionAbortController?.abort();
    shortcutController?.fail();
    this.hotkeyTrigger?.controller.reset();
    const window = this.windowManager?.dashboardWindow;
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send("dictation:command", {
        action: "cancel",
        source,
        runId: runId || currentRunId,
      });
    }
    this.dictationRendererState = "idle";
    this.dictationRendererRunId = null;
    this.syncEscapeShortcut();
    return { accepted: true };
  }

  // A dead or reloading renderer cannot acknowledge a cancellation or send a
  // terminal UI state. Release Escape immediately so other apps retain it.
  handleRendererInterrupted() {
    if (!this.transcriptionDeliveryStarted) {
      this.rememberCancelledRun(this.activeTranscriptionRunId);
      this.rememberCancelledRun(this.dictationRendererRunId);
      for (const waitingRunId of this.waitingTranscriptionRunIds) {
        this.rememberCancelledRun(waitingRunId);
      }
      this.activeTranscriptionAbortController?.abort();
    } else if (!this.transcriptionRunning) {
      // Delivery finished, but the renderer disappeared before acknowledging
      // success. No future terminal event can clear this commit marker.
      this.transcriptionDeliveryStarted = false;
      this.deliveryCommittedRunId = null;
      this.deliveryCommitOrphaned = false;
    } else {
      this.deliveryCommitOrphaned = true;
    }
    this.shortcutController?.fail();
    this.hotkeyTrigger?.controller.reset();
    this.dictationRendererState = "idle";
    this.dictationRendererRunId = null;
    this.escapeCancelPending = false;
    this.syncEscapeShortcut();
  }

  async run(event, payload) {
    const runId = normalizedRunId(payload?.runId);
    if (this.transcriptionRunning &&
      this.activeTranscriptionAbortController?.signal.aborted &&
      this.activeTranscriptionSettled) {
      if (runId) this.waitingTranscriptionRunIds.add(runId);
      try {
        await waitForCancelledRunCleanup(this.activeTranscriptionSettled);
      } finally {
        if (runId) this.waitingTranscriptionRunIds.delete(runId);
      }
    }
    // Escape could cancel this new run while it waits for the old subprocess.
    if (this.wasRunCancelled(runId)) throw abortError();
    if (this.transcriptionRunning) {
      throw new Error("Já existe uma transcrição em andamento.");
    }
    this.transcriptionRunning = true;
    let settleThisRun;
    const thisRunSettled = new Promise((resolve) => { settleThisRun = resolve; });
    this.activeTranscriptionSettled = thisRunSettled;
    this.transcriptionDeliveryStarted = false;
    this.deliveryCommittedRunId = null;
    this.deliveryCommitOrphaned = false;
    this.activeTranscriptionRunId = runId;
    const runAbortController = new AbortController();
    this.activeTranscriptionAbortController = runAbortController;
    this.syncEscapeShortcut();
    const shortcutController = this.shortcutController;
    const shortcutTarget =
      shortcutController?.state === "processing"
        ? shortcutController.target
        : null;
    const shortcutGeneration = shortcutTarget
      ? shortcutController.generation
      : null;
    this.activeTranscriptionShortcutGeneration = shortcutGeneration;
    const ownsShortcutRun = () => shortcutGeneration !== null &&
      this.shortcutController?.ownsProcessing(shortcutGeneration, shortcutTarget);
    try {
      const settings = this.settingsStore.get();
      const profile = payload?.profile || settings.profile;
      const vocabulary = Array.isArray(payload?.vocabulary)
        ? payload.vocabulary
        : settings.vocabulary;
      const result = await this.transcriptionPipeline.run({
        wavBuffer: Buffer.from(payload.audio),
        profile,
        vocabulary,
        threads: os.cpus().length,
        revisionMode: resolveRevisionMode(payload, settings),
        revisionModel: payload?.revisionModel || settings.revisionModel,
        revisionTimeoutMs: settings.revisionTimeoutMs,
        ...resolvePersonalizationOptions(payload, settings),
        signal: runAbortController.signal,
        onProgress: (progress) => {
          if (!runAbortController.signal.aborted) {
            event.sender.send("transcription:progress", { ...progress, runId });
          }
        },
      });
      if (runAbortController.signal.aborted || this.wasRunCancelled(runId)) {
        throw abortError();
      }
      // The native paste helper cannot undo a Ctrl+V after delivery begins.
      // Escape stops capturing here, before any clipboard mutation starts.
      this.transcriptionDeliveryStarted = true;
      this.deliveryCommittedRunId = runId;
      this.syncEscapeShortcut();
      event.sender.send("transcription:progress", { stage: "delivering", runId });
      const insertion = shortcutTarget
        ? await this.clipboardService.insert(
            result.text,
            shortcutTarget,
            settings,
          )
        : (() => {
            this.clipboard.writeText(result.text);
            return {
              autoPasted: false,
              clipboardRestored: false,
              reason: "manual-recording",
            };
          })();
      if (ownsShortcutRun()) this.shortcutController.complete();
      const historyEntry = await this.historyStore
        ?.add({
          text: result.text,
          originalText: result.originalText !== result.text
            ? result.originalText
            : undefined,
          at: Date.now(),
        })
        .catch((error) =>
          this.logger.warn("transcription_history_save_failed", {
            reason: error?.name || "Error",
          }),
        );
      await this.logger.info("dictation_completed", {
        profile,
        elapsedMs: result.elapsedMs,
        durationSeconds: result.durationSeconds,
        autoPasted: insertion.autoPasted,
        clipboardRestored: insertion.clipboardRestored,
        fallbackReason: insertion.reason,
        revisionMode: result.revision.mode,
        revisionApplied: result.revision.applied,
        revisionFallback: result.revision.fallback,
        revisionReason: result.revision.reason,
        revisionElapsedMs: result.revision.elapsedMs,
        revisionPath: result.revision.path,
        writingProfile: result.personalization.writingProfile,
        replacementsApplied:
          result.personalization.replacementsApplied,
        snippetsExpanded: result.personalization.snippetsExpanded,
      });
      return {
        ...result,
        historyId: historyEntry?.id || null,
        copiedToClipboard: true,
        ...insertion,
      };
    } catch (error) {
      if (ownsShortcutRun()) this.shortcutController.fail();
      if (error?.name !== "AbortError") {
        await this.logger.error("dictation_failed", error);
      }
      throw error;
    } finally {
      if (this.activeTranscriptionAbortController === runAbortController) {
        this.activeTranscriptionAbortController = null;
        this.activeTranscriptionRunId = null;
        this.activeTranscriptionShortcutGeneration = null;
      }
      this.transcriptionRunning = false;
      if (this.activeTranscriptionSettled === thisRunSettled) {
        this.activeTranscriptionSettled = null;
      }
      settleThisRun();
      if (this.deliveryCommitOrphaned && this.deliveryCommittedRunId === runId) {
        this.transcriptionDeliveryStarted = false;
        this.deliveryCommittedRunId = null;
        this.deliveryCommitOrphaned = false;
      }
      this.syncEscapeShortcut();
    }
  }

  // Dictation UI states from the renderer. Meetings publish UI state too, but
  // only dictation states may arm Escape or feed the shortcut's recovery.
  onRendererState(payload) {
    this.dictationRendererState = payload?.state || "idle";
    const runId = normalizedRunId(payload?.runId);
    if (runId) this.dictationRendererRunId = runId;
    if (["idle", "success", "error"].includes(this.dictationRendererState)) {
      if (this.transcriptionDeliveryStarted &&
        (!this.deliveryCommittedRunId || runId === this.deliveryCommittedRunId)) {
        this.transcriptionDeliveryStarted = false;
        this.deliveryCommittedRunId = null;
      }
      this.dictationRendererRunId = null;
      this.escapeCancelPending = false;
    }
    // The dashboard renderer owns the real microphone state; feed it to the
    // controller so a desynced/stuck shortcut can heal itself on the next press.
    this.shortcutController?.notifyRendererState(this.dictationRendererState);
    this.syncEscapeShortcut();
  }

  onRendererEvent(payload) {
    const runId = normalizedRunId(payload?.runId);
    if (runId && this.dictationRendererRunId && runId !== this.dictationRendererRunId) {
      return;
    }
    if (["error", "cancelled", "completed"].includes(payload?.type)) {
      this.dictationRendererState = payload.type === "completed" ? "success" : "idle";
      this.dictationRendererRunId = null;
      this.escapeCancelPending = false;
      if (this.transcriptionDeliveryStarted &&
        (!this.deliveryCommittedRunId || runId === this.deliveryCommittedRunId)) {
        this.transcriptionDeliveryStarted = false;
        this.deliveryCommittedRunId = null;
      }
    }
    if (["error", "cancelled"].includes(payload?.type)) {
      this.shortcutController?.fail();
    }
    this.syncEscapeShortcut();
  }

  registerIpc(ipcMain) {
    ipcMain.handle("transcription:run", (event, payload) => this.run(event, payload));
    ipcMain.handle("transcription:cancel", (_event, runId) =>
      this.cancel("escape", runId),
    );
    ipcMain.on("dictation:event", (_event, payload) => this.onRendererEvent(payload));
  }
}

module.exports = { DictationSession, normalizedRunId, resolveRevisionMode };
