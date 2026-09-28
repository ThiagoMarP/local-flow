const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("localFlow", {
  inspectRuntime: () => ipcRenderer.invoke("runtime:inspect"),
  getSetupStatus: () => ipcRenderer.invoke("setup:status"),
  downloadModel: (profile) => ipcRenderer.invoke("setup:download", profile),
  cancelModelDownload: (profile) =>
    ipcRenderer.invoke("setup:cancel", profile),
  onSetupProgress: (listener) => {
    const handler = (_event, progress) => listener(progress);
    ipcRenderer.on("setup:progress", handler);
    return () => ipcRenderer.removeListener("setup:progress", handler);
  },
  transcribe: ({
    audio,
    runId,
    profile,
    vocabulary,
    revisionMode,
    revisionModel,
    writingProfile,
    replacements,
    snippets,
  }) =>
    ipcRenderer.invoke("transcription:run", {
      audio,
      runId,
      profile,
      vocabulary,
      revisionMode,
      revisionModel,
      writingProfile,
      replacements,
      snippets,
    }),
  cancelTranscription: (runId) =>
    ipcRenderer.invoke("transcription:cancel", runId),
  onTranscriptionProgress: (listener) => {
    const handler = (_event, progress) => listener(progress);
    ipcRenderer.on("transcription:progress", handler);
    return () =>
      ipcRenderer.removeListener("transcription:progress", handler);
  },
  copyText: (text) => ipcRenderer.invoke("clipboard:write", text),
  getLastTranscription: () => ipcRenderer.invoke("history:getLast"),
  getTranscriptionHistory: () => ipcRenderer.invoke("history:list"),
  saveTranscriptionCorrection: (id, text) =>
    ipcRenderer.invoke("history:saveCorrection", id, text),
  removeTranscription: (id) => ipcRenderer.invoke("history:remove", id),
  clearTranscriptionHistory: () => ipcRenderer.invoke("history:clear"),
  getMeetings: () => ipcRenderer.invoke("meetings:list"),
  getMeeting: (id) => ipcRenderer.invoke("meetings:get", id),
  removeMeeting: (id) => ipcRenderer.invoke("meetings:remove", id),
  regenerateMeetingSummary: (id) =>
    ipcRenderer.invoke("meetings:regenerate-summary", id),
  reportSelfTest: (result) => ipcRenderer.invoke("selftest:report", result),
  updateUiState: (state) => ipcRenderer.send("ui:update-state", state),
  getUiState: () => ipcRenderer.invoke("ui:get-state"),
  capsuleAction: (action) => ipcRenderer.invoke("capsule:action", action),
  capsuleHover: (hovering) =>
    ipcRenderer.send("capsule:hover", Boolean(hovering)),
  onNavigate: (listener) => {
    const handler = (_event, page) => listener(page);
    ipcRenderer.on("app:navigate", handler);
    return () => ipcRenderer.removeListener("app:navigate", handler);
  },
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
  onMeetingCommand: (listener) => {
    const handler = (_event, command) => listener(command);
    ipcRenderer.on("meeting:command", handler);
    return () => ipcRenderer.removeListener("meeting:command", handler);
  },
  toggleMeetingCapture: (desiredAction) => ipcRenderer.invoke("meeting:toggle", desiredAction),
  getMeetingCaptureState: () => ipcRenderer.invoke("meeting:capture-state"),
  startMeetingCaptureSession: (payload) =>
    ipcRenderer.invoke("meeting:capture-start", payload),
  appendMeetingCaptureChunk: (payload) =>
    ipcRenderer.invoke("meeting:capture-chunk", payload),
  saveMeetingCapture: (payload) =>
    ipcRenderer.invoke("meeting:capture-complete", payload),
  onMeetingStatus: (listener) => {
    const handler = (_event, status) => listener(status);
    ipcRenderer.on("meeting:status", handler);
    return () => ipcRenderer.removeListener("meeting:status", handler);
  },
  reportMeetingEvent: (event) => ipcRenderer.send("meeting:event", event),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  updateSettings: (patch) =>
    ipcRenderer.invoke("settings:update", patch),
  resetSettings: () => ipcRenderer.invoke("settings:reset"),
  showDashboard: () => ipcRenderer.invoke("app:show-dashboard"),
  hideDashboard: () => ipcRenderer.invoke("app:hide-dashboard"),
});
