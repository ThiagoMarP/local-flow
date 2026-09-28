// Phase 8 setup wiring kept out of the entry point: the headless model/engine
// self-test used by the installer test, plus the IPC surface that powers the
// first-run wizard.

async function runSetupSelfTest({
  app,
  projectRoot,
  appPaths,
  modelInstaller,
  inspectRuntime,
}) {
  if (process.env.LOCAL_FLOW_SETUP_TEST !== "1") return false;
  const [runtime, models] = await Promise.all([
    inspectRuntime(projectRoot, {
      whisperCli: appPaths.whisperCli,
      parakeetCli: appPaths.parakeetCli,
      modelsDir: appPaths.modelsDir,
    }),
    modelInstaller.status(),
  ]);
  if (models.parakeet) {
    models.parakeet.available &&= runtime.parakeetAvailable;
  }
  console.log(
    `LOCAL_FLOW_SETUP_OK=${JSON.stringify({
      packaged: appPaths.packaged,
      whisperAvailable: runtime.whisperAvailable,
      parakeetAvailable: runtime.parakeetAvailable,
      modelsDir: appPaths.modelsDir,
      models: Object.fromEntries(
        Object.entries(models).map(([key, value]) => [
          key,
          value.available,
        ]),
      ),
    })}`,
  );
  app.quit();
  return true;
}

function registerSetupIpc({
  ipcMain,
  projectRoot,
  appPaths,
  modelInstaller,
  inspectRuntime,
  revisionService,
  logger,
  getActiveProfile,
}) {
  ipcMain.handle("setup:status", async () => {
    const [runtime, models, revision] = await Promise.all([
      inspectRuntime(projectRoot, {
        whisperCli: appPaths.whisperCli,
        parakeetCli: appPaths.parakeetCli,
        modelsDir: appPaths.modelsDir,
      }),
      modelInstaller.status(),
      revisionService.inspect(),
    ]);
    if (models.parakeet) {
      models.parakeet.available &&= runtime.parakeetAvailable;
    }
    return {
      packaged: appPaths.packaged,
      modelsDir: appPaths.modelsDir,
      whisperAvailable: runtime.whisperAvailable,
      parakeetAvailable: runtime.parakeetAvailable,
      activeProfile: getActiveProfile(),
      models,
      ollama: {
        available: revision.available,
        models: revision.models,
        defaultModel: revision.defaultModel,
      },
    };
  });

  ipcMain.handle("setup:download", async (event, profile) => {
    try {
      const result = await modelInstaller.download(profile, {
        onProgress: (progress) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send("setup:progress", progress);
          }
        },
      });
      await logger.info("model_downloaded", {
        profile: result.profile,
        bytes: result.bytes,
      });
      return result;
    } catch (error) {
      await logger.error("model_download_failed", error, { profile });
      throw error;
    }
  });

  ipcMain.handle("setup:cancel", (_event, profile) =>
    modelInstaller.cancel(profile),
  );
}

module.exports = { runSetupSelfTest, registerSetupIpc };
