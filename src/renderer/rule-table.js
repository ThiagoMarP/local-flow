// Editable table of source → target rules (Substituições and Snippets),
// replacing the old "origem => destino" textarea syntax. The saved shape is
// unchanged: [{ from, to }] and [{ trigger, expansion }].

export function rowsToRules(rows, { sourceKey, targetKey }) {
  return rows
    .map((row) => ({
      source: String(row.source ?? "").trim(),
      target: String(row.target ?? "").replace(/\r\n/g, "\n").trim(),
    }))
    .filter((row) => row.source)
    .map((row) => ({ [sourceKey]: row.source, [targetKey]: row.target }));
}

// Why a row would be dropped when saved, mirroring the main-process
// normalizer, so the table can say it instead of losing the row silently.
export function ruleRowIssues(rows, { allowEmptyTarget }) {
  const seen = new Set();
  return rows.map((row) => {
    const source = String(row.source ?? "").trim();
    const target = String(row.target ?? "").trim();
    if (!source) return null;
    const key = source.toLocaleLowerCase("pt-BR");
    if (seen.has(key)) return "duplicate";
    seen.add(key);
    if (source === target) return "same";
    if (!allowEmptyTarget && !target) return "empty-target";
    return null;
  });
}

const ISSUE_TEXT = {
  duplicate: "Repetida: só a primeira vale.",
  same: "Origem e destino iguais: não muda nada.",
  "empty-target": "Sem texto: será ignorada.",
};

export function createRuleTable({
  container,
  sourceKey,
  targetKey,
  sourceLabel,
  targetLabel,
  sourcePlaceholder,
  targetPlaceholder,
  addLabel,
  multilineTarget = false,
  allowEmptyTarget = false,
  maxRows,
  onChange,
}) {
  const list = document.createElement("div");
  list.className = "rule-rows";
  list.setAttribute("role", "list");
  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "button secondary tiny rule-add";
  addButton.textContent = `+ ${addLabel}`;
  container.replaceChildren(list, addButton);
  let disabled = false;

  function readRows() {
    return [...list.children].map((row) => ({
      source: row.querySelector(".rule-source").value,
      target: row.querySelector(".rule-target").value,
    }));
  }

  function showIssues() {
    const issues = ruleRowIssues(readRows(), { allowEmptyTarget });
    [...list.children].forEach((row, index) => {
      const issue = issues[index];
      row.classList.toggle("has-issue", Boolean(issue));
      row.querySelector(".rule-source").setAttribute("aria-invalid", String(Boolean(issue)));
      row.querySelector(".rule-issue").textContent = issue ? ISSUE_TEXT[issue] : "";
    });
    addButton.disabled = disabled || list.children.length >= maxRows;
  }

  function changed() {
    showIssues();
    onChange?.();
  }

  function addRow(rule = {}) {
    const row = document.createElement("div");
    row.className = "rule-row";
    row.setAttribute("role", "listitem");

    const source = document.createElement("input");
    source.type = "text";
    source.className = "rule-source";
    source.maxLength = 120;
    source.placeholder = sourcePlaceholder;
    source.setAttribute("aria-label", sourceLabel);
    source.value = rule[sourceKey] ?? "";

    const arrow = document.createElement("span");
    arrow.className = "rule-arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "→";

    const target = document.createElement(multilineTarget ? "textarea" : "input");
    if (!multilineTarget) target.type = "text";
    else target.rows = 1;
    target.className = "rule-target";
    target.maxLength = multilineTarget ? 4000 : 500;
    target.placeholder = targetPlaceholder;
    target.setAttribute("aria-label", targetLabel);
    target.value = rule[targetKey] ?? "";

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "rule-remove";
    remove.setAttribute("aria-label", "Remover regra");
    remove.title = "Remover regra";
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      row.remove();
      changed();
    });

    const issue = document.createElement("small");
    issue.className = "rule-issue";

    for (const input of [source, target]) {
      input.disabled = disabled;
      input.addEventListener("input", changed);
    }
    remove.disabled = disabled;
    row.append(source, arrow, target, remove, issue);
    list.append(row);
    return row;
  }

  addButton.addEventListener("click", () => {
    addRow().querySelector(".rule-source").focus();
    showIssues();
  });

  return {
    get() {
      return rowsToRules(readRows(), { sourceKey, targetKey });
    },
    set(rules) {
      list.replaceChildren();
      for (const rule of rules || []) addRow(rule);
      showIssues();
    },
    setDisabled(next) {
      disabled = next;
      for (const control of list.querySelectorAll("input, textarea, button")) {
        control.disabled = next;
      }
      showIssues();
    },
  };
}
