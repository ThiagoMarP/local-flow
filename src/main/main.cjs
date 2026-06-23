const { app, BrowserWindow, clipboard, ipcMain, session } = require("electron");
const { mkdir, readFile, writeFile } = require("node:fs/promises");
const path = require("node:path");
const {
  inspectRuntime,
  transcribeWav,
} = require("./whisper-service.cjs");

const projectRoot = path.resolve(__dirname, "..", "..");
let mainWindow;
let transcriptionRunning = false;

if (process.env.LOCAL_FLOW_USER_DATA) {
  app.setPath("userData", path.resolve(process.env.LOCAL_FLOW_USER_DATA));
}

function createWindow() {
  const automatedRun =
    process.env.LOCAL_FLOW_SMOKE_TEST === "1" ||
    Boolean(process.env.LOCAL_FLOW_CAPTURE_PATH) ||
    Boolean(process.env.LOCAL_FLOW_E2E_AUDIO) ||
    process.env.LOCAL_FLOW_MIC_SELF_TEST === "1";
  mainWindow = new BrowserWindow({
    width: 820,
    height: 720,
    minWidth: 680,
    minHeight: 600,
    backgroundColor: "#0b0d12",
    title: "Local Flow",
    show:
      !automatedRun || Boolean(process.env.LOCAL_FLOW_CAPTURE_PATH),
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.removeMenu();
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file://")) {
      event.preventDefault();
    }
  });
  const query =
    process.env.LOCAL_FLOW_MIC_SELF_TEST === "1"
      ? { selfTest: "microphone" }
      : undefined;
  mainWindow.loadFile(
    path.join(__dirname, "..", "renderer", "index.html"),
    query ? { query } : undefined,
  );

  mainWindow.webContents.once("did-finish-load", async () => {
    console.log("LOCAL_FLOW_READY");
    if (process.env.LOCAL_FLOW_SMOKE_TEST === "1") {
      setTimeout(() => app.quit(), 500);
      return;
    }
    if (process.env.LOCAL_FLOW_CAPTURE_PATH) {
      try {
        const target = path.resolve(process.env.LOCAL_FLOW_CAPTURE_PATH);
        await mkdir(path.dirname(target), { recursive: true });
        mainWindow.show();
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const image = await mainWindow.webContents.capturePage();
        await writeFile(target, image.toPNG());
        console.log(`LOCAL_FLOW_CAPTURED=${target}`);
        app.quit();
      } catch (error) {
        console.error(
          `LOCAL_FLOW_CAPTURE_ERROR=${error.stack || error.message}`,
        );
        app.exit(1);
      }
      return;
    }
    if (process.env.LOCAL_FLOW_E2E_AUDIO) {
      try {
        const wavBuffer = await readFile(
          path.resolve(process.env.LOCAL_FLOW_E2E_AUDIO),
        );
        const result = await transcribeWav({
          projectRoot,
          wavBuffer,
          profile: "fast",
          vocabulary: ["Electron", "TypeScript", "Whisper", "Ollama"],
          threads: 24,
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
  });
}

function configureMicrophonePermission() {
  session.defaultSession.setPermissionCheckHandler(
    (webContents, permission, requestingOrigin, details) => {
      const requestsAudio =
        !details?.mediaType ||
        details.mediaType === "audio" ||
        details.mediaType === "unknown";
      return (
        webContents === mainWindow?.webContents &&
        permission === "media" &&
        requestingOrigin.startsWith("file://") &&
        details?.isMainFrame !== false &&
        requestsAudio
      );
    },
  );
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      const mediaTypes = details?.mediaTypes;
      const requestsAudio =
        !mediaTypes ||
        mediaTypes.length === 0 ||
        mediaTypes.includes("audio");
      const trustedPage =
        webContents === mainWindow?.webContents &&
        details?.isMainFrame !== false &&
        String(details?.requestingUrl || "").startsWith("file://");
      callback(permission === "media" && requestsAudio && trustedPage);
    },
  );
}

app.whenReady().then(() => {
  configureMicrophonePermission();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  app.quit();
});

ipcMain.handle("runtime:inspect", async () => {
  return inspectRuntime(projectRoot);
});

ipcMain.handle("transcription:run", async (_event, payload) => {
  if (transcriptionRunning) {
    throw new Error("Já existe uma transcrição em andamento.");
  }
  transcriptionRunning = true;

  try {
    const audio = Buffer.from(payload.audio);
    const result = await transcribeWav({
      projectRoot,
      wavBuffer: audio,
      profile: payload.profile,
      vocabulary: payload.vocabulary,
      threads: 24,
    });
    clipboard.writeText(result.text);
    return {
      ...result,
      copiedToClipboard: true,
    };
  } finally {
    transcriptionRunning = false;
  }
});

ipcMain.handle("clipboard:write", (_event, text) => {
  clipboard.writeText(String(text));
  return true;
});

ipcMain.handle("selftest:report", (_event, result) => {
  if (process.env.LOCAL_FLOW_MIC_SELF_TEST !== "1") {
    throw new Error("O autoteste do microfone não está habilitado.");
  }
  console.log(`LOCAL_FLOW_MIC_OK=${JSON.stringify(result)}`);
  setTimeout(() => app.quit(), 100);
  return true;
});
