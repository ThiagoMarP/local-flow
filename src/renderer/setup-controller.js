const GIGABYTE = 1024 * 1024 * 1024;
const MEGABYTE = 1024 * 1024;

function formatBytes(bytes) {
  if (!bytes || bytes < 0) return "0 MB";
  if (bytes >= GIGABYTE) return `${(bytes / GIGABYTE).toFixed(2)} GB`;
  return `${Math.round(bytes / MEGABYTE)} MB`;
}

function percent(ratio) {
  return `${Math.round(Math.max(0, Math.min(1, ratio || 0)) * 100)}%`;
}

// Which buttons a model row shows. An installed model that is not the one in
// use offers "Usar este"; re-downloading an installed model is a rare repair,
// so it stays a quiet secondary action. Nothing changes while the dashboard is
// busy recording or transcribing, and one download runs at a time.
export function modelRowActions(model, { activeProfile, downloading, disabled }) {
  const isDownloading = Boolean(model.downloading) || downloading === model.profile;
  const otherDownloading = downloading !== null && downloading !== model.profile;
  const active = Boolean(model.available) && model.profile === activeProfile;
  if (isDownloading) {
    return { active, use: null, main: { role: "cancel", label: "Cancelar", disabled } };
  }
  if (!model.available) {
    return {
      active,
      use: null,
      main: { role: "download", label: "Baixar", disabled: disabled || otherDownloading },
    };
  }
  return {
    active,
    use: active ? null : { label: "Usar este", disabled },
    main: {
      role: "redownload",
      label: "Baixar novamente",
      disabled: disabled || otherDownloading,
    },
  };
}

// Drives the first-run setup panel: shows engine + model readiness and lets the
// user download each model into the writable models directory. Timing
// for downloads lives in the main process; this module only renders progress.
export function createSetupController({
  summaryStatus,
  whisperEngineStatus,
  modelsDirPath,
  modelList,
  onModelsChanged,
  onSetupRequired,
  onUseModel,
}) {
  const items = new Map();
  const downloadErrors = new Map();
  let disabled = false;
  let autoDecided = false;
  let downloading = null;
  let activeProfile = null;
  const lastModels = new Map();
  const engineLabel = whisperEngineStatus.querySelector("span:last-child");

  function ensureItem(model) {
    const existing = items.get(model.profile);
    if (existing) return existing;
    const li = document.createElement("li");
    li.className = "model-item";
    li.dataset.profile = model.profile;
    li.innerHTML = `
      <div class="model-info">
        <strong></strong>
        <small class="model-meta"></small>
      </div>
      <div class="model-action">
        <div class="model-progress"><span></span></div>
        <button class="button secondary model-button" type="button"></button>
        <button class="button primary model-use" type="button" hidden></button>
      </div>`;
    li.querySelector("strong").textContent = model.name;
    const button = li.querySelector(".model-button");
    button.addEventListener("click", () => {
      if (button.dataset.role === "cancel") {
        window.localFlow.cancelModelDownload(model.profile);
      } else {
        download(model.profile);
      }
    });
    const useButton = li.querySelector(".model-use");
    useButton.addEventListener("click", () => onUseModel?.(model.profile));
    modelList.appendChild(li);
    const entry = {
      li,
      meta: li.querySelector(".model-meta"),
      button,
      useButton,
      progress: li.querySelector(".model-progress"),
      bar: li.querySelector(".model-progress span"),
    };
    items.set(model.profile, entry);
    return entry;
  }

  function renderModel(model) {
    lastModels.set(model.profile, model);
    const entry = ensureItem(model);
    const actions = modelRowActions(model, { activeProfile, downloading, disabled });
    entry.li.dataset.available = String(model.available);
    entry.li.dataset.active = String(actions.active);
    if (actions.main.role === "cancel") {
      entry.progress.classList.add("active");
    } else {
      entry.progress.classList.remove("active");
      entry.bar.style.width = "0%";
      entry.meta.textContent = model.available
        ? `${formatBytes(model.bytes || model.approxBytes)} · instalado`
        : downloadErrors.has(model.profile)
          ? `Falha: ${downloadErrors.get(model.profile)}`
          : `≈ ${formatBytes(model.approxBytes)} · não baixado`;
    }
    entry.button.textContent = actions.main.label;
    entry.button.dataset.role = actions.main.role;
    entry.button.disabled = actions.main.disabled;
    // The row in use keeps an invisible placeholder so "Baixar novamente"
    // lines up with the other installed rows.
    entry.useButton.hidden = !model.available;
    entry.useButton.style.visibility = actions.use ? "" : "hidden";
    entry.useButton.textContent = actions.use?.label || "Usar este";
    entry.useButton.disabled = actions.use ? actions.use.disabled : true;
  }

  function renderAll() {
    for (const model of lastModels.values()) renderModel(model);
  }

  function updateProgress(progress) {
    const entry = items.get(progress.profile);
    if (!entry) return;
    downloadErrors.delete(progress.profile);
    entry.progress.classList.add("active");
    entry.bar.style.width = percent(progress.ratio);
    entry.meta.textContent = progress.done
      ? `${formatBytes(progress.received)} · concluído`
      : `${formatBytes(progress.received)} de ${formatBytes(progress.total)} · ${percent(progress.ratio)}`;
  }

  async function refresh() {
    let status;
    try {
      status = await window.localFlow.getSetupStatus();
    } catch {
      summaryStatus.textContent = "Falha ao consultar";
      summaryStatus.classList.add("saving");
      return null;
    }

    const whisperReady = Boolean(status.whisperAvailable);
    const parakeetReady = Boolean(status.parakeetAvailable);
    whisperEngineStatus.classList.toggle("error", !whisperReady && !parakeetReady);
    engineLabel.textContent = whisperReady && parakeetReady
      ? "Mecanismos Whisper e Parakeet prontos"
      : whisperReady
        ? "Mecanismo Whisper pronto"
        : parakeetReady
          ? "Mecanismo Parakeet pronto"
          : "Mecanismos de transcrição ausentes — reinstale o aplicativo";
    modelsDirPath.textContent = `Pasta dos modelos: ${status.modelsDir}`;
    modelsDirPath.title = status.modelsDir;

    const models = Object.values(status.models);
    let available = 0;
    for (const model of models) {
      renderModel(model);
      if (model.available) available += 1;
    }
    summaryStatus.textContent = `${available}/${models.length} modelos`;
    summaryStatus.classList.toggle("saving", available === 0);

    if (!autoDecided) {
      autoDecided = true;
      const activeReady = status.models[status.activeProfile]?.available;
      if ((!whisperReady && !parakeetReady) || !activeReady) {
        onSetupRequired?.(status);
      }
    }
    onModelsChanged?.(status.models);
    return status;
  }

  async function download(profile) {
    if (downloading) return;
    downloading = profile;
    renderAll();
    const entry = items.get(profile);
    if (entry) entry.bar.style.width = "0%";
    try {
      await window.localFlow.downloadModel(profile);
      downloadErrors.delete(profile);
    } catch (error) {
      downloadErrors.set(
        profile,
        error?.message || "não foi possível concluir o download",
      );
    } finally {
      downloading = null;
      await refresh();
    }
  }

  function setDisabled(next) {
    disabled = next;
    renderAll();
  }

  // The dictation model currently selected in Settings.
  function setActiveProfile(profile) {
    activeProfile = profile;
    renderAll();
  }

  window.localFlow.onSetupProgress(updateProgress);

  return { refresh, setDisabled, setActiveProfile };
}
