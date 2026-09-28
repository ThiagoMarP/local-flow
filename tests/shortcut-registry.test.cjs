const assert = require("node:assert/strict");
const test = require("node:test");
const { ShortcutRegistry } = require("../src/main/shortcut-registry.cjs");
const {
  DEFAULT_SETTINGS,
  publicSettings,
} = require("../src/main/services/settings-store.cjs");

function setup({ taken = [], repasteShortcut = DEFAULT_SETTINGS.repasteShortcut } = {}) {
  const settings = { ...DEFAULT_SETTINGS, repasteShortcut };
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
      get: () => settings,
      getPublic: () => publicSettings(settings),
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
  return { registry, handlers, calls, settings };
}

test("registra o atalho de colar a última junto com os demais", (t) => {
  t.mock.method(console, "log", () => {});
  const { registry, handlers, calls } = setup();
  registry.registerDictation();
  assert.ok(handlers.has("CommandOrControl+Alt+V"));
  handlers.get("CommandOrControl+Alt+V")();
  assert.equal(calls.repaste, 1);
  assert.deepEqual(calls.statuses.at(-1), { registered: true, disabled: false, display: "Ctrl+Alt+V" });
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
  assert.deepEqual(calls.statuses.at(-1), { registered: false, disabled: false, display: "Ctrl+Alt+V" });
  assert.equal(registry.status().repaste.registered, false);
});

test("desativado não registra nada e informa o estado", (t) => {
  t.mock.method(console, "log", () => {});
  const { registry, handlers, calls } = setup({ repasteShortcut: "off" });
  registry.registerDictation();
  assert.equal(handlers.has("off"), false);
  assert.equal(handlers.size, 2);
  assert.deepEqual(calls.statuses.at(-1), { registered: false, disabled: true, display: "Desativado" });
});

test("troca o atalho de colar a última sem mexer nos outros", (t) => {
  t.mock.method(console, "log", () => {});
  const { registry, handlers, calls, settings } = setup();
  registry.registerDictation();
  assert.equal(registry.updateRepaste("CommandOrControl+Alt+B"), true);
  settings.repasteShortcut = "CommandOrControl+Alt+B";
  assert.equal(handlers.has("CommandOrControl+Alt+V"), false);
  assert.ok(handlers.has("CommandOrControl+Alt+B"));
  assert.ok(handlers.has("CommandOrControl+Shift+Space"));
  assert.deepEqual(calls.statuses.at(-1), { registered: true, disabled: false, display: "Ctrl+Alt+B" });
  // Re-registrar o ditado (unregisterAll) mantém a escolha nova.
  registry.update("CommandOrControl+Alt+D");
  assert.ok(handlers.has("CommandOrControl+Alt+B"));

  assert.equal(registry.updateRepaste("off"), true);
  assert.equal(handlers.has("CommandOrControl+Alt+B"), false);
});

// Como no atalho do ditado: combinação ocupada por outro app recusa a troca e
// devolve a anterior, em vez de deixar o recurso sem atalho.
test("combinação ocupada recusa a troca e mantém a anterior", (t) => {
  t.mock.method(console, "log", () => {});
  const { registry, handlers } = setup({ taken: ["CommandOrControl+Alt+B"] });
  registry.registerDictation();
  assert.equal(registry.updateRepaste("CommandOrControl+Alt+B"), false);
  assert.ok(handlers.has("CommandOrControl+Alt+V"));
  assert.equal(registry.status().repaste.registered, true);
});
