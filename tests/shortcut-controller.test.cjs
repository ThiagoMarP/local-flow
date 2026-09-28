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

test("destrava quando o renderer voltou ao repouso após uma falha", async () => {
  let now = 1000;
  const events = [];
  const controller = new ToggleDictationController({
    clock: () => now,
    captureTarget: async () => ({ hwnd: "7" }),
    onStart: async () => events.push("start"),
    onStop: async () => events.push("stop"),
  });

  await controller.toggle(); // start -> recording
  controller.notifyRendererState("recording");
  now += 500;
  await controller.toggle(); // stop -> processing
  assert.equal(controller.state, "processing");

  // O ditado não gerou áudio: o renderer voltou ao repouso (erro), mas nenhum
  // complete() chegou. Sem a recuperação o controller ficaria preso.
  controller.notifyRendererState("error");
  now += 500;
  const result = await controller.toggle();
  assert.equal(result.action, "start");
  assert.equal(controller.state, "recording");
  assert.deepEqual(events, ["start", "stop", "start"]);
});

test("não destrava enquanto o renderer ainda transcreve", async () => {
  let now = 1000;
  const controller = new ToggleDictationController({
    clock: () => now,
    captureTarget: async () => ({ hwnd: "7" }),
    onStart: async () => {},
    onStop: async () => {},
  });

  await controller.toggle();
  controller.notifyRendererState("recording");
  now += 500;
  await controller.toggle(); // -> processing
  controller.notifyRendererState("processing");
  now += 500;
  const result = await controller.toggle();
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "busy");
  assert.equal(controller.state, "processing");
});

test("recomeça quando o início nunca chegou ao renderer", async () => {
  let now = 1000;
  const events = [];
  const controller = new ToggleDictationController({
    clock: () => now,
    captureTarget: async () => ({ hwnd: "7" }),
    onStart: async () => events.push("start"),
    onStop: async () => events.push("stop"),
  });

  await controller.toggle(); // start -> recording, mas o renderer ignorou
  controller.notifyRendererState("idle");
  now += 500;
  const result = await controller.toggle();
  assert.equal(result.action, "start");
  assert.equal(controller.state, "recording");
  assert.deepEqual(events, ["start", "start"]);
});

test("descarte solta o atalho e a liberação da tecla não transcreve", async () => {
  const events = [];
  const controller = new ToggleDictationController({
    captureTarget: async () => ({ hwnd: "7" }),
    onStart: async () => events.push("start"),
    onStop: async () => events.push("stop"),
  });

  await controller.start();
  controller.fail(); // dictation:event cancelled, enviado pelo botão Descartar
  const release = await controller.stop(); // onHoldStop do Ctrl+Win

  assert.equal(controller.state, "idle");
  assert.equal(release.accepted, false);
  assert.deepEqual(events, ["start"]);
});

test("Escape durante busca da janela impede início tardio", async () => {
  let resolveTarget;
  const events = [];
  const controller = new ToggleDictationController({
    captureTarget: () => new Promise((resolve) => { resolveTarget = resolve; }),
    onStart: async () => events.push("start"),
    onStop: async () => events.push("stop"),
  });

  const start = controller.start();
  assert.equal(controller.state, "starting");
  controller.fail();
  resolveTarget({ hwnd: "7" });
  const result = await start;
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "cancelled");
  assert.equal(controller.state, "idle");
  assert.deepEqual(events, []);
});

test("resultado tardio do ditado A não assume o controle do ditado B", async () => {
  let nextTarget = 0;
  const controller = new ToggleDictationController({
    captureTarget: async () => ({ hwnd: String(++nextTarget) }),
    onStart: async () => {},
    onStop: async () => {},
  });

  await controller.start();
  await controller.stop();
  const generationA = controller.generation;
  const targetA = controller.target;
  assert.equal(controller.ownsProcessing(generationA, targetA), true);

  controller.fail(); // Escape cancelou A, mas o subprocesso ainda pode encerrar depois.
  await controller.start();
  assert.equal(controller.ownsProcessing(generationA, targetA), false);
  await controller.stop();
  assert.equal(controller.ownsProcessing(generationA, targetA), false);
  assert.equal(controller.ownsProcessing(controller.generation, controller.target), true);
});
