const assert = require("node:assert/strict");
const test = require("node:test");
const { HotkeyController } = require("../src/main/hotkey-controller.cjs");

// Deterministic timer scheduler so the gesture timing is fully reproducible.
function createScheduler() {
  let now = 0;
  let seq = 0;
  const tasks = new Map();
  return {
    setTimer: (fn, delay) => {
      const id = ++seq;
      tasks.set(id, { fn, at: now + delay });
      return id;
    },
    clearTimer: (id) => tasks.delete(id),
    advance: (ms) => {
      const target = now + ms;
      while (true) {
        let next = null;
        for (const [id, task] of tasks) {
          if (task.at <= target && (next === null || task.at < next.at)) {
            next = { id, ...task };
          }
        }
        if (!next) break;
        now = next.at;
        tasks.delete(next.id);
        next.fn();
      }
      now = target;
    },
  };
}

function createController(overrides = {}) {
  const scheduler = createScheduler();
  const events = [];
  const controller = new HotkeyController({
    onHoldStart: () => events.push("hold-start"),
    onHoldStop: () => events.push("hold-stop"),
    onLockToggle: () => events.push("lock-toggle"),
    onSingleTap: () => events.push("single-tap"),
    holdThresholdMs: 200,
    doubleTapWindowMs: 300,
    setTimer: scheduler.setTimer,
    clearTimer: scheduler.clearTimer,
    ...overrides,
  });
  return { controller, scheduler, events };
}

test("segurar dispara push-to-talk e solta ao liberar", () => {
  const { controller, scheduler, events } = createController();
  controller.pressDown();
  scheduler.advance(250); // passa do limite de hold
  assert.deepEqual(events, ["hold-start"]);
  controller.pressUp();
  assert.deepEqual(events, ["hold-start", "hold-stop"]);
});

test("toque duplo rápido alterna o modo fixo", () => {
  const { controller, scheduler, events } = createController();
  controller.pressDown();
  scheduler.advance(40);
  controller.pressUp();
  scheduler.advance(80); // dentro da janela de toque duplo
  controller.pressDown();
  scheduler.advance(40);
  controller.pressUp();
  assert.deepEqual(events, ["lock-toggle"]);
});

test("toque único isolado é ignorado", () => {
  const { controller, scheduler, events } = createController();
  controller.pressDown();
  scheduler.advance(40);
  controller.pressUp();
  scheduler.advance(400); // expira a janela de toque duplo
  assert.deepEqual(events, ["single-tap"]);
});

test("segundo toque mantido vira push-to-talk, não toque duplo", () => {
  const { controller, scheduler, events } = createController();
  controller.pressDown();
  scheduler.advance(40);
  controller.pressUp(); // primeiro toque
  scheduler.advance(60);
  controller.pressDown();
  scheduler.advance(250); // segura além do limite de hold
  assert.deepEqual(events, ["hold-start"]);
  controller.pressUp();
  assert.deepEqual(events, ["hold-start", "hold-stop"]);
});

test("reset cancela gestos pendentes sem disparar callbacks", () => {
  const { controller, scheduler, events } = createController();
  controller.pressDown();
  controller.reset();
  scheduler.advance(500);
  assert.deepEqual(events, []);
  // após reset, um novo gesto funciona normalmente
  controller.pressDown();
  scheduler.advance(250);
  assert.deepEqual(events, ["hold-start"]);
});

test("dois toques duplos alternam ligado e desligado", () => {
  const { controller, scheduler, events } = createController();
  for (let i = 0; i < 2; i += 1) {
    controller.pressDown();
    scheduler.advance(30);
    controller.pressUp();
    scheduler.advance(50);
    controller.pressDown();
    scheduler.advance(30);
    controller.pressUp();
    scheduler.advance(400);
  }
  assert.deepEqual(events, ["lock-toggle", "lock-toggle"]);
});
