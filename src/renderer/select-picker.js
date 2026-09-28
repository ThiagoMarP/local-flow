// Keep the native select as the source of truth for settings and dictation.
// The visible control only mirrors its options and sends ordinary change events.
export function createSelectPickers(selects) {
  const pickers = [];
  let active = null;

  function closeActive({ restoreFocus = false } = {}) {
    if (!active) return;
    const { trigger, menu } = active;
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    trigger.classList.remove("is-open");
    active = null;
    if (restoreFocus) trigger.focus();
  }

  for (const select of selects) {
    const field = select.closest(".field");
    const label = field?.querySelector(":scope > span");
    if (!field || !label) continue;
    const labelId = `${select.id}Label`;
    const valueId = `${select.id}Value`;
    const menuId = select.id === "revisionModeSelect" ? "revisionModeMenu" : `${select.id}Menu`;
    label.id ||= labelId;
    select.classList.add("enhanced-select-native");
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.id = select.id === "revisionModeSelect" ? "revisionModeTrigger" : `${select.id}Trigger`;
    trigger.className = "select-trigger";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", menuId);
    trigger.setAttribute("aria-labelledby", `${label.id} ${valueId}`);

    const current = document.createElement("span");
    current.id = valueId;
    current.className = "select-current";
    const chevron = document.createElement("span");
    chevron.className = "select-chevron";
    chevron.setAttribute("aria-hidden", "true");
    trigger.append(current, chevron);
    select.after(trigger);

    const menu = document.createElement("div");
    menu.id = menuId;
    menu.className = "select-menu";
    menu.role = "listbox";
    menu.setAttribute("aria-labelledby", label.id);
    menu.hidden = true;
    document.body.append(menu);

    let nodes = [];
    const picker = { select, trigger, menu, sync };
    pickers.push(picker);

    function selectedIndex() {
      return Math.max(0, nodes.findIndex((node) => node.dataset.value === select.value));
    }

    function focusIndex(index, step = 1) {
      if (!nodes.length) return;
      let next = (index + nodes.length) % nodes.length;
      for (let count = 0; count < nodes.length; count += 1) {
        if (nodes[next].getAttribute("aria-disabled") !== "true") {
          nodes[next].focus();
          nodes[next].scrollIntoView({ block: "nearest" });
          return;
        }
        next = (next + step + nodes.length) % nodes.length;
      }
    }

    function positionMenu() {
      const rect = trigger.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - 10;
      const above = rect.top - 10;
      const desired = Math.min(246, nodes.length * 38 + 12);
      const opensUp = below < Math.min(desired, 145) && above > below;
      const room = Math.max(80, opensUp ? above : below);
      menu.style.left = `${Math.max(10, Math.min(rect.left, window.innerWidth - rect.width - 10))}px`;
      menu.style.width = `${Math.min(rect.width, window.innerWidth - 20)}px`;
      menu.style.maxHeight = `${Math.min(desired, room)}px`;
      menu.style.top = opensUp
        ? `${Math.max(8, rect.top - Math.min(desired, room) - 6)}px`
        : `${rect.bottom + 6}px`;
    }

    function open() {
      if (select.disabled || !nodes.length) return;
      closeActive();
      sync();
      positionMenu();
      menu.hidden = false;
      trigger.classList.add("is-open");
      trigger.setAttribute("aria-expanded", "true");
      active = picker;
      focusIndex(selectedIndex());
    }

    function choose(value) {
      const option = [...select.options].find((item) => item.value === value);
      if (!option || option.disabled || select.disabled) return;
      const changed = select.value !== value;
      select.value = value;
      sync();
      closeActive({ restoreFocus: true });
      if (changed) select.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function sync() {
      const selected = select.selectedOptions[0];
      current.textContent = selected?.textContent?.trim() || "Selecione";
      trigger.disabled = select.disabled;
      if (active === picker && select.disabled) closeActive();
      menu.replaceChildren();
      nodes = [...select.options].map((option, index) => {
        const node = document.createElement("div");
        node.id = `${select.id}Option${index}`;
        node.className = "select-option";
        node.role = "option";
        node.tabIndex = -1;
        node.dataset.value = option.value;
        node.setAttribute("aria-selected", String(option.value === select.value));
        node.setAttribute("aria-disabled", String(option.disabled));
        const name = document.createElement("span");
        name.textContent = option.textContent.trim();
        const check = document.createElement("span");
        check.className = "select-check";
        check.setAttribute("aria-hidden", "true");
        check.textContent = "✓";
        node.append(name, check);
        node.addEventListener("click", () => choose(option.value));
        menu.append(node);
        return node;
      });
    }

    trigger.addEventListener("click", () => {
      if (active === picker) closeActive({ restoreFocus: true });
      else open();
    });
    trigger.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        open();
      }
    });
    menu.addEventListener("keydown", (event) => {
      const index = nodes.indexOf(document.activeElement);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        focusIndex(index + (event.key === "ArrowDown" ? 1 : -1), event.key === "ArrowDown" ? 1 : -1);
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        focusIndex(event.key === "Home" ? 0 : nodes.length - 1);
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        nodes[index]?.click();
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeActive({ restoreFocus: true });
      } else if (event.key === "Tab") {
        closeActive();
      }
    });
    select.addEventListener("change", sync);
    sync();
  }

  document.addEventListener("pointerdown", (event) => {
    if (active && !active.trigger.contains(event.target) && !active.menu.contains(event.target)) closeActive();
  });
  document.addEventListener("focusin", (event) => {
    if (active && !active.trigger.contains(event.target) && !active.menu.contains(event.target)) closeActive();
  });
  window.addEventListener("resize", () => closeActive());
  document.querySelector(".app-content")?.addEventListener("scroll", () => closeActive(), { passive: true });

  return { sync: () => pickers.forEach((picker) => picker.sync()), close: closeActive };
}
