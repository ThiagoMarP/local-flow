const { mkdir, readFile, writeFile } = require("node:fs/promises");
const path = require("node:path");

class TestHarness {
  constructor({
    app,
    clipboard,
    clipboardService,
    projectRoot,
    transcriptionPipeline,
    windowManager,
    windowsBridge,
  }) {
    this.app = app;
    this.clipboard = clipboard;
    this.clipboardService = clipboardService;
    this.projectRoot = projectRoot;
    this.transcriptionPipeline = transcriptionPipeline;
    this.windowManager = windowManager;
    this.windowsBridge = windowsBridge;
  }

  async captureWindow(window, targetPath, signal) {
    try {
      const target = path.resolve(targetPath);
      await mkdir(path.dirname(target), { recursive: true });
      window.showInactive();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (process.env.LOCAL_FLOW_SETTINGS_PREVIEW === "1") {
        await window.webContents.executeJavaScript(
          "document.querySelector('.advanced-panel')?.scrollIntoView({block:'start'})",
        );
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      const image = await window.webContents.capturePage();
      await writeFile(target, image.toPNG());
      console.log(`${signal}=${target}`);
      this.app.quit();
    } catch (error) {
      console.error(`${signal}_ERROR=${error.stack || error.message}`);
      this.app.exit(1);
    }
  }

  async runEndToEnd(audioPath) {
    return runEndToEndTest({
      app: this.app,
      audioPath,
      clipboard: this.clipboard,
      transcriptionPipeline: this.transcriptionPipeline,
      mode: process.env.LOCAL_FLOW_E2E_REVISION_MODE,
      model: process.env.LOCAL_FLOW_E2E_REVISION_MODEL,
    });
  }

  async runInsertion() {
    try {
      const delayMs = Number(
        process.env.LOCAL_FLOW_INSERTION_TEST_DELAY_MS || 0,
      );
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      const target = await this.windowsBridge.findByTitle(
        process.env.LOCAL_FLOW_INSERTION_TEST_TITLE,
      );
      if (!target) {
        throw new Error(
          "A janela de teste de inserção não foi encontrada.",
        );
      }
      this.clipboard.writeText("LOCAL_FLOW_CLIPBOARD_ORIGINAL");
      const dictationTarget = {
        ...target,
        isSelf: false,
        clipboard: this.clipboardService.snapshotText(),
      };
      const wavBuffer = await readFile(
        path.resolve(process.env.LOCAL_FLOW_INSERTION_TEST_AUDIO),
      );
      const result = await this.transcriptionPipeline.run({
        wavBuffer,
        profile: "fast",
        vocabulary: ["Electron", "TypeScript", "Whisper", "Ollama"],
        threads: 24,
        revisionMode: "literal",
      });
      const insertion = await this.clipboardService.insert(
        result.text,
        dictationTarget,
        { autoPaste: true, restoreClipboard: true },
      );
      if (!insertion.autoPasted) {
        throw new Error(
          `A inserção falhou: ${insertion.reason} ${JSON.stringify(insertion.diagnostics)}`,
        );
      }
      if (
        this.clipboard.readText() !== "LOCAL_FLOW_CLIPBOARD_ORIGINAL"
      ) {
        throw new Error("O clipboard textual não foi restaurado.");
      }
      console.log(
        `LOCAL_FLOW_INSERTION_OK=${JSON.stringify({
          text: result.text,
          ...insertion,
        })}`,
      );
      this.app.quit();
    } catch (error) {
      console.error(
        `LOCAL_FLOW_INSERTION_ERROR=${error.stack || error.message}`,
      );
      this.app.exit(1);
    }
  }

  async runLifecycle() {
    try {
      const { dashboardWindow, capsuleWindow, tray } = this.windowManager;
      dashboardWindow.close();
      await new Promise((resolve) => setTimeout(resolve, 300));
      const hiddenButAlive =
        !dashboardWindow.isDestroyed() && !dashboardWindow.isVisible();
      const capsuleDoesNotFocus =
        typeof capsuleWindow.isFocusable !== "function" ||
        capsuleWindow.isFocusable() === false;
      this.windowManager.showDashboard();
      await new Promise((resolve) => setTimeout(resolve, 300));
      const reopened = dashboardWindow.isVisible();
      if (
        !tray ||
        !hiddenButAlive ||
        !reopened ||
        !capsuleDoesNotFocus
      ) {
        throw new Error(
          JSON.stringify({
            tray: Boolean(tray),
            hiddenButAlive,
            reopened,
            capsuleDoesNotFocus,
          }),
        );
      }
      console.log(
        `LOCAL_FLOW_LIFECYCLE_OK=${JSON.stringify({
          hiddenButAlive,
          reopened,
          capsuleDoesNotFocus,
        })}`,
      );
      this.windowManager.beginQuit();
      this.app.quit();
    } catch (error) {
      console.error(
        `LOCAL_FLOW_LIFECYCLE_ERROR=${error.stack || error.message}`,
      );
      this.app.exit(1);
    }
  }

  async onDashboardReady(window) {
    console.log("LOCAL_FLOW_READY");
    if (process.env.LOCAL_FLOW_SMOKE_TEST === "1") {
      setTimeout(() => this.app.quit(), 500);
      return;
    }
    if (process.env.LOCAL_FLOW_CAPTURE_PATH) {
      await this.captureWindow(
        window,
        process.env.LOCAL_FLOW_CAPTURE_PATH,
        "LOCAL_FLOW_CAPTURED",
      );
      return;
    }
    if (process.env.LOCAL_FLOW_E2E_AUDIO) {
      await this.runEndToEnd(process.env.LOCAL_FLOW_E2E_AUDIO);
      return;
    }
    if (process.env.LOCAL_FLOW_INSERTION_TEST_AUDIO) {
      await this.runInsertion();
      return;
    }
    if (process.env.LOCAL_FLOW_LIFECYCLE_TEST === "1") {
      setTimeout(() => this.runLifecycle(), 800);
    }
  }

  async onCapsuleReady(window, applyUiState) {
    console.log("LOCAL_FLOW_CAPSULE_READY");
    if (!process.env.LOCAL_FLOW_CAPTURE_CAPSULE_PATH) return;
    const state = process.env.LOCAL_FLOW_CAPSULE_STATE || "recording";
    applyUiState(
      {
        state,
        message:
          {
            recording: "Ouvindo…",
            processing: "Transcrevendo…",
            success: "Texto copiado",
            error: "Não foi possível transcrever",
          }[state] || "Local Flow",
        profile: "standard",
        elapsedMs: state === "recording" ? 8400 : 0,
        level: 0.72,
      },
      { autoHide: false },
    );
    await this.captureWindow(
      window,
      process.env.LOCAL_FLOW_CAPTURE_CAPSULE_PATH,
      "LOCAL_FLOW_CAPSULE_CAPTURED",
    );
  }
}

async function runRevisionTest({
  app,
  audioPath,
  transcriptionPipeline,
  mode = "smart",
  model = "qwen2.5:3b",
}) {
  try {
    const wavBuffer = await readFile(path.resolve(audioPath));
    const result = await transcriptionPipeline.run({
      wavBuffer,
      profile: "fast",
      vocabulary: ["Electron", "TypeScript", "Whisper", "Ollama"],
      revisionMode: mode,
      revisionModel: model,
      threads: 24,
    });
    console.log(`LOCAL_FLOW_REVISION_OK=${JSON.stringify(result)}`);
    app.quit();
  } catch (error) {
    console.error(
      `LOCAL_FLOW_REVISION_ERROR=${error.stack || error.message}`,
    );
    app.exit(1);
  }
}

async function runEndToEndTest({
  app,
  audioPath,
  clipboard,
  transcriptionPipeline,
  mode = "literal",
  model = "qwen2.5:3b",
}) {
  try {
    const wavBuffer = await readFile(path.resolve(audioPath));
    const result = await transcriptionPipeline.run({
      wavBuffer,
      profile: "fast",
      vocabulary: ["Electron", "TypeScript", "Whisper", "Ollama"],
      threads: 24,
      revisionMode: mode,
      revisionModel: model,
    });
    clipboard.writeText(result.text);
    if (clipboard.readText() !== result.text) {
      throw new Error("O clipboard não preservou o texto transcrito.");
    }
    console.log(`LOCAL_FLOW_E2E_OK=${JSON.stringify(result)}`);
    app.quit();
  } catch (error) {
    console.error(`LOCAL_FLOW_E2E_ERROR=${error.stack || error.message}`);
    app.exit(1);
  }
}

module.exports = { TestHarness, runEndToEndTest, runRevisionTest };
