const assert = require("node:assert/strict");
const test = require("node:test");
const { buildTrayTemplate } = require("../src/main/tray-menu.cjs");

function input(overrides = {}) {
  const calls = [];
  const actions = {
    toggleDictation: () => calls.push("toggleDictation"),
    copyLast: () => calls.push("copyLast"),
    setRevisionMode: (mode) => calls.push(`revision:${mode}`),
    showDashboard: () => calls.push("showDashboard"),
    toggleDashboard: () => calls.push("toggleDashboard"),
    quit: () => calls.push("quit"),
  };
  return {
    calls,
    value: {
      dictationState: "idle",
      dashboardVisible: false,
      profile: "parakeet",
      hotkey: { ready: true, display: "Ctrl + Win" },
      shortcut: { registered: true, display: "Ctrl+Shift+Espaço" },
      repaste: { registered: true, disabled: false, display: "Ctrl+Alt+V" },
      revisionMode: "literal",
      revisionModes: [
        { value: "literal", label: "Literal" },
        { value: "prompt", label: "Prompt para IA" },
      ],
      actions,
      ...overrides,
    },
  };
}

const byLabel = (template, label) => template.find((item) => item.label === label);

test("ações principais vêm primeiro e disparam as ações", () => {
  const { value, calls } = input();
  const template = buildTrayTemplate(value);
  assert.equal(template[0].label, "Iniciar ditado");
  assert.equal(template[1].label, "Copiar última transcrição");
  assert.equal(template[2].label, "Modo de revisão");
  template[0].click();
  template[1].click();
  assert.deepEqual(calls, ["toggleDictation", "copyLast"]);
});

// O rótulo do ditado acompanha o que está acontecendo agora.
test("item do ditado reflete o estado atual", () => {
  const label = (dictationState) =>
    buildTrayTemplate(input({ dictationState }).value)[0];
  assert.equal(label("recording").label, "Parar e transcrever");
  assert.equal(label("recording").enabled, true);
  for (const state of ["processing", "revising"]) {
    assert.equal(label(state).label, "Transcrevendo…");
    assert.equal(label(state).enabled, false);
  }
  assert.equal(label("meeting").label, "Ditado indisponível durante a reunião");
  assert.equal(label("meeting").enabled, false);
  for (const state of ["success", "error"]) {
    assert.equal(label(state).label, "Iniciar ditado");
  }
});

test("submenu marca o modo de revisão atual e troca ao clicar", () => {
  const { value, calls } = input({ revisionMode: "prompt" });
  const submenu = buildTrayTemplate(value)[2].submenu;
  assert.deepEqual(
    submenu.map((item) => [item.label, item.type, item.checked]),
    [["Literal", "radio", false], ["Prompt para IA", "radio", true]],
  );
  submenu[0].click();
  assert.deepEqual(calls, ["revision:literal"]);
});

// O menu escrevia "Ctrl + Win" fixo no código.
test("linhas informativas usam os atalhos reais", () => {
  const template = buildTrayTemplate(input({
    hotkey: { ready: true, display: "Ctrl + Alt" },
    repaste: { registered: true, disabled: false, display: "Ctrl+Alt+B" },
  }).value);
  assert.ok(byLabel(template, "Ditado: Ctrl + Alt (2× ou segurar)"));
  assert.ok(byLabel(template, "Colar última: Ctrl+Alt+B"));
  assert.ok(byLabel(template, "Modelo: Parakeet TDT 0.6B v3"));

  const off = buildTrayTemplate(input({
    hotkey: { ready: false, display: "Ctrl + Win" },
    shortcut: { registered: false, display: "Ctrl+Shift+Espaço" },
    repaste: { registered: false, disabled: true, display: "Desativado" },
  }).value);
  assert.ok(byLabel(off, "Ditado: Ctrl + Win indisponível"));
  assert.ok(byLabel(off, "Atalho alternativo indisponível"));
  assert.ok(byLabel(off, "Colar última: desativado"));
});

test("painel e sair continuam no menu", () => {
  const { value, calls } = input({ dashboardVisible: true });
  const template = buildTrayTemplate(value);
  byLabel(template, "Abrir Local Flow").click();
  byLabel(template, "Ocultar painel").click();
  byLabel(template, "Sair").click();
  assert.deepEqual(calls, ["showDashboard", "toggleDashboard", "quit"]);
  assert.ok(byLabel(buildTrayTemplate(input().value), "Mostrar painel"));
});
