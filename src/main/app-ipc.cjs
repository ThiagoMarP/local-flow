// IPC for the dashboard that is not dictation or meetings: runtime status,
// history, settings, clipboard and window visibility.
function registerAppIpc({
  ipcMain,
  app,
  clipboard,
  projectRoot,
  appPaths,
  inspectRuntime,
  revisionService,
  settingsStore,
  historyStore,
  loginItemService,
  canManageLoginItem,
  windowManager,
  shortcuts,
  logger,
  getHotkeyTrigger,
  applyUiState,
  getActiveProfile,
  setActiveProfile,
}) {
  ipcMain.handle("runtime:inspect", async () => {
    const [runtime, revision] = await Promise.all([
      inspectRuntime(projectRoot, {
        whisperCli: appPaths.whisperCli,
        parakeetCli: appPaths.parakeetCli,
        modelsDir: appPaths.modelsDir,
      }),
      revisionService.inspect(),
    ]);
    return {
      ...runtime,
      revision,
      shortcut: shortcuts.status(),
      hotkey: {
        enabled: settingsStore.get().nativeHotkey,
        ready: Boolean(getHotkeyTrigger()?.listener.ready),
        display: "Ctrl + Win",
      },
      settings: settingsStore.getPublic(),
      loginItem: canManageLoginItem ? loginItemService.get() : null,
    };
  });

  ipcMain.handle("clipboard:write", (_event, text) => {
    clipboard.writeText(String(text));
    return true;
  });

  ipcMain.handle("history:getLast", () =>
    historyStore ? historyStore.last() : null,
  );
  ipcMain.handle("history:list", () =>
    historyStore ? historyStore.list() : [],
  );
  ipcMain.handle("history:saveCorrection", (_event, id, text) =>
    historyStore
      ? historyStore.saveCorrection(String(id), text)
      : Promise.reject(new Error("Histórico indisponível.")),
  );
  ipcMain.handle("history:remove", (_event, id) =>
    historyStore ? historyStore.remove(String(id)) : [],
  );
  ipcMain.handle("history:clear", () =>
    historyStore ? historyStore.clear() : false,
  );

  ipcMain.handle("settings:get", () => settingsStore.getPublic());
  ipcMain.handle("settings:update", async (_event, patch) => {
    const previous = settingsStore.get();
    const desiredShortcut = patch?.shortcut || previous.shortcut;
    if (
      desiredShortcut !== previous.shortcut &&
      !shortcuts.update(desiredShortcut)
    ) {
      throw new Error(`${shortcuts.format(desiredShortcut)} já está em uso.`);
    }
    const desiredRepaste = patch?.repasteShortcut || previous.repasteShortcut;
    if (
      desiredRepaste !== previous.repasteShortcut &&
      !shortcuts.updateRepaste(desiredRepaste)
    ) {
      if (desiredShortcut !== previous.shortcut) {
        shortcuts.update(previous.shortcut);
      }
      throw new Error(`${shortcuts.formatRepaste(desiredRepaste)} já está em uso.`);
    }
    try {
      const next = await settingsStore.update(patch || {});
      if (next.meetingShortcut !== previous.meetingShortcut) {
        shortcuts.replaceMeeting(next.meetingShortcut);
      }
      setActiveProfile(next.profile);
      if (next.launchAtLogin !== previous.launchAtLogin && canManageLoginItem) {
        loginItemService.apply(next.launchAtLogin);
      }
      windowManager.setProfile(getActiveProfile());
      windowManager.setRevisionMode(next.revisionMode);
      applyUiState({
        ...windowManager.currentUiState,
        profile: getActiveProfile(),
      });
      await logger.info("settings_updated", {
        changedKeys: Object.keys(patch || {}),
      });
      return settingsStore.getPublic();
    } catch (error) {
      if (desiredShortcut !== previous.shortcut) {
        shortcuts.update(previous.shortcut);
      }
      if (desiredRepaste !== previous.repasteShortcut) {
        shortcuts.updateRepaste(previous.repasteShortcut);
      }
      throw error;
    }
  });

  ipcMain.handle("settings:reset", async () => {
    const previous = settingsStore.get();
    const defaults = await settingsStore.reset();
    shortcuts.update(defaults.shortcut);
    shortcuts.updateRepaste(defaults.repasteShortcut);
    setActiveProfile(defaults.profile);
    windowManager.setProfile(getActiveProfile());
    windowManager.setRevisionMode(defaults.revisionMode);
    if (previous.launchAtLogin && canManageLoginItem) {
      loginItemService.apply(false);
    }
    return settingsStore.getPublic();
  });

  ipcMain.handle("selftest:report", (_event, result) => {
    if (process.env.LOCAL_FLOW_MIC_SELF_TEST !== "1") {
      throw new Error("O autoteste do microfone não está habilitado.");
    }
    console.log(`LOCAL_FLOW_MIC_OK=${JSON.stringify(result)}`);
    setTimeout(() => app.quit(), 100);
    return true;
  });

  ipcMain.handle("ui:get-state", () => windowManager.currentUiState);
  ipcMain.handle("capsule:action", (_event, action) => {
    const message = windowManager.currentUiState.message;
    windowManager.dismissCapsule();
    // Clicking an error opens the page that shows its full message.
    if (action === "open") {
      windowManager.openDashboardPage(/reunião/i.test(message) ? "meetings" : "home");
    }
    logger.info("capsule_dismissed", {
      action: ["discard", "open"].includes(action) ? action : "confirm",
    });
    return true;
  });
  ipcMain.on("capsule:hover", (_event, hovering) => {
    windowManager.setCapsuleHover(hovering === true);
  });
  ipcMain.handle("app:show-dashboard", () => {
    windowManager.showDashboard();
    return true;
  });
  ipcMain.handle("app:hide-dashboard", () => {
    windowManager.hideDashboard();
    return true;
  });
}

module.exports = { registerAppIpc };
