const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ToggleDictationController,
} = require("../src/main/shortcut-controller.cjs");

test("primeiro toque inicia e segundo encerra", async () => {
  let now = 1000;
  const events = [];
  const controller = new ToggleDictationController({
    clock: () => now,
    captureTarget: async () => ({ hwnd: "42" }),
    onStart: async (target) => events.push(["start", target.hwnd]),
    onStop: async (target) => events.push(["stop", target.hwnd]),
  });

  assert.equal((await controller.toggle()).action, "start");
  assert.equal(controller.state, "recording");
  now += 500;
  assert.equal((await controller.toggle()).action, "stop");
  assert.equal(controller.state, "processing");
  controller.complete();
  assert.equal(controller.state, "idle");
  assert.deepEqual(events, [
    ["start", "42"],
    ["stop", "42"],
  ]);
});

test("ignora repetição automática dentro do debounce", async () => {
  let now = 1000;
  const controller = new ToggleDictationController({
    clock: () => now,
    captureTarget: async () => ({ hwnd: "1" }),
    onStart: async () => {},
    onStop: async () => {},
  });

  await controller.toggle();
  now += 100;
  const result = await controller.toggle();
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "debounce");
  assert.equal(controller.state, "recording");
});

test("não aceita terceiro toque durante processamento", async () => {
  let now = 1000;
  const controller = new ToggleDictationController({
    clock: () => now,
    captureTarget: async () => ({ hwnd: "1" }),
    onStart: async () => {},
    onStop: async () => {},
  });

  await controller.toggle();
  now += 500;
  await controller.toggle();
  now += 500;
  const result = await controller.toggle();
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "busy");
});
