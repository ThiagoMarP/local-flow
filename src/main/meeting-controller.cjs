const os = require("node:os");
const path = require("node:path");
const { writeFile } = require("node:fs/promises");

// Meeting capture: the start/stop toggle, the chunk writes coming from the
// renderer (which owns microphone + system audio) and the background queue
// that transcribes and summarizes each finished meeting, one at a time, so the
// renderer never waits on whisper + Ollama.
class MeetingController {
  constructor({
    windowManager,
    settingsStore,
    logger,
    meetingService,
    meetingSummaryService,
    meetingStore,
    meetingCaptureStore,
    notify,
    applyUiState,
    getActiveProfile,
    isDictationBusy,
    isDictationRecording,
  }) {
    this.windowManager = windowManager;
    this.settingsStore = settingsStore;
    this.logger = logger;
    this.meetingService = meetingService;
    this.meetingSummaryService = meetingSummaryService;
    this.meetingStore = meetingStore;
    this.meetingCaptureStore = meetingCaptureStore;
    this.notify = notify;
    this.applyUiState = applyUiState;
    this.getActiveProfile = getActiveProfile;
    this.isDictationBusy = isDictationBusy;
    this.isDictationRecording = isDictationRecording;

    this.capturing = false;
    this.stopping = false;
    this.activeSessionId = null;
    this.latestMeetingId = null;
    this.chunkQueue = Promise.resolve();
    this.lastToggleAt = 0;
    this.queue = Promise.resolve();
  }

  // Dictation and meeting recording both need the microphone.
  blocksDictation() {
    return this.capturing || this.stopping || Boolean(this.activeSessionId);
  }

  // While a meeting records, dictation UI states must not repaint the capsule.
  ownsCapsule() {
    return this.capturing || this.stopping;
  }

  publishStatus(state, message, id, { current = true } = {}) {
    this.windowManager?.dashboardWindow?.webContents.send("meeting:status", {
      state,
      message,
      id,
      current,
    });
  }

  toggle(desiredAction) {
    const dashboard = this.windowManager?.dashboardWindow;
    // globalShortcut dispara repetidamente enquanto a tecla fica pressionada;
    // ignoramos repetições muito próximas para não criar um enxame de start/stop.
    if (!dashboard || dashboard.isDestroyed() || dashboard.webContents.isDestroyed()) {
      return { ok: false, reason: "A janela do Local Flow ainda não está pronta." };
    }
    const now = Date.now();
    if (now - this.lastToggleAt < 600) return { ok: false, reason: "Aguarde um instante." };
    if (this.stopping) return { ok: false, reason: "Aguarde a reunião terminar de salvar." };
    if (!this.capturing && this.activeSessionId) {
      return { ok: false, reason: "A reunião anterior ainda está sendo salva." };
    }
    if (desiredAction === "start" && this.capturing) {
      return { ok: false, reason: "A reunião já está gravando." };
    }
    if (desiredAction === "stop" && !this.capturing) {
      return { ok: false, reason: "Não há reunião em gravação." };
    }
    // Mutuamente exclusivo com a GRAVAÇÃO do ditado (os dois usam o microfone). O
    // ditado em processamento (transcrevendo) não bloqueia iniciar uma reunião.
    if (!this.capturing && this.isDictationRecording()) {
      this.lastToggleAt = now;
      this.notify("Ditado em andamento — finalize antes de gravar a reunião.");
      return { ok: false, reason: "Finalize o ditado antes de gravar a reunião." };
    }
    this.lastToggleAt = now;
    this.capturing = !this.capturing;
    const action = this.capturing ? "start" : "stop";
    if (action === "stop") this.stopping = true;
    console.log(`LOCAL_FLOW_MEETING_TOGGLE=${JSON.stringify({ action })}`);
    this.windowManager?.dashboardWindow?.webContents.send("meeting:command", {
      action,
    });
    return { ok: true, action };
  }

  // Background phase of a meeting capture: transcribe both channels, interleave,
  // summarize, persist transcript.txt/resumo.md, refresh meta.json and fire the
  // completion pulse. Runs off the IPC response so the renderer can record again
  // immediately.
  async process({ id, dir, chunkCount, micSeconds, systemSeconds, interrupted }) {
    let transcript = null;
    let turns = 0;
    let partial = false;
    let failures = [];
    try {
      const meeting = await this.meetingService.runFromChunkFiles({
        dir,
        chunkCount,
        profile: this.settingsStore.get().meetingProfile,
        threads: os.cpus().length,
        vocabulary: this.settingsStore.get().vocabulary,
      });
      transcript = meeting.transcript;
      turns = meeting.turns.length;
      partial = Boolean(meeting.partial);
      failures = meeting.failures || [];
      await writeFile(path.join(dir, "transcript.txt"), transcript, "utf8");
      console.log(
        `LOCAL_FLOW_MEETING_TRANSCRIBED=${JSON.stringify({
          dir,
          turns,
          chars: transcript.length,
          elapsedMs: meeting.elapsedMs,
        })}`,
      );
    } catch (error) {
      console.log(
        `LOCAL_FLOW_MEETING_TRANSCRIBE_FAILED=${JSON.stringify({
          reason: error?.message || "Error",
        })}`,
      );
      await this.logger.warn("meeting_transcribe_failed", {
        reason: error?.message || "Error",
      });
    }

    let summarized = false;
    if (transcript) {
      try {
        const summary = await this.meetingSummaryService.summarize(transcript, {
          model: this.settingsStore.get().meetingSummaryModel,
        });
        if (summary.applied) {
          summarized = true;
          await writeFile(path.join(dir, "resumo.md"), summary.markdown, "utf8");
          console.log(
            `LOCAL_FLOW_MEETING_SUMMARIZED=${JSON.stringify({
              dir,
              chars: summary.markdown.length,
              elapsedMs: summary.elapsedMs,
            })}`,
          );
        } else {
          console.log(
            `LOCAL_FLOW_MEETING_SUMMARY_SKIPPED=${JSON.stringify({
              reason: summary.reason,
            })}`,
          );
        }
      } catch (error) {
        await this.logger.warn("meeting_summary_failed", {
          reason: error?.message || "Error",
        });
      }
    }

    await this.meetingCaptureStore.finish(id, {
      state: transcript ? (partial ? "partial" : "done") : "failed",
      error: partial
        ? `${failures.length} trecho(s) não puderam ser transcritos.`
        : transcript ? null : "Não foi possível transcrever o áudio.",
      failures,
      turns,
      summarized,
    });
    await this.logger.info("meeting_capture_saved", {
      dir,
      micSeconds,
      systemSeconds,
      turns,
      summarized,
    });
    const message = transcript
      ? `${partial ? "Reunião transcrita parcialmente" : interrupted ? "Reunião interrompida recuperada" : "Reunião transcrita"} · ${turns} fala(s)${summarized ? " e resumo" : " (resumo indisponível)"}`
      : `Reunião salva, mas a transcrição falhou. Áudio preservado no disco.`;
    this.notify(message);
    const current = this.latestMeetingId === id;
    this.publishStatus(transcript ? (partial ? "partial" : "success") : "error", message, id, { current });
    // A reunião termina em segundo plano e pode coincidir com um ditado novo.
    // "processing" também é usado pelo ditado; seu resultado visual tem prioridade.
    if (current && !this.isDictationBusy() &&
      this.windowManager?.currentUiState?.state === "processing") {
      this.applyUiState({
        state: transcript && !partial ? "success" : "error",
        profile: this.getActiveProfile(),
        message: transcript
          ? partial ? "Transcrição parcial da reunião" : "Reunião transcrita"
          : "Falha na transcrição da reunião",
      });
    }
  }

  enqueue(capture) {
    const { id, dir, at, chunkCount, micSeconds, systemSeconds, interrupted } = capture;
    if (!chunkCount) return;
    this.latestMeetingId = id;
    this.publishStatus("processing", interrupted
      ? "Recuperando gravação interrompida…"
      : "Transcrevendo reunião em segundo plano…", id);
    this.queue = this.queue
      .then(() => this.process({ id, dir, at, chunkCount, micSeconds, systemSeconds, interrupted }))
      .catch(async (error) => {
        await this.meetingCaptureStore.finish(id, { state: "failed", error: "Não foi possível processar a reunião." }).catch(() => {});
        await this.logger.warn("meeting_process_failed", { reason: error?.message || "Error" });
        this.publishStatus("error", "Não foi possível processar a reunião; o áudio continua salvo no disco.", id,
          { current: this.latestMeetingId === id });
      });
  }

  async finalizeActive({ interrupted = false } = {}) {
    const id = this.activeSessionId;
    if (!id) return null;
    this.activeSessionId = null;
    this.capturing = false;
    await this.chunkQueue;
    const capture = await this.meetingCaptureStore.complete(id, { interrupted });
    if (capture.chunkCount) this.enqueue(capture);
    else this.publishStatus("error", "A reunião terminou antes de salvar áudio.", id);
    return { id, dir: capture.dir, chunkCount: capture.chunkCount,
      durationSeconds: capture.durationSeconds, interrupted: capture.interrupted };
  }

  // Captures left on disk by a crash are transcribed on the next launch.
  recoverPending() {
    return this.meetingCaptureStore.recoverPending().then((pending) => {
      for (const capture of pending.sort((a, b) => a.at - b.at)) {
        this.enqueue(capture);
      }
    }).catch((error) => this.logger.warn("meeting_recovery_failed", {
      reason: error?.message || "Error",
    }));
  }

  // A renderer can disappear while the permission prompt is still open,
  // before it has created a capture session. Release the shortcut toggle in
  // that case too, or the next press would try to stop a nonexistent meeting.
  handleRendererInterrupted() {
    const wasCapturing = this.capturing;
    this.capturing = false;
    this.stopping = false;
    if (!this.activeSessionId) {
      if (wasCapturing) {
        this.logger?.warn("meeting_renderer_interrupted_before_capture");
      }
      return;
    }
    this.finalizeActive({ interrupted: true }).catch((error) =>
      this.logger?.warn("meeting_renderer_interrupted", { reason: error?.message || "Error" }),
    );
  }

  onRendererEvent(payload) {
    console.log(`LOCAL_FLOW_MEETING_EVENT=${JSON.stringify(payload || {})}`);
    if (payload?.type === "started") {
      const stopKey = this.settingsStore.getPublic().meetingShortcutDisplay;
      let body;
      if (payload?.mode === "mic") {
        body = `Gravando só o seu microfone… ${stopKey} para parar.`;
      } else if (payload?.mode === "system") {
        body = `Gravando só o áudio do sistema… ${stopKey} para parar.`;
      } else if (payload?.hasSystemAudio) {
        body = `Gravando reunião… ${stopKey} para parar.`;
      } else {
        body = `Gravando, mas sem áudio do sistema (nada tocando?).`;
      }
      this.notify(body);
    } else if (payload?.type === "error") {
      // Mantém o toggle do main em sincronia: se a captura falhou ao iniciar, o
      // próximo atalho volta a ser "start".
      this.capturing = false;
      this.stopping = false;
      const message = String(payload?.message || "Não foi possível gravar a reunião.").slice(0, 160);
      this.notify(message);
      this.publishStatus("error", message, this.activeSessionId);
    }
  }

  registerIpc(ipcMain) {
    ipcMain.handle("meeting:toggle", (_event, desiredAction) => this.toggle(desiredAction));
    ipcMain.handle("meeting:capture-state", () => ({ capturing: this.capturing }));
    ipcMain.handle("meeting:capture-start", async (_event, payload) => {
      if (this.activeSessionId) throw new Error("Já existe uma reunião em gravação.");
      const capture = await this.meetingCaptureStore.start({ mode: payload?.mode });
      this.activeSessionId = capture.id;
      this.chunkQueue = Promise.resolve();
      return { id: capture.id };
    });
    ipcMain.handle("meeting:capture-chunk", (_event, payload) => {
      if (!payload?.id || payload.id !== this.activeSessionId) {
        throw new Error("Sessão de reunião não está ativa.");
      }
      const write = this.chunkQueue.then(() => this.meetingCaptureStore.append(payload));
      this.chunkQueue = write.catch(() => {});
      return write;
    });
    ipcMain.handle("meeting:capture-complete", async (_event, payload) => {
      if (!payload?.id || payload.id !== this.activeSessionId) {
        throw new Error("Sessão de reunião não está ativa.");
      }
      const saved = await this.finalizeActive({ interrupted: payload.interrupted });
      this.capturing = false;
      this.stopping = false;
      console.log(
        `LOCAL_FLOW_MEETING_SAVED=${JSON.stringify({
          dir: saved.dir,
          chunks: saved.chunkCount,
          seconds: saved.durationSeconds,
        })}`,
      );
      return saved;
    });
    ipcMain.handle("meetings:list", () => this.meetingStore.list());
    ipcMain.handle("meetings:get", (_event, id) => this.meetingStore.get(id));
    ipcMain.handle("meetings:remove", (_event, id) => this.meetingStore.remove(id));
    ipcMain.on("meeting:event", (_event, payload) => this.onRendererEvent(payload));
  }
}

module.exports = { MeetingController };
