const { app, BrowserWindow, clipboard, ipcMain, session } = require("electron");
const path = require("node:path");
const {
  inspectRuntime,
  transcribeWav,
} = require("./whisper-service.cjs");

const projectRoot = path.resolve(__dirname, "..", "..");
let mainWindow;
let transcriptionRunning = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 820,
    height: 720,
    minWidth: 680,
    minHeight: 600,
    backgroundColor: "#0b0d12",
    title: "Local Flow",
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
  mainWindow.loadFile(
    path.join(__dirname, "..", "renderer", "index.html"),
  );

  mainWindow.webContents.once("did-finish-load", () => {
    console.log("LOCAL_FLOW_READY");
    if (process.env.LOCAL_FLOW_SMOKE_TEST === "1") {
      setTimeout(() => app.quit(), 500);
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
