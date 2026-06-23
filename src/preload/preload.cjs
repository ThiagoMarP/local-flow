const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("localFlow", {
  inspectRuntime: () => ipcRenderer.invoke("runtime:inspect"),
  transcribe: ({ audio, profile, vocabulary }) =>
    ipcRenderer.invoke("transcription:run", {
      audio,
      profile,
      vocabulary,
    }),
  copyText: (text) => ipcRenderer.invoke("clipboard:write", text),
  reportSelfTest: (result) => ipcRenderer.invoke("selftest:report", result),
  updateUiState: (state) => ipcRenderer.send("ui:update-state", state),
  getUiState: () => ipcRenderer.invoke("ui:get-state"),
  onUiState: (listener) => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on("ui:state", handler);
    return () => ipcRenderer.removeListener("ui:state", handler);
  },
  showDashboard: () => ipcRenderer.invoke("app:show-dashboard"),
  hideDashboard: () => ipcRenderer.invoke("app:hide-dashboard"),
});
