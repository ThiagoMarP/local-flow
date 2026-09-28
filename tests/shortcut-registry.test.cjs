const assert = require("node:assert/strict");
const test = require("node:test");
const { ShortcutRegistry } = require("../src/main/shortcut-registry.cjs");

function setup({ taken = [] } = {}) {
  const handlers = new Map();
  const globalShortcut = {
    register: (accelerator, handler) => {
      if (taken.includes(accelerator)) return false;
      handlers.set(accelerator, handler);
      return true;
    },
    unregister: (accelerator) => handlers.delete(accelerator),
    unregisterAll: () => handlers.clear(),
  };
  const calls = { repaste: 0, statuses: [] };
  const registry = new ShortcutRegistry({
    app: { quit: () => {} },
    globalShortcut,
    settingsStore: {
      get: () => ({
        shortcut: "CommandOrControl+Shift+Space",
        meetingShortcut: "CommandOrControl+Alt+R",
      }),
      getPublic: () => ({ allowedShortcuts: [] }),
    },
    windowManager: {
      setShortcutStatus: () => {},
      setRepasteStatus: (status) => calls.statuses.push(status),
    },
    onDictation: () => {},
    onMeeting: () => {},
    onRepaste: () => { calls.repaste += 1; },
    disableEscape: () => {},
    syncEscape: () => {},
  });
  return { registry, handlers, calls };
}

test("registra o atalho de colar a última junto com os demais", (t) => {
  t.mock.method(console, "log", () => {});
  const { registry, handlers, calls } = setup();
  registry.registerDictation();
  assert.ok(handlers.has("CommandOrControl+Alt+V"));
  handlers.get("CommandOrControl+Alt+V")();
  assert.equal(calls.repaste, 1);
  assert.deepEqual(calls.statuses.at(-1), { registered: true, display: "Ctrl+Alt+V" });
});

// Trocar o atalho de ditado passa por unregisterAll(); colar a última não
// pode sumir junto, nem ao trocar o atalho de reunião.
test("atalho de colar a última sobrevive às trocas de atalho", (t) => {
  t.mock.method(console, "log", () => {});
  const { registry, handlers } = setup();
  registry.registerDictation();
  registry.update("CommandOrControl+Alt+D");
  assert.ok(handlers.has("CommandOrControl+Alt+V"));
  registry.replaceMeeting("CommandOrControl+Alt+M");
  assert.ok(handlers.has("CommandOrControl+Alt+V"));
});

test("informa quando o atalho de colar a última está ocupado", (t) => {
  t.mock.method(console, "log", () => {});
  const { registry, calls } = setup({ taken: ["CommandOrControl+Alt+V"] });
  registry.registerDictation();
  assert.deepEqual(calls.statuses.at(-1), { registered: false, display: "Ctrl+Alt+V" });
  assert.equal(registry.status().repaste.registered, false);
});
