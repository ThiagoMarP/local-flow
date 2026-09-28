import assert from "node:assert/strict";
import test from "node:test";
import { panelShortcut } from "../src/renderer/panel-shortcuts.js";

const ctrl = (key, extra = {}) => ({ key, ctrlKey: true, altKey: false, shiftKey: false, metaKey: false, ...extra });

test("Ctrl+1 a Ctrl+5 abrem as páginas na ordem da barra lateral", () => {
  assert.deepEqual(
    ["1", "2", "3", "4", "5"].map((key) => panelShortcut(ctrl(key), "home")?.page),
    ["home", "history", "meetings", "settings", "models"],
  );
});

test("Ctrl+, abre Configurações", () => {
  assert.deepEqual(panelShortcut(ctrl(","), "home"), { page: "settings" });
});

// Em Reuniões a busca é a das reuniões; em qualquer outra página, a do histórico.
test("Ctrl+F busca na página certa", () => {
  assert.deepEqual(panelShortcut(ctrl("f"), "meetings"), { page: "meetings", focus: "#meetingsSearch" });
  assert.deepEqual(panelShortcut(ctrl("F"), "home"), { page: "history", focus: "#historySearch" });
  assert.deepEqual(panelShortcut(ctrl("f"), "history"), { page: "history", focus: "#historySearch" });
});

test("ignora teclas sem Ctrl ou com outros modificadores", () => {
  assert.equal(panelShortcut(ctrl("1", { ctrlKey: false }), "home"), null);
  assert.equal(panelShortcut(ctrl("1", { shiftKey: true }), "home"), null);
  assert.equal(panelShortcut(ctrl("1", { altKey: true }), "home"), null);
  assert.equal(panelShortcut(ctrl("9"), "home"), null);
  assert.equal(panelShortcut(ctrl("v"), "home"), null);
});
