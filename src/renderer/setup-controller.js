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
}) {
  const items = new Map();
  const downloadErrors = new Map();
  let disabled = false;
  let autoDecided = false;
  let downloading = null;
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
    modelList.appendChild(li);
    const entry = {
      li,
      meta: li.querySelector(".model-meta"),
      button,
      progress: li.querySelector(".model-progress"),
      bar: li.querySelector(".model-progress span"),
    };
    items.set(model.profile, entry);
    return entry;
  }

  function renderModel(model) {
    const entry = ensureItem(model);
    entry.li.dataset.available = String(model.available);
    const isDownloading = model.downloading || downloading === model.profile;
    if (isDownloading) {
      entry.button.textContent = "Cancelar";
      entry.button.dataset.role = "cancel";
      entry.progress.classList.add("active");
    } else if (model.available) {
      entry.meta.textContent = `${formatBytes(model.bytes || model.approxBytes)} · instalado`;
      entry.button.textContent = "Baixar novamente";
      entry.button.dataset.role = "download";
      entry.progress.classList.remove("active");
      entry.bar.style.width = "0%";
    } else {
      entry.meta.textContent = downloadErrors.has(model.profile)
        ? `Falha: ${downloadErrors.get(model.profile)}`
        : `≈ ${formatBytes(model.approxBytes)} · não baixado`;
      entry.button.textContent = "Baixar";
      entry.button.dataset.role = "download";
      entry.progress.classList.remove("active");
      entry.bar.style.width = "0%";
    }
    entry.button.disabled =
      disabled || (downloading !== null && downloading !== model.profile);
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
    const entry = items.get(profile);
    if (entry) {
      entry.button.textContent = "Cancelar";
      entry.button.dataset.role = "cancel";
      entry.progress.classList.add("active");
      entry.bar.style.width = "0%";
    }
    for (const [key, value] of items) {
      if (key !== profile) value.button.disabled = true;
    }
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
    for (const [, entry] of items) {
      entry.button.disabled =
        next || (downloading !== null && entry.li.dataset.profile !== downloading);
    }
  }

  window.localFlow.onSetupProgress(updateProgress);

  return { refresh, setDisabled };
}
