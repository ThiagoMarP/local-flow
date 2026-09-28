const path = require("node:path");

// Resolve the directories the runtime needs in both development and packaged
// builds. The distinction matters because electron-builder packs the app source
// into an asar archive, from which native binaries and PowerShell helpers cannot
// be executed. Those ship as extraResources under process.resourcesPath instead.
//
// Models are large (more than 1 GB combined) and are downloaded on first run by
// the setup wizard, so they live in a writable directory rather than inside the
// read-only install location.
function resolveAppPaths({ app, projectRoot, env = process.env } = {}) {
  if (!projectRoot) {
    throw new Error("projectRoot é obrigatório.");
  }
  const packaged = Boolean(app && app.isPackaged);
  const resourcesRoot = packaged ? process.resourcesPath : projectRoot;
  const whisperDir = path.join(resourcesRoot, "native", "whisper");
  const parakeetDir = path.join(resourcesRoot, "native", "parakeet");
  const nativeWindowsDir = path.join(resourcesRoot, "native", "windows");

  let modelsDir;
  if (env.LOCAL_FLOW_MODELS_DIR) {
    modelsDir = path.resolve(env.LOCAL_FLOW_MODELS_DIR);
  } else if (packaged && app) {
    modelsDir = path.join(app.getPath("userData"), "models");
  } else {
    modelsDir = path.join(projectRoot, "models");
  }

  return {
    packaged,
    resourcesRoot,
    whisperDir,
    whisperCli: path.join(whisperDir, "whisper-cli.exe"),
    parakeetDir,
    parakeetCli: path.join(parakeetDir, "bin", "nemo-speech.exe"),
    nativeWindowsDir,
    foregroundHelper: path.join(nativeWindowsDir, "foreground-helper.ps1"),
    hotkeyListener: path.join(nativeWindowsDir, "hotkey-listener.ps1"),
    modelsDir,
  };
}

module.exports = { resolveAppPaths };
