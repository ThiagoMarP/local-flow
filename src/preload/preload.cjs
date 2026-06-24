const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("localFlow", {
  inspectRuntime: () => ipcRenderer.invoke("runtime:inspect"),
  transcribe: ({
    audio,
    profile,
    vocabulary,
    revisionMode,
    revisionModel,
  }) =>
    ipcRenderer.invoke("transcription:run", {
      audio,
      profile,
      vocabulary,
      revisionMode,
      revisionModel,
    }),
  onTranscriptionProgress: (listener) => {
    const handler = (_event, progress) => listener(progress);
    ipcRenderer.on("transcription:progress", handler);
    return () =>
      ipcRenderer.removeListener("transcription:progress", handler);
  },
  copyText: (text) => ipcRenderer.invoke("clipboard:write", text),
  reportSelfTest: (result) => ipcRenderer.invoke("selftest:report", result),
  updateUiState: (state) => ipcRenderer.send("ui:update-state", state),
  getUiState: () => ipcRenderer.invoke("ui:get-state"),
  onUiState: (listener) => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on("ui:state", handler);
    return () => ipcRenderer.removeListener("ui:state", handler);
  },
  onDictationCommand: (listener) => {
    const handler = (_event, command) => listener(command);
    ipcRenderer.on("dictation:command", handler);
    return () => ipcRenderer.removeListener("dictation:command", handler);
  },
  reportDictationEvent: (event) =>
    ipcRenderer.send("dictation:event", event),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  updateSettings: (patch) =>
    ipcRenderer.invoke("settings:update", patch),
  resetSettings: () => ipcRenderer.invoke("settings:reset"),
  showDashboard: () => ipcRenderer.invoke("app:show-dashboard"),
  hideDashboard: () => ipcRenderer.invoke("app:hide-dashboard"),
});
