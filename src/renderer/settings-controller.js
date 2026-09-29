import { createSelectPickers } from "./select-picker.js";
import { appendReplacementRule } from "./replacement-rule.js";

export function createSettingsController({
  profileSelect,
  vocabularyInput,
  microphoneSelect,
  shortcutSelect,
  meetingShortcutSelect,
  repasteShortcutSelect,
  meetingCaptureModeSelect,
  meetingProfileSelect,
  meetingSummaryModelSelect,
  maxDurationSelect,
  revisionEnabledInput,
  revisionModeSelect,
  revisionModelSelect,
  writingProfileSelect,
  replacementRulesInput,
  snippetRulesInput,
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
    meetingShortcutSelect,
    repasteShortcutSelect,
    meetingCaptureModeSelect,
    meetingProfileSelect,
    meetingSummaryModelSelect,
    maxDurationSelect,
    revisionEnabledInput,
    revisionModeSelect,
    revisionModelSelect,
    writingProfileSelect,
    replacementRulesInput,
    snippetRulesInput,
    autoPasteInput,
    restoreClipboardInput,
    launchAtLoginInput,
    startMinimizedInput,
  ];
  let current;
  let ready = false;
  let saveTimer;
  let saveInFlight = Promise.resolve();
  let busy = false;
  let revisionAvailable = false;
  let revisionModelCount = 0;
  const selectPickers = createSelectPickers(
    controls.filter((control) => control instanceof HTMLSelectElement),
  );

  function parseRules(value, sourceKey, targetKey) {
    return value
      .split(/\r?\n/)
      .map((line) => {
        const separator = line.indexOf("=>");
        if (separator < 0) return null;
        const source = line.slice(0, separator).trim();
        const target = line
          .slice(separator + 2)
          .trim()
          .replaceAll("\\n", "\n");
        return source
          ? { [sourceKey]: source, [targetKey]: target }
          : null;
      })
      .filter(Boolean);
  }

  function serializeRules(rules, sourceKey, targetKey) {
    return rules
      .map(
        (rule) =>
          `${rule[sourceKey]} => ${rule[targetKey].replaceAll("\n", "\\n")}`,
      )
      .join("\n");
  }

  function readForm() {
    return {
      profile: profileSelect.value,
      vocabulary: vocabularyInput.value
        .split(",")
        .map((term) => term.trim())
        .filter(Boolean),
      microphoneId: microphoneSelect.value,
      shortcut: shortcutSelect.value,
      meetingShortcut: meetingShortcutSelect.value,
      repasteShortcut: repasteShortcutSelect.value,
      meetingCaptureMode: meetingCaptureModeSelect.value,
      meetingProfile: meetingProfileSelect.value,
      meetingSummaryModel: meetingSummaryModelSelect.value,
      maxRecordingSeconds: Number(maxDurationSelect.value),
      revisionEnabled: revisionEnabledInput.checked,
      revisionMode: revisionModeSelect.value,
      revisionModel: revisionModelSelect.value,
      writingProfile: writingProfileSelect.value,
      replacements: parseRules(
        replacementRulesInput.value,
        "from",
        "to",
      ),
      snippets: parseRules(
        snippetRulesInput.value,
        "trigger",
        "expansion",
      ),
      autoPaste: autoPasteInput.checked,
      // Ctrl+V being sent does not prove that the target field received text.
      // Keep the transcription available for manual paste in that case.
      restoreClipboard: false,
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
    meetingShortcutSelect.replaceChildren(
      ...settings.allowedMeetingShortcuts.map((item) => {
        const option = document.createElement("option");
        option.value = item.value;
        option.textContent = item.label;
        return option;
      }),
    );
    meetingShortcutSelect.value = settings.meetingShortcut;
    repasteShortcutSelect.replaceChildren(
      ...settings.allowedRepasteShortcuts.map((item) => {
        const option = document.createElement("option");
        option.value = item.value;
        option.textContent = item.label;
        return option;
      }),
    );
    repasteShortcutSelect.value = settings.repasteShortcut;
    meetingCaptureModeSelect.replaceChildren(
      ...settings.allowedMeetingCaptureModes.map((item) => {
        const option = document.createElement("option");
        option.value = item.value;
        option.textContent = item.label;
        return option;
      }),
    );
    meetingCaptureModeSelect.value = settings.meetingCaptureMode;
    meetingProfileSelect.value = settings.meetingProfile;
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
    revisionEnabledInput.checked = settings.revisionEnabled !== false;
    writingProfileSelect.replaceChildren(
      ...settings.allowedWritingProfiles.map((item) => {
        const option = document.createElement("option");
        option.value = item.value;
        option.textContent = item.label;
        return option;
      }),
    );
    writingProfileSelect.value = settings.writingProfile;
    replacementRulesInput.value = serializeRules(
      settings.replacements,
      "from",
      "to",
    );
    snippetRulesInput.value = serializeRules(
      settings.snippets,
      "trigger",
      "expansion",
    );
    autoPasteInput.checked = settings.autoPaste;
    restoreClipboardInput.checked = false;
    launchAtLoginInput.checked = settings.launchAtLogin;
    startMinimizedInput.checked = settings.startMinimized;
    syncRevisionControls();
    selectPickers.sync();
  }

  function configureRevision(revision, selectedModel, meetingSummaryModel) {
    revisionAvailable = Boolean(revision?.available);
    revisionModelCount = revision?.models?.length || 0;
    const models = [...new Set([
      selectedModel,
      meetingSummaryModel,
      ...(revision?.models || []),
    ].filter(Boolean))];
    const buildOptions = () =>
      models.map((model) => {
        const option = document.createElement("option");
        option.value = model;
        option.textContent = model;
        return option;
      });
    revisionModelSelect.replaceChildren(...buildOptions());
    revisionModelSelect.value = selectedModel;
    meetingSummaryModelSelect.replaceChildren(...buildOptions());
    meetingSummaryModelSelect.value = meetingSummaryModel;
    syncRevisionControls();
    selectPickers.sync();
  }

  function syncRevisionControls() {
    const enabled = revisionEnabledInput.checked;
    revisionModeSelect.disabled = busy || !enabled;
    revisionModelSelect.disabled =
      busy ||
      !enabled ||
      !revisionAvailable ||
      ["literal", "fast"].includes(revisionModeSelect.value);
    revisionEnabledInput.closest(".settings-group")?.classList.toggle("is-off", !enabled);
    if (!enabled) {
      ollamaStatus.classList.remove("error");
      ollamaStatus.lastElementChild.textContent =
        "Desligada · o texto é colado como foi transcrito";
      selectPickers.sync();
      return;
    }
    const quick = revisionModeSelect.value === "fast";
    ollamaStatus.classList.toggle("error", !revisionAvailable && !quick);
    ollamaStatus.lastElementChild.textContent = quick
      ? "Limpeza rápida · sem chamada ao modelo"
      : revisionAvailable
        ? `Ollama local · ${revisionModelCount} modelo(s)`
        : "Ollama offline · modos com IA mantêm o original";
    selectPickers.sync();
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
    selectPickers.sync();
  }

  function persist() {
    if (!ready) return Promise.resolve(null);
    const draft = readForm();
    const saving = saveInFlight.catch(() => {}).then(async () => {
      settingsSaveStatus.textContent = "Salvando…";
      settingsSaveStatus.className = "settings-save-status saving";
      try {
        const settings = await window.localFlow.updateSettings(draft);
        current = settings;
        settingsSaveStatus.textContent = "Salvo localmente";
        settingsSaveStatus.className = "settings-save-status";
        return settings;
      } catch (error) {
        settingsSaveStatus.textContent = error.message;
        settingsSaveStatus.className = "settings-save-status error";
        apply(current);
        await refreshMicrophones();
        return null;
      }
    });
    saveInFlight = saving;
    return saving;
  }

  async function addReplacementRule(from, to) {
    if (!ready) throw new Error("Configurações ainda indisponíveis.");
    // Validate before cancelling an unrelated pending settings save.
    appendReplacementRule(readForm().replacements, from, to);
    window.clearTimeout(saveTimer);
    await saveInFlight;
    const rules = appendReplacementRule(readForm().replacements, from, to);
    const added = rules[rules.length - 1];
    replacementRulesInput.value = serializeRules(
      rules,
      "from",
      "to",
    );
    const saved = await persist();
    if (!saved?.replacements.some((rule) =>
      rule.from === added.from && rule.to === added.to)) {
      throw new Error("Não foi possível salvar a regra.");
    }
    replacementRulesInput.value = serializeRules(saved.replacements, "from", "to");
  }

  function scheduleSave() {
    if (!ready) return;
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(persist, 350);
  }

  const liveInputs = new Set([
    vocabularyInput,
    replacementRulesInput,
    snippetRulesInput,
  ]);
  for (const control of controls) {
    control.addEventListener(
      liveInputs.has(control) ? "input" : "change",
      scheduleSave,
    );
  }
  revisionModeSelect.addEventListener("change", syncRevisionControls);
  revisionEnabledInput.addEventListener("change", syncRevisionControls);
  navigator.mediaDevices?.addEventListener(
    "devicechange",
    refreshMicrophones,
  );

  return {
    closeRevisionPicker: selectPickers.close,
    syncSelectPickers: selectPickers.sync,
    get() {
      return current;
    },
    getDraft() {
      return { ...current, ...readForm() };
    },
    addReplacementRule,
    // A mode picked elsewhere (the tray) and already saved by main: reflect it
    // without saving again.
    // Switched from the tray and already saved by main: reflect it only.
    applyRevisionEnabled(enabled) {
      revisionEnabledInput.checked = enabled !== false;
      if (current) current = { ...current, revisionEnabled: revisionEnabledInput.checked };
      syncRevisionControls();
    },
    applyRevisionMode(mode) {
      if (![...revisionModeSelect.options].some((option) => option.value === mode)) return;
      revisionModeSelect.value = mode;
      if (current) current = { ...current, revisionMode: mode };
      syncRevisionControls();
    },
    async initialize(settings, revision) {
      apply(settings);
      configureRevision(
        revision,
        settings.revisionModel,
        settings.meetingSummaryModel,
      );
      await refreshMicrophones();
      if (settings.restoreClipboard) {
        try {
          current = await window.localFlow.updateSettings({
            restoreClipboard: false,
          });
        } catch {
          settingsSaveStatus.textContent =
            "Não foi possível atualizar a configuração do clipboard.";
          settingsSaveStatus.className = "settings-save-status error";
        }
      }
      ready = true;
    },
    setDisabled(disabled) {
      busy = disabled;
      for (const control of controls) control.disabled = disabled;
      syncRevisionControls();
      selectPickers.sync();
    },
  };
}
