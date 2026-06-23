const assert = require("node:assert/strict");
const test = require("node:test");
const {
  calculateCapsuleBounds,
} = require("../src/main/window-layout.cjs");
const { normalizeUiState } = require("../src/main/ui-state.cjs");

test("posiciona cápsula no centro inferior da área útil", () => {
  assert.deepEqual(
    calculateCapsuleBounds(
      { x: 0, y: 0, width: 1920, height: 1040 },
      { width: 420, height: 82, margin: 24 },
    ),
    { x: 750, y: 934, width: 420, height: 82 },
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
