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
});
