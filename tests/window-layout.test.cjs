const assert = require("node:assert/strict");
const test = require("node:test");
const {
  calculateCapsuleBounds,
} = require("../src/main/window-layout.cjs");
const { normalizeUiState } = require("../src/main/ui-state.cjs");
const { WindowManager } = require("../src/main/services/window-manager.cjs");

test("posiciona cápsula no centro inferior da área útil", () => {
  assert.deepEqual(
    calculateCapsuleBounds(
      { x: 0, y: 0, width: 1920, height: 1040 },
      { width: 420, height: 82, margin: 24 },
    ),
    { x: 750, y: 934, width: 420, height: 82 },
  );
});

test("posiciona cápsula no topo quando ancorada em cima", () => {
  assert.deepEqual(
    calculateCapsuleBounds(
      { x: 0, y: 0, width: 1920, height: 1040 },
      { width: 420, height: 82, margin: 24, anchor: "top" },
    ),
    { x: 750, y: 24, width: 420, height: 82 },
  );
});

test("respeita origem de monitor secundário", () => {
  assert.deepEqual(
    calculateCapsuleBounds(
      { x: -1280, y: 120, width: 1280, height: 984 },
      { width: 420, height: 82, margin: 20 },
    ),
    { x: -850, y: 1002, width: 420, height: 82 },
  );
});

test("normaliza estado recebido pelo renderer", () => {
  assert.deepEqual(
    normalizeUiState({
      state: "recording",
      profile: "fast",
      message: "Ouvindo",
      elapsedMs: -10,
      level: 4,
    }),
    {
      state: "recording",
      profile: "fast",
      message: "Ouvindo",
      elapsedMs: 0,
      level: 1,
      manualPaste: false,
      hint: null,
      remainingMs: 0,
      locked: false,
    },
  );
});

// Colou, só copiou e falhou em colar terminavam no mesmo pulso. A cápsula só
// pode avisar "use Ctrl+V" se o sinal sobreviver à normalização, e só como
// booleano estrito: qualquer outro valor vindo do renderer vira false.
test("preserva o aviso de colagem manual só como booleano", () => {
  assert.equal(
    normalizeUiState({ state: "success", manualPaste: true }).manualPaste,
    true,
  );
  assert.equal(
    normalizeUiState({ state: "success", manualPaste: "yes" }).manualPaste,
    false,
  );
  assert.equal(normalizeUiState({ state: "success" }).manualPaste, false);
});

test("descarta estado e perfil desconhecidos", () => {
  const result = normalizeUiState({
    state: "hacked",
    profile: "..",
  });
  assert.equal(result.state, "idle");
  assert.equal(result.profile, "standard");
});

test("aceita o estado de reunião com tempo e nível", () => {
  const result = normalizeUiState({
    state: "meeting",
    elapsedMs: 42000,
    level: 0.6,
  });
  assert.equal(result.state, "meeting");
  assert.equal(result.elapsedMs, 42000);
  assert.equal(result.level, 0.6);
});

// A cápsula distingue as duas etapas do pós-gravação (Whisper × LLM local), o
// que só funciona se "revising" sobreviver à normalização em vez de virar
// "idle" como qualquer estado desconhecido.
test("preserva as duas etapas do processamento", () => {
  assert.equal(
    normalizeUiState({ state: "processing" }).state,
    "processing",
  );
  assert.equal(normalizeUiState({ state: "revising" }).state, "revising");
});

test("cápsula acompanha o monitor do cursor sem mover ou ativar a janela a cada amostra", () => {
  const primary = {
    id: 1,
    workArea: { x: 0, y: 0, width: 2560, height: 1040 },
  };
  const secondary = {
    id: 2,
    workArea: { x: 2560, y: -234, width: 1440, height: 770 },
  };
  let displays = [primary, secondary];
  let cursor = { x: 3000, y: 100 };
  const screen = {
    getCursorScreenPoint: () => cursor,
    getDisplayNearestPoint: (point) =>
      displays.find((display) =>
        point.x >= display.workArea.x &&
        point.x < display.workArea.x + display.workArea.width,
      ) || displays[0],
    getAllDisplays: () => displays,
    getDisplayMatching: () => primary,
    getPrimaryDisplay: () => primary,
  };
  const positions = [];
  let shows = 0;
  let focusCalls = 0;
  const capsule = {
    isDestroyed: () => false,
    setBounds: (bounds) => positions.push(bounds),
    setIgnoreMouseEvents: () => {},
    showInactive: () => { shows++; },
    focus: () => { focusCalls++; },
    webContents: { send: () => {} },
  };
  const manager = new WindowManager({ displayScreen: screen });
  manager.capsuleWindow = capsule;
  manager.dashboardWindow = {
    isDestroyed: () => false,
    getBounds: () => ({ x: 100, y: 100, width: 820, height: 720 }),
  };
  try {
    manager.positionCapsule();
    assert.deepEqual(positions.at(-1), { x: 1156, y: 2, width: 248, height: 78 });

    manager.applyUiState({ state: "recording", source: "dictation" });
    assert.ok(manager.capsuleCursorPoll);
    assert.deepEqual(positions.at(-1), { x: 3156, y: -232, width: 248, height: 78 });

    const count = positions.length;
    const showCount = shows;
    cursor = { x: 3800, y: 50 };
    manager.positionCapsule();
    manager.applyUiState({ state: "recording", source: "dictation", level: 0.5 });
    assert.equal(positions.length, count);
    assert.equal(shows, showCount + 1); // só o update de UI; polling não mostra novamente
    assert.equal(focusCalls, 0);

    cursor = { x: 200, y: 100 };
    manager.positionCapsule();
    assert.deepEqual(positions.at(-1), { x: 1156, y: 2, width: 248, height: 78 });

    manager.applyUiState({ state: "success", source: "dictation" });
    assert.equal(manager.capsuleCursorPoll, null);
    cursor = { x: 3000, y: 100 };
    manager.positionCapsule();
    assert.deepEqual(positions.at(-1), { x: 1156, y: 2, width: 248, height: 78 });

    manager.applyUiState({ state: "meeting" });
    assert.ok(manager.capsuleCursorPoll);
    assert.deepEqual(positions.at(-1), { x: 3156, y: -232, width: 248, height: 78 });
    manager.applyUiState({ state: "processing" });
    assert.ok(manager.capsuleCursorPoll);
    displays = [primary];
    manager.positionCapsule({ force: true });
    assert.deepEqual(positions.at(-1), { x: 1156, y: 2, width: 248, height: 78 });
    displays = [primary, secondary];
    manager.positionCapsule();
    assert.deepEqual(positions.at(-1), { x: 3156, y: -232, width: 248, height: 78 });

    manager.applyUiState({ state: "idle" });
    assert.equal(manager.capsuleCursorPoll, null);
    displays = [primary];
    manager.positionCapsule({ force: true });
    assert.deepEqual(positions.at(-1), { x: 1156, y: 2, width: 248, height: 78 });
  } finally {
    manager.beginQuit();
  }
});

test("recriação da cápsula reposiciona a nova janela mesmo com bounds iguais", () => {
  const display = {
    id: 7,
    workArea: { x: -1440, y: -200, width: 1440, height: 800 },
  };
  const screen = {
    getAllDisplays: () => [display],
    getPrimaryDisplay: () => display,
  };
  class FakeBrowserWindow {
    constructor() {
      this.positions = [];
      this.events = new Map();
      this.webContents = {
        setWindowOpenHandler: () => {},
        on: () => {},
        once: () => {},
      };
    }
    isDestroyed() { return false; }
    setAlwaysOnTop() {}
    setIgnoreMouseEvents() {}
    setBounds(bounds) { this.positions.push(bounds); }
    loadFile() {}
    on(name, handler) { this.events.set(name, handler); }
  }
  const manager = new WindowManager({
    projectRoot: process.cwd(),
    displayScreen: screen,
    BrowserWindowClass: FakeBrowserWindow,
  });
  manager.createCapsule();
  const oldWindow = manager.capsuleWindow;
  assert.deepEqual(oldWindow.positions, [{ x: -844, y: -198, width: 248, height: 78 }]);
  manager.createCapsule();
  const replacement = manager.capsuleWindow;
  assert.notEqual(oldWindow, replacement);
  assert.deepEqual(replacement.positions, oldWindow.positions);
  oldWindow.events.get("closed")();
  assert.equal(manager.capsuleWindow, replacement);
  manager.beginQuit();
});

function fakeCapsuleManager() {
  const display = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
  const screen = {
    getAllDisplays: () => [display],
    getPrimaryDisplay: () => display,
  };
  const mouse = [];
  const sent = [];
  const capsule = {
    isDestroyed: () => false,
    setBounds: () => {},
    setIgnoreMouseEvents: (ignore, options) =>
      mouse.push(options?.forward ? "forward" : ignore ? "ignore" : "accept"),
    showInactive: () => {},
    webContents: { send: (_channel, state) => sent.push(state.state) },
  };
  const manager = new WindowManager({ displayScreen: screen });
  manager.capsuleWindow = capsule;
  return { manager, mouse, sent };
}

// Colou de fato: o pulso curto basta e a cápsula nunca intercepta cliques.
test("sucesso com colagem some rápido e continua transparente ao mouse", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { manager, mouse, sent } = fakeCapsuleManager();
  manager.applyUiState({ state: "success" });
  assert.equal(mouse.at(-1), "ignore");
  manager.setCapsuleHover(true);
  assert.equal(mouse.at(-1), "ignore");
  t.mock.timers.tick(700);
  assert.equal(sent.at(-1), "idle");
  manager.beginQuit();
});

// Só copiou ou a colagem falhou: o aviso "Ctrl+V" fica tempo suficiente para
// ser lido e passa a aceitar o mouse só quando o cursor está sobre a pílula.
test("aviso de Ctrl+V dura mais e pausa enquanto o mouse está em cima", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { manager, mouse, sent } = fakeCapsuleManager();
  manager.applyUiState({ state: "success", manualPaste: true });
  assert.equal(mouse.at(-1), "forward");
  t.mock.timers.tick(1000);
  assert.equal(sent.at(-1), "success");

  manager.setCapsuleHover(true);
  assert.equal(mouse.at(-1), "accept");
  t.mock.timers.tick(10_000);
  assert.equal(sent.at(-1), "success");

  manager.setCapsuleHover(false);
  assert.equal(mouse.at(-1), "forward");
  t.mock.timers.tick(1199);
  assert.equal(sent.at(-1), "success");
  t.mock.timers.tick(1);
  assert.equal(sent.at(-1), "idle");
  assert.equal(mouse.at(-1), "ignore");
  manager.beginQuit();
});

test("erro fica visível para leitura e não some com o mouse em cima", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { manager, mouse, sent } = fakeCapsuleManager();
  manager.applyUiState({ state: "error", message: "Nenhum áudio foi capturado." });
  assert.equal(mouse.at(-1), "forward");
  t.mock.timers.tick(3000);
  assert.equal(sent.at(-1), "error");
  manager.setCapsuleHover(true);
  t.mock.timers.tick(60_000);
  assert.equal(sent.at(-1), "error");
  manager.setCapsuleHover(false);
  t.mock.timers.tick(1200);
  assert.equal(sent.at(-1), "idle");
  manager.beginQuit();
});

// Um estado novo (outro ditado começando) não pode herdar a pausa do anterior,
// e o mouse saindo depois não pode agendar o sumiço do estado novo.
test("estado novo descarta a pausa do mouse", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { manager, mouse, sent } = fakeCapsuleManager();
  manager.applyUiState({ state: "error", message: "boom" });
  manager.setCapsuleHover(true);
  manager.applyUiState({ state: "recording" });
  assert.equal(mouse.at(-1), "ignore");
  manager.setCapsuleHover(false);
  assert.equal(mouse.at(-1), "ignore");
  t.mock.timers.tick(10_000);
  assert.equal(sent.at(-1), "recording");
  manager.beginQuit();
});

test("sem auto-hide, sair com o mouse não agenda o sumiço", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { manager, sent } = fakeCapsuleManager();
  manager.applyUiState({ state: "error", message: "boom" }, { autoHide: false });
  manager.setCapsuleHover(true);
  manager.setCapsuleHover(false);
  t.mock.timers.tick(60_000);
  assert.equal(sent.at(-1), "error");
  manager.beginQuit();
});

// Um mouseleave sem mouseenter anterior (hover velho do Chromium) não pode
// encurtar o tempo de leitura do erro.
test("saída do mouse sem entrada não encurta o tempo do aviso", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { manager, sent } = fakeCapsuleManager();
  manager.applyUiState({ state: "error", message: "boom" });
  manager.setCapsuleHover(false);
  t.mock.timers.tick(3000);
  assert.equal(sent.at(-1), "error");
  t.mock.timers.tick(1000);
  assert.equal(sent.at(-1), "idle");
  manager.beginQuit();
});

// A dica da gravação só passa com os valores conhecidos; o tempo restante
// nunca fica negativo.
test("normaliza a dica da gravação e o tempo restante", () => {
  const countdown = normalizeUiState({ state: "recording", hint: "countdown", remainingMs: 4200 });
  assert.equal(countdown.hint, "countdown");
  assert.equal(countdown.remainingMs, 4200);
  assert.equal(normalizeUiState({ state: "recording", hint: "silent" }).hint, "silent");
  assert.equal(normalizeUiState({ state: "recording", hint: "esc" }).hint, "esc");
  assert.equal(normalizeUiState({ state: "recording", hint: "<b>" }).hint, null);
  assert.equal(normalizeUiState({ state: "recording", remainingMs: -5 }).remainingMs, 0);
});

// O menu da bandeja era remontado a cada atualização de nível do microfone
// (até 12×/s durante a gravação). Só muda quando algo visível nele muda.
test("menu da bandeja só é remontado quando o conteúdo muda", () => {
  const built = [];
  const MenuClass = { buildFromTemplate: (template) => ({ template }) };
  const manager = new WindowManager({ displayScreen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({}) }, MenuClass });
  manager.capsuleWindow = {
    isDestroyed: () => false,
    setBounds: () => {},
    setIgnoreMouseEvents: () => {},
    showInactive: () => {},
    webContents: { send: () => {} },
  };
  manager.tray = { setContextMenu: (menu) => built.push(menu.template) };
  manager.setTrayActions({
    toggleDictation: () => {},
    copyLast: () => {},
    setRevisionMode: () => {},
  });
  manager.setRevisionMode("literal", [{ value: "literal", label: "Literal" }]);
  const afterSetup = built.length;

  manager.applyUiState({ state: "recording", level: 0.2 });
  manager.applyUiState({ state: "recording", level: 0.6 });
  manager.applyUiState({ state: "recording", level: 0.4, elapsedMs: 900 });
  assert.equal(built.length, afterSetup + 1);
  assert.equal(built.at(-1)[0].label, "Parar e transcrever");

  manager.setProfile("standard");
  assert.equal(built.length, afterSetup + 1);
  manager.applyUiState({ state: "processing" });
  assert.equal(built.at(-1)[0].label, "Transcrevendo…");
  manager.setRevisionMode("prompt");
  assert.equal(built.length, afterSetup + 3);
  manager.beginQuit();
});

test("normaliza o cadeado da gravação como booleano estrito", () => {
  assert.equal(normalizeUiState({ state: "recording", locked: true }).locked, true);
  assert.equal(normalizeUiState({ state: "recording", locked: "sim" }).locked, false);
  assert.equal(normalizeUiState({ state: "recording" }).locked, false);
});
