import test from "node:test";
import assert from "node:assert/strict";

function fakeStream() {
  return { getTracks: () => [{ stop() {} }] };
}

function installBrowser({ getUserMedia, getDisplayMedia, append = async () => ({}) } = {}) {
  const events = [];
  let started = 0;
  let saved;
  let worklet;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { mediaDevices: {
      getUserMedia: getUserMedia || (async () => fakeStream()),
      getDisplayMedia,
    } },
  });
  globalThis.window = { localFlow: {
    startMeetingCaptureSession: async () => { started++; return { id: "session" }; },
    appendMeetingCaptureChunk: append,
    saveMeetingCapture: async (payload) => { saved = payload; return { dir: "fixture" }; },
    reportMeetingEvent: (event) => events.push(event),
    updateUiState: () => {},
  } };
  globalThis.AudioContext = class {
    constructor() {
      this.sampleRate = 48000;
      this.audioWorklet = { addModule: async () => {} };
      this.destination = {};
      this.state = "running";
    }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createGain() { return { gain: { value: 0 }, connect() {}, disconnect() {} }; }
    async close() { this.state = "closed"; }
  };
  globalThis.AudioWorkletNode = class {
    constructor() { this.port = { onmessage: null }; worklet = this; }
    connect() {}
    disconnect() {}
  };
  return { events, get started() { return started; },
    get saved() { return saved; }, get worklet() { return worklet; } };
}

async function recorder() {
  return import(`../src/renderer/meeting-recorder.js?test=${Math.random()}`);
}

test("stop durante permissão pendente encerra depois que start termina", async () => {
  let allowMicrophone;
  const media = new Promise((resolve) => { allowMicrophone = resolve; });
  const browser = installBrowser({ getUserMedia: () => media });
  const module = await recorder();
  const starting = module.startMeetingCapture({ mode: "mic" });
  await module.stopMeetingCapture();
  allowMicrophone(fakeStream());
  await starting;
  for (let attempt = 0; attempt < 20 && !browser.saved; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(module.isMeetingCapturing(), false);
  assert.equal(browser.saved.id, "session");
});

test("modo só sistema recusa fonte sem trilha de áudio antes de criar sessão", async () => {
  const video = { stop() {} };
  const browser = installBrowser({
    getDisplayMedia: async () => ({
      getVideoTracks: () => [video],
      getAudioTracks: () => [],
      getTracks: () => [video],
    }),
  });
  const module = await recorder();
  await assert.rejects(() => module.startMeetingCapture({ mode: "system" }), /não forneceu áudio/);
  assert.equal(browser.started, 0);
  assert.equal(module.isMeetingCapturing(), false);
  assert.equal(browser.events.some((event) => event.type === "error"), true);
});

test("falha ao salvar bloco encerra captura e preserva blocos já persistidos", async () => {
  const browser = installBrowser({ append: async () => { throw new Error("disk full"); } });
  const module = await recorder();
  await module.startMeetingCapture({ mode: "mic" });
  browser.worklet.port.onmessage({ data: { samples: new Float32Array(1024), peak: 0 } });
  await module.stopMeetingCapture();
  assert.equal(module.isMeetingCapturing(), false);
  assert.equal(browser.saved.interrupted, true);
  assert.equal(browser.events.some((event) => event.type === "error"), true);
});

test("blocos sucessivos de 10 s preservam as novas amostras do worklet", async () => {
  const timers = new Map();
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  let nextTimerId = 0;
  globalThis.setInterval = (callback, delay) => {
    const id = ++nextTimerId;
    timers.set(id, { callback, delay });
    return id;
  };
  globalThis.clearInterval = (id) => { timers.delete(id); };

  const written = [];
  const browser = installBrowser({ append: async (payload) => {
    written.push(payload);
    return {};
  } });
  const module = await recorder();
  try {
    await module.startMeetingCapture({ mode: "mic" });
    const tenSecondTick = [...timers.values()].find((timer) => timer.delay === 10_000)?.callback;
    assert.equal(typeof tenSecondTick, "function");

    browser.worklet.port.onmessage({
      data: { samples: new Float32Array(480).fill(0.25), peak: 0.25 },
    });
    tenSecondTick();
    await new Promise((resolve) => setImmediate(resolve));

    browser.worklet.port.onmessage({
      data: { samples: new Float32Array(480).fill(0.5), peak: 0.5 },
    });
    tenSecondTick();
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(written.map(({ index }) => index), [0, 1]);
    assert.equal(written[0].micWav.byteLength, 44 + 160 * 2);
    assert.equal(written[1].micWav.byteLength, 44 + 160 * 2);
    const first = new DataView(written[0].micWav.buffer).getInt16(44, true);
    const second = new DataView(written[1].micWav.buffer).getInt16(44, true);
    assert.ok(first > 7_000 && first < 9_000, `primeiro bloco: ${first}`);
    assert.ok(second > 15_000 && second < 17_000, `segundo bloco: ${second}`);
  } finally {
    if (module.isMeetingCapturing()) await module.stopMeetingCapture();
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});
