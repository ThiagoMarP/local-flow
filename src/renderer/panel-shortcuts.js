const PAGES_BY_DIGIT = {
  1: "home",
  2: "history",
  3: "meetings",
  4: "settings",
  5: "models",
};

// Keyboard shortcuts inside the dashboard: Ctrl+1..5 open the pages in sidebar
// order, Ctrl+, opens Settings and Ctrl+F focuses the search of the current
// list (meetings on Reuniões, history everywhere else). Only plain Ctrl
// combinations, so Ctrl+Shift/Alt shortcuts of other tools stay untouched.
export function panelShortcut(event, currentPage) {
  if (!event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return null;
  const key = String(event.key).toLowerCase();
  if (PAGES_BY_DIGIT[key]) return { page: PAGES_BY_DIGIT[key] };
  if (key === ",") return { page: "settings" };
  if (key === "f") {
    return currentPage === "meetings"
      ? { page: "meetings", focus: "#meetingsSearch" }
      : { page: "history", focus: "#historySearch" };
  }
  return null;
}
