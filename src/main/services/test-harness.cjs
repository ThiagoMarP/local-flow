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
      // "page" or "page#sectionId": opens a dashboard page, optionally
      // scrolled to one section.
      if (process.env.LOCAL_FLOW_CAPTURE_PAGE) {
        const [page, section = ""] = process.env.LOCAL_FLOW_CAPTURE_PAGE.split("#");
        await window.webContents.executeJavaScript(
          `document.querySelector('.nav-item[data-page="${page.replace(/[^a-z]/g, "")}"]')?.click();` +
            `document.getElementById("${section.replace(/[^A-Za-z]/g, "")}")?.scrollIntoView({ block: "start" });`,
        );
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      if (process.env.LOCAL_FLOW_SETTINGS_PREVIEW === "1") {
        await window.webContents.executeJavaScript(
          "new Promise((resolve) => { const tick = () => { if (document.querySelector('#revisionModeTrigger')) resolve(); else setTimeout(tick, 50); }; tick(); }).then(() => { document.querySelector('[data-page=\"settings\"].nav-item')?.click(); document.querySelector('#revisionModeTrigger')?.scrollIntoView({block:'center'}); })",
        );
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      if (process.env.LOCAL_FLOW_REVISION_MENU_PREVIEW === "1") {
        await window.webContents.executeJavaScript(
          "document.querySelector('#revisionModeTrigger')?.click()",
        );
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      if (process.env.LOCAL_FLOW_SHORTCUT_MENU_PREVIEW === "1") {
        await window.webContents.executeJavaScript(
          "document.querySelector('#shortcutSelectTrigger')?.scrollIntoView({block:'center'})",
        );
        await new Promise((resolve) => setTimeout(resolve, 200));
        await window.webContents.executeJavaScript(
          "document.querySelector('#shortcutSelectTrigger')?.click()",
        );
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      if (process.env.LOCAL_FLOW_PERSONALIZATION_PREVIEW === "1") {
        await window.webContents.executeJavaScript(
          "document.querySelector('.personalization-panel')?.scrollIntoView({block:'start'})",
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
      if (process.env.LOCAL_FLOW_INSERTION_TEST_MENU_TRIGGER_PATH) {
        await writeFile(
          process.env.LOCAL_FLOW_INSERTION_TEST_MENU_TRIGGER_PATH,
          "menu",
        );
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
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
      if (this.clipboard.readText() !== result.text) {
        throw new Error("O clipboard não preservou a transcrição para Ctrl+V.");
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
    if (process.env.LOCAL_FLOW_SELECT_TEST === "1") {
      await new Promise((resolve) => setTimeout(resolve, 1600));
      const result = await window.webContents.executeJavaScript(`
        (async () => {
          document.querySelector('[data-page="settings"].nav-item').click();
          document.querySelector('#revisionModeTrigger').click();
          document.querySelector('#revisionModeSelectOption1').click();
          document.querySelector('#shortcutSelectTrigger').click();
          document.querySelector('#shortcutSelectOption1').click();
          await new Promise((resolve) => setTimeout(resolve, 700));
          const saved = await window.localFlow.getSettings();
          return {
            mode: saved.revisionMode,
            shortcut: saved.shortcut,
            modeLabel: document.querySelector('#revisionModeSelectValue').textContent,
            shortcutLabel: document.querySelector('#shortcutSelectValue').textContent,
            modelDisabled: document.querySelector('#revisionModelSelect').disabled,
          };
        })()
      `);
      console.log(`LOCAL_FLOW_SELECT_TEST=${JSON.stringify(result)}`);
      this.app.quit();
      return;
    }
    if (process.env.LOCAL_FLOW_OPEN_REVISION_SETTINGS === "1") {
      await new Promise((resolve) => setTimeout(resolve, 700));
      await window.webContents.executeJavaScript(
        "document.querySelector('[data-page=\"settings\"].nav-item')?.click(); document.querySelector('#revisionModeTrigger')?.scrollIntoView({block:'center'}); document.querySelector('#revisionModeTrigger')?.click()",
      );
      window.show();
      return;
    }
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
    // The dashboard publishes its own "ready" state once it boots; let it
    // settle first so it does not overwrite the state being captured.
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const requested = process.env.LOCAL_FLOW_CAPSULE_STATE || "recording";
    // "copied" is the success state whose text waits for a manual Ctrl+V.
    const state = requested === "copied" ? "success" : requested;
    applyUiState(
      {
        state,
        message:
          process.env.LOCAL_FLOW_CAPSULE_MESSAGE ||
          {
            recording: "Ouvindo…",
            processing: "Transcrevendo…",
            success: "Texto copiado",
            error: "Não foi possível acessar o microfone: Nenhum microfone foi encontrado pelo Windows.",
          }[state] || "Local Flow",
        profile: "standard",
        elapsedMs: state === "recording" ? 8400 : 0,
        level: 0.72,
        manualPaste: requested === "copied",
        hint: process.env.LOCAL_FLOW_CAPSULE_HINT || null,
        remainingMs: 7000,
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
  profile = "fast",
  mode = "smart",
  model = "qwen2.5:3b",
  writingProfile = "neutral",
}) {
  try {
    const wavBuffer = await readFile(path.resolve(audioPath));
    const result = await transcriptionPipeline.run({
      wavBuffer,
      profile,
      vocabulary: ["Electron", "TypeScript", "Whisper", "Ollama"],
      revisionMode: mode,
      revisionModel: model,
      writingProfile,
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
  profile = "fast",
  mode = "literal",
  model = "qwen2.5:3b",
}) {
  try {
    const wavBuffer = await readFile(path.resolve(audioPath));
    const result = await transcriptionPipeline.run({
      wavBuffer,
      profile,
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

async function runPersonalizationTest({
  app,
  audioPath,
  transcriptionPipeline,
}) {
  try {
    const wavBuffer = await readFile(path.resolve(audioPath));
    const result = await transcriptionPipeline.run({
      wavBuffer,
      profile: "fast",
      vocabulary: ["Electron", "TypeScript", "Whisper", "Ollama"],
      revisionMode: "literal",
      replacements: [{ from: "marcar", to: "agendar" }],
      snippets: [
        {
          trigger: "a apresentação.",
          expansion:
            "a apresentação.\n\nAtenciosamente,\nMarcos",
        },
      ],
      writingProfile: "professional",
      threads: 24,
    });
    console.log(
      `LOCAL_FLOW_PERSONALIZATION_OK=${JSON.stringify(result)}`,
    );
    app.quit();
  } catch (error) {
    console.error(
      `LOCAL_FLOW_PERSONALIZATION_ERROR=${error.stack || error.message}`,
    );
    app.exit(1);
  }
}

async function runHeadlessPipelineTest({
  app,
  clipboard,
  env,
  transcriptionPipeline,
}) {
  if (env.LOCAL_FLOW_E2E_AUDIO) {
    await runEndToEndTest({
      app,
      clipboard,
      audioPath: env.LOCAL_FLOW_E2E_AUDIO,
      transcriptionPipeline,
      profile: env.LOCAL_FLOW_E2E_PROFILE || "fast",
    });
    return true;
  }
  if (env.LOCAL_FLOW_REVISION_TEST_AUDIO) {
    await runRevisionTest({
      app,
      audioPath: env.LOCAL_FLOW_REVISION_TEST_AUDIO,
      transcriptionPipeline,
      profile: env.LOCAL_FLOW_E2E_PROFILE || "fast",
      mode: env.LOCAL_FLOW_E2E_REVISION_MODE,
      model: env.LOCAL_FLOW_E2E_REVISION_MODEL,
      writingProfile: env.LOCAL_FLOW_E2E_WRITING_PROFILE,
    });
    return true;
  }
  if (env.LOCAL_FLOW_PERSONALIZATION_TEST_AUDIO) {
    await runPersonalizationTest({
      app,
      audioPath: env.LOCAL_FLOW_PERSONALIZATION_TEST_AUDIO,
      transcriptionPipeline,
    });
    return true;
  }
  return false;
}

// Intercepts the global-shortcut test triggers so the production handler stays
// focused on real dictation. Returns true when a test mode handled the press.
function handleShortcutTestTrigger({ env = process.env, app, accelerator }) {
  if (env.LOCAL_FLOW_SHORTCUT_INPUT_TEST_FILE) {
    const target = path.resolve(env.LOCAL_FLOW_SHORTCUT_INPUT_TEST_FILE);
    mkdir(path.dirname(target), { recursive: true })
      .then(() =>
        writeFile(
          target,
          JSON.stringify({
            triggeredAt: new Date().toISOString(),
            accelerator,
          }),
        ),
      )
      .then(() => {
        console.log("LOCAL_FLOW_SHORTCUT_INPUT_TRIGGERED");
        app.quit();
      })
      .catch((error) => {
        console.error(
          `LOCAL_FLOW_SHORTCUT_INPUT_ERROR=${error.stack || error.message}`,
        );
        app.exit(1);
      });
    return true;
  }
  if (env.LOCAL_FLOW_SHORTCUT_TEST === "1") {
    console.log("LOCAL_FLOW_SHORTCUT_TRIGGERED");
    setTimeout(() => app.quit(), 100);
    return true;
  }
  return false;
}

module.exports = {
  TestHarness,
  handleShortcutTestTrigger,
  runEndToEndTest,
  runHeadlessPipelineTest,
  runPersonalizationTest,
  runRevisionTest,
};
