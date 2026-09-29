// "Reuniões" page. Lists past meeting captures with their AI summary
// and a lazily-loaded full transcript. Mirrors the History page pattern: a
// light list up front, content built as DOM (no innerHTML) to stay within the
// renderer's CSP and avoid injecting model output as markup.

import { formatOffset, transcriptTurns } from "./meeting-transcript.js";

const SVG_NS = "http://www.w3.org/2000/svg";

const PROFILE_LABELS = {
  fast: "Small",
  standard: "Medium",
  accurate: "Large V3 Turbo",
  parakeet: "Parakeet v3",
};

// Electron wraps handler rejections as "Error invoking remote method '…':
// Error: <message>"; keep only the message the main process wrote.
function ipcErrorMessage(error) {
  return String(error?.message || error)
    .replace(/^Error invoking remote method '[^']*':\s*/i, "")
    .replace(/^(Uncaught )?Error:\s*/i, "");
}


function svgIcon(paths) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "15");
  svg.setAttribute("height", "15");
  svg.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.8");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.append(path);
  }
  return svg;
}

function formatDate(at) {
  if (!at) return "Sem data";
  return new Date(at).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  return minutes > 0 ? `${minutes}min ${total % 60}s` : `${total}s`;
}

// Inline **bold** → <strong>, everything else as text.
function appendInline(el, text) {
  for (const part of String(text).split(/(\*\*[^*]+\*\*)/g)) {
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      const strong = document.createElement("strong");
      strong.textContent = part.slice(2, -2);
      el.append(strong);
    } else if (part) {
      el.append(document.createTextNode(part));
    }
  }
}

// Minimal renderer for the ata markdown: "# title", "## heading", "* / -"
// bullets, "- [ ]" / "- [x]" checkboxes, plain paragraphs. Built as DOM, never
// innerHTML (stays within the renderer CSP and never injects model output).
function renderSummary(markdown) {
  const fragment = document.createDocumentFragment();
  let list = null;
  for (const raw of String(markdown).split("\n")) {
    const line = raw.trim();
    if (!line) {
      list = null;
      continue;
    }
    if (line.startsWith("# ")) {
      list = null;
      const heading = document.createElement("p");
      heading.className = "meeting-h1";
      heading.textContent = line.slice(2).trim();
      fragment.append(heading);
      continue;
    }
    if (line.startsWith("## ") || line.startsWith("### ")) {
      list = null;
      const heading = document.createElement("p");
      heading.className = "meeting-h";
      heading.textContent = line.replace(/^#{2,3}\s+/, "").trim();
      fragment.append(heading);
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      if (!list) {
        list = document.createElement("ul");
        list.className = "meeting-ul";
        fragment.append(list);
      }
      const item = document.createElement("li");
      const checkbox = bullet[1].match(/^\[([ xX])\]\s*(.*)$/);
      if (checkbox) {
        item.className = "meeting-check";
        const box = document.createElement("span");
        box.className = "meeting-box";
        if (checkbox[1].toLowerCase() === "x") box.classList.add("checked");
        const body = document.createElement("span");
        appendInline(body, checkbox[2]);
        item.append(box, body);
      } else {
        appendInline(item, bullet[1]);
      }
      list.append(item);
      continue;
    }
    list = null;
    const paragraph = document.createElement("p");
    paragraph.className = "meeting-p";
    appendInline(paragraph, line);
    fragment.append(paragraph);
  }
  return fragment;
}

export function createMeetingsController({ listEl, countEl, searchEl }) {
  let all = [];

  function flash(button, label) {
    const previous = button.textContent;
    button.textContent = label;
    button.classList.add("copied-flash");
    window.setTimeout(() => {
      button.textContent = previous;
      button.classList.remove("copied-flash");
    }, 1400);
  }

  // "Gerar resumo" / "Refazer resumo": only for a finished meeting with a
  // transcript. The summary comes from the main process (Ollama).
  function canSummarize(meeting) {
    return meeting.hasTranscript && ["done", "partial"].includes(meeting.state);
  }

  async function generateSummary(meeting, button, idleLabel) {
    const card = button.closest(".meeting-card");
    card?.querySelector(".meeting-summary-error")?.remove();
    button.disabled = true;
    button.textContent = "Gerando resumo…";
    try {
      const updated = await window.localFlow.regenerateMeetingSummary(meeting.id);
      all = all.map((item) => (item.id === meeting.id ? { ...item, ...updated } : item));
      applyFilter();
    } catch (error) {
      button.disabled = false;
      button.textContent = idleLabel;
      const message = document.createElement("p");
      message.className = "meeting-summary-error";
      message.setAttribute("role", "alert");
      message.textContent = ipcErrorMessage(error);
      card?.querySelector(".meeting-summary")?.append(message);
    }
  }

  // Who spoke and when, one row per turn.
  function renderTurns(turns) {
    const list = document.createElement("ol");
    list.className = "meeting-turns";
    if (!turns.length) {
      const empty = document.createElement("li");
      empty.className = "meeting-turn";
      empty.textContent = "(transcrição vazia)";
      list.append(empty);
      return list;
    }
    for (const turn of turns) {
      const item = document.createElement("li");
      item.className = "meeting-turn";
      item.dataset.speaker = turn.speaker;
      const meta = document.createElement("div");
      meta.className = "meeting-turn-meta";
      if (turn.label) {
        const label = document.createElement("span");
        label.className = "meeting-turn-label";
        label.textContent = turn.label;
        meta.append(label);
      }
      const offset = formatOffset(turn.from);
      if (offset) {
        const time = document.createElement("time");
        time.textContent = offset;
        meta.append(time);
      }
      const text = document.createElement("p");
      text.className = "meeting-turn-text";
      text.textContent = turn.text;
      item.append(meta, text);
      list.append(item);
    }
    return list;
  }

  function buildCard(meeting) {
    const card = document.createElement("article");
    card.className = "meeting-card";

    const head = document.createElement("div");
    head.className = "meeting-head";
    const info = document.createElement("div");
    const date = document.createElement("p");
    date.className = "meeting-date";
    date.textContent = formatDate(meeting.at);
    const meta = document.createElement("p");
    meta.className = "meeting-meta";
    const bits = [formatDuration(meeting.durationSeconds)];
    if (Number.isFinite(meeting.turns) && meeting.turns > 0) {
      bits.push(`${meeting.turns} fala${meeting.turns > 1 ? "s" : ""}`);
    }
    bits.push(
      meeting.state === "recording"
        ? "gravando"
        : meeting.state === "processing"
          ? "processando"
          : meeting.state === "failed"
            ? "processamento falhou"
            : meeting.state === "partial"
              ? "transcrição parcial"
            : meeting.hasSummary
              ? "com resumo"
              : meeting.hasTranscript
                ? "sem resumo"
                : "sem transcrição",
    );
    if (PROFILE_LABELS[meeting.profile]) bits.push(PROFILE_LABELS[meeting.profile]);
    if (meeting.failureCount > 0) {
      bits.push(meeting.failureCount > 1
        ? `${meeting.failureCount} trechos indisponíveis`
        : "1 trecho indisponível");
    }
    if (meeting.interrupted) {
      bits.push(meeting.state === "done" ? "recuperada" : "interrompida");
    }
    meta.textContent = bits.join(" · ");
    info.append(date, meta);

    const actions = document.createElement("div");
    actions.className = "meeting-actions";
    if (meeting.hasSummary) {
      const copySummary = document.createElement("button");
      copySummary.type = "button";
      copySummary.className = "button secondary tiny";
      copySummary.textContent = "Copiar resumo";
      copySummary.addEventListener("click", async () => {
        await window.localFlow.copyText(meeting.summary);
        flash(copySummary, "Copiado!");
      });
      actions.append(copySummary);
      if (canSummarize(meeting)) {
        const redo = document.createElement("button");
        redo.type = "button";
        redo.className = "button ghost tiny";
        redo.textContent = "Refazer resumo";
        redo.title = "Gerar o resumo de novo com o modelo atual";
        redo.addEventListener("click", () => generateSummary(meeting, redo, "Refazer resumo"));
        actions.append(redo);
      }
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "meeting-icon-btn";
    remove.setAttribute("aria-label", "Excluir reunião");
    if (meeting.state === "recording" || meeting.state === "processing") {
      remove.disabled = true;
      remove.title = "Aguarde a reunião terminar antes de excluí-la";
    }
    remove.append(
      svgIcon(["M5 7h14", "M9 7V5h6v2", "M7 7l1 12h8l1-12"]),
    );
    let removeArmed = false;
    let removeTimer;
    remove.addEventListener("click", async () => {
      if (!removeArmed) {
        removeArmed = true;
        remove.textContent = "Confirmar?";
        remove.classList.add("confirming");
        remove.setAttribute("aria-label", "Confirmar exclusão da reunião");
        removeTimer = window.setTimeout(() => {
          removeArmed = false;
          remove.replaceChildren(
            svgIcon(["M5 7h14", "M9 7V5h6v2", "M7 7l1 12h8l1-12"]),
          );
          remove.classList.remove("confirming");
          remove.setAttribute("aria-label", "Excluir reunião");
        }, 4000);
        return;
      }
      window.clearTimeout(removeTimer);
      remove.disabled = true;
      try {
        all = await window.localFlow.removeMeeting(meeting.id);
        applyFilter();
      } catch {
        remove.disabled = false;
        removeArmed = false;
        remove.textContent = "Falha ao excluir";
        remove.setAttribute("aria-label", "Falha ao excluir reunião. Tente novamente");
      }
    });
    actions.append(remove);
    head.append(info, actions);
    card.append(head);

    const summary = document.createElement("div");
    summary.className = "meeting-summary";
    if (meeting.summary && meeting.summary.trim()) {
      summary.append(renderSummary(meeting.summary));
    } else {
      const note = document.createElement("p");
      note.className = "meeting-empty-summary";
      note.textContent = meeting.state === "recording"
        ? "Gravando reunião…"
        : meeting.state === "processing"
          ? "Processando transcrição e resumo…"
          : meeting.hasTranscript
            ? "Sem resumo. Se o Ollama estava fechado quando a reunião foi processada, gere agora."
            : meeting.interrupted
              ? "A gravação foi interrompida. O áudio foi preservado no disco."
              : "Transcrição indisponível. O áudio da reunião foi salvo no disco.";
      summary.append(note);
      if (canSummarize(meeting)) {
        const generate = document.createElement("button");
        generate.type = "button";
        generate.className = "button primary tiny meeting-generate";
        generate.textContent = "Gerar resumo";
        generate.addEventListener("click", () => generateSummary(meeting, generate, "Gerar resumo"));
        summary.append(generate);
      }
    }
    card.append(summary);

    if (meeting.hasTranscript) {
      const details = document.createElement("details");
      details.className = "meeting-transcript";
      const toggle = document.createElement("summary");
      toggle.textContent = Number.isFinite(meeting.turns) && meeting.turns > 0
        ? `Ver transcrição (${meeting.turns} fala${meeting.turns > 1 ? "s" : ""})`
        : "Ver transcrição";
      details.append(toggle);
      let loaded = false;
      details.addEventListener("toggle", async () => {
        if (!details.open || loaded) return;
        loaded = true;
        const full = await window.localFlow.getMeeting(meeting.id);
        const text = renderTurns(transcriptTurns(full));
        const copyTranscript = document.createElement("button");
        copyTranscript.type = "button";
        copyTranscript.className = "button secondary tiny";
        copyTranscript.textContent = "Copiar transcrição";
        copyTranscript.addEventListener("click", async () => {
          await window.localFlow.copyText(full.transcript || "");
          flash(copyTranscript, "Copiado!");
        });
        details.append(text, copyTranscript);
      });
      card.append(details);
    }

    return card;
  }

  function render(items) {
    countEl.textContent = String(items.length);
    listEl.replaceChildren();
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "history-empty";
      empty.textContent = all.length
        ? "Nenhuma reunião encontrada."
        : "Nenhuma reunião gravada ainda. Use Iniciar gravação acima.";
      listEl.append(empty);
      return;
    }
    for (const meeting of items) listEl.append(buildCard(meeting));
  }

  function applyFilter() {
    const query = (searchEl?.value || "").trim().toLowerCase();
    const items = query
      ? all.filter(
          (meeting) =>
            (meeting.summary || "").toLowerCase().includes(query) ||
            formatDate(meeting.at).toLowerCase().includes(query),
        )
      : all;
    render(items);
  }

  async function refresh() {
    const items = await window.localFlow.getMeetings();
    all = Array.isArray(items) ? items : [];
    applyFilter();
  }

  searchEl?.addEventListener("input", applyFilter);

  return { refresh };
}
