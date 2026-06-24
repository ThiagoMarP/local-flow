export function createSettingsController({
  profileSelect,
  vocabularyInput,
  microphoneSelect,
  shortcutSelect,
  maxDurationSelect,
  revisionModeSelect,
  revisionModelSelect,
  autoPasteInput,
  restoreClipboardInput,
  launchAtLoginInput,
  startMinimizedInput,
  shortcutKey,
  shortcutStatus,
  settingsSaveStatus,
  ollamaStatus,
}) {
  const controls = [
    profileSelect,
    vocabularyInput,
    microphoneSelect,
    shortcutSelect,
    maxDurationSelect,
    revisionModeSelect,
    revisionModelSelect,
    autoPasteInput,
    restoreClipboardInput,
    launchAtLoginInput,
    startMinimizedInput,
  ];
  let current;
  let ready = false;
  let saveTimer;
  let busy = false;
  let revisionAvailable = false;

  function readForm() {
    return {
      profile: profileSelect.value,
      vocabulary: vocabularyInput.value
        .split(",")
        .map((term) => term.trim())
        .filter(Boolean),
      microphoneId: microphoneSelect.value,
      shortcut: shortcutSelect.value,
      maxRecordingSeconds: Number(maxDurationSelect.value),
      revisionMode: revisionModeSelect.value,
      revisionModel: revisionModelSelect.value,
      autoPaste: autoPasteInput.checked,
      restoreClipboard: restoreClipboardInput.checked,
      launchAtLogin: launchAtLoginInput.checked,
      startMinimized: startMinimizedInput.checked,
    };
  }

  function apply(settings) {
    current = settings;
    profileSelect.value = settings.profile;
    vocabularyInput.value = settings.vocabulary.join(", ");
    shortcutSelect.replaceChildren(
      ...settings.allowedShortcuts.map((item) => {
        const option = document.createElement("option");
        option.value = item.value;
        option.textContent = item.label;
        return option;
      }),
    );
    shortcutSelect.value = settings.shortcut;
    maxDurationSelect.value = String(settings.maxRecordingSeconds);
    revisionModeSelect.replaceChildren(
      ...settings.allowedRevisionModes.map((item) => {
        const option = document.createElement("option");
        option.value = item.value;
        option.textContent = item.label;
        return option;
      }),
    );
    revisionModeSelect.value = settings.revisionMode;
    autoPasteInput.checked = settings.autoPaste;
    restoreClipboardInput.checked = settings.restoreClipboard;
    launchAtLoginInput.checked = settings.launchAtLogin;
    startMinimizedInput.checked = settings.startMinimized;
    shortcutKey.textContent = settings.shortcutDisplay;
    syncRevisionControls();
  }

  function configureRevision(revision, selectedModel) {
    revisionAvailable = Boolean(revision?.available);
    const models = [...new Set([
      selectedModel,
      ...(revision?.models || []),
    ].filter(Boolean))];
    revisionModelSelect.replaceChildren(
      ...models.map((model) => {
        const option = document.createElement("option");
        option.value = model;
        option.textContent = model;
        return option;
      }),
    );
    revisionModelSelect.value = selectedModel;
    ollamaStatus.classList.toggle("error", !revisionAvailable);
    ollamaStatus.lastElementChild.textContent = revisionAvailable
      ? `Ollama local · ${revision.models.length} modelo(s)`
      : "Ollama offline · fallback literal ativo";
    syncRevisionControls();
  }

  function syncRevisionControls() {
    revisionModelSelect.disabled =
      busy ||
      !revisionAvailable ||
      revisionModeSelect.value === "literal";
  }

  async function refreshMicrophones() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const microphones = devices.filter(
      (device) => device.kind === "audioinput",
    );
    const selected = current?.microphoneId || "default";
    microphoneSelect.replaceChildren();

    const defaultOption = document.createElement("option");
    defaultOption.value = "default";
    defaultOption.textContent = "Padrão do Windows";
    microphoneSelect.append(defaultOption);

    microphones.forEach((device, index) => {
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.textContent = device.label || `Microfone ${index + 1}`;
      microphoneSelect.append(option);
    });
    microphoneSelect.value = [...microphoneSelect.options].some(
      (option) => option.value === selected,
    )
      ? selected
      : "default";
  }

  async function persist() {
    if (!ready) return;
    settingsSaveStatus.textContent = "Salvando…";
    settingsSaveStatus.className = "settings-save-status saving";
    try {
      const settings = await window.localFlow.updateSettings(readForm());
      current = settings;
      shortcutKey.textContent = settings.shortcutDisplay;
      shortcutStatus.textContent = "Ativo";
      shortcutStatus.classList.remove("error");
      settingsSaveStatus.textContent = "Salvo localmente";
      settingsSaveStatus.className = "settings-save-status";
    } catch (error) {
      settingsSaveStatus.textContent = error.message;
      settingsSaveStatus.className = "settings-save-status error";
      apply(current);
      await refreshMicrophones();
    }
  }

  function scheduleSave() {
    if (!ready) return;
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(persist, 350);
  }

  for (const control of controls) {
    control.addEventListener(
      control === vocabularyInput ? "input" : "change",
      scheduleSave,
    );
  }
  revisionModeSelect.addEventListener("change", syncRevisionControls);
  navigator.mediaDevices?.addEventListener(
    "devicechange",
    refreshMicrophones,
  );

  return {
    get() {
      return current;
    },
    async initialize(settings, revision) {
      apply(settings);
      configureRevision(revision, settings.revisionModel);
      await refreshMicrophones();
      ready = true;
    },
    setDisabled(disabled) {
      busy = disabled;
      for (const control of controls) control.disabled = disabled;
      syncRevisionControls();
    },
  };
}
