const assert = require("node:assert/strict");
const test = require("node:test");
const { EscapeShortcut } = require("../src/main/escape-shortcut.cjs");
const { HotkeyListener } = require("../src/main/hotkey-listener.cjs");
const { HotkeyController } = require("../src/main/hotkey-controller.cjs");

test("Escape só captura globalmente enquanto o ditado permite cancelar", () => {
  const calls = [];
  let callback;
  const shortcut = new EscapeShortcut({
    globalShortcut: {
      register: (key, handler) => {
        calls.push(["register", key]);
        callback = handler;
        return true;
      },
      unregister: (key) => calls.push(["unregister", key]),
    },
    onEscape: () => calls.push(["cancel"]),
  });

  shortcut.setEnabled(false);
  assert.deepEqual(calls, []);
  assert.equal(shortcut.setEnabled(true), true);
  shortcut.setEnabled(true);
  callback();
  shortcut.setEnabled(false);
  shortcut.dispose();
  assert.deepEqual(calls, [
    ["register", "Escape"],
    ["cancel"],
    ["unregister", "Escape"],
  ]);
});

test("falha ao registrar Escape não desregistra atalho alheio", () => {
  const calls = [];
  const shortcut = new EscapeShortcut({
    globalShortcut: {
      register: () => false,
      unregister: () => calls.push("unregister"),
    },
    onEscape: () => {},
    onUnavailable: () => calls.push("unavailable"),
  });
  assert.equal(shortcut.setEnabled(true), false);
  shortcut.setEnabled(false);
  assert.deepEqual(calls, ["unavailable"]);
});

test("Escape com Ctrl+Win descarta gesto pendente antes da liberação", () => {
  const events = [];
  const controller = new HotkeyController({
    holdThresholdMs: 1,
    setTimer: (callback) => { callback(); return 1; },
    clearTimer: () => {},
    onHoldStart: () => events.push("hold-start"),
    onHoldStop: () => events.push("hold-stop"),
  });
  const listener = new HotkeyListener({
    scriptPath: "unused.ps1",
    controller,
    onEscape: () => events.push("escape"),
  });
  listener.handleLine('{"event":"down"}');
  listener.handleLine('{"event":"escape"}');
  listener.handleLine('{"event":"up"}');
  assert.deepEqual(events, ["hold-start", "escape"]);
});
