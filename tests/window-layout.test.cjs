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
    },
  );
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
    assert.deepEqual(positions.at(-1), { x: 1196, y: 2, width: 168, height: 78 });

    manager.applyUiState({ state: "recording", source: "dictation" });
    assert.ok(manager.capsuleCursorPoll);
    assert.deepEqual(positions.at(-1), { x: 3196, y: -232, width: 168, height: 78 });

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
    assert.deepEqual(positions.at(-1), { x: 1196, y: 2, width: 168, height: 78 });

    manager.applyUiState({ state: "success", source: "dictation" });
    assert.equal(manager.capsuleCursorPoll, null);
    cursor = { x: 3000, y: 100 };
    manager.positionCapsule();
    assert.deepEqual(positions.at(-1), { x: 1196, y: 2, width: 168, height: 78 });

    manager.applyUiState({ state: "meeting" });
    assert.ok(manager.capsuleCursorPoll);
    assert.deepEqual(positions.at(-1), { x: 3196, y: -232, width: 168, height: 78 });
    manager.applyUiState({ state: "processing" });
    assert.ok(manager.capsuleCursorPoll);
    displays = [primary];
    manager.positionCapsule({ force: true });
    assert.deepEqual(positions.at(-1), { x: 1196, y: 2, width: 168, height: 78 });
    displays = [primary, secondary];
    manager.positionCapsule();
    assert.deepEqual(positions.at(-1), { x: 3196, y: -232, width: 168, height: 78 });

    manager.applyUiState({ state: "idle" });
    assert.equal(manager.capsuleCursorPoll, null);
    displays = [primary];
    manager.positionCapsule({ force: true });
    assert.deepEqual(positions.at(-1), { x: 1196, y: 2, width: 168, height: 78 });
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
  assert.deepEqual(oldWindow.positions, [{ x: -804, y: -198, width: 168, height: 78 }]);
  manager.createCapsule();
  const replacement = manager.capsuleWindow;
  assert.notEqual(oldWindow, replacement);
  assert.deepEqual(replacement.positions, oldWindow.positions);
  oldWindow.events.get("closed")();
  assert.equal(manager.capsuleWindow, replacement);
  manager.beginQuit();
});
