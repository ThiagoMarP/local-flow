import assert from "node:assert/strict";
import test from "node:test";

// Minimal stand-ins for the Web Audio and getUserMedia pieces the module uses.
function installFakes({ openDelayMs = 0, failWith = null } = {}) {
  const streams = [];
  const contexts = [];
  globalThis.window = globalThis;
  const navigator = {
    mediaDevices: {
      getUserMedia: async () => {
        await new Promise((resolve) => setTimeout(resolve, openDelayMs));
        if (failWith) throw failWith;
        const track = { stopped: false, stop() { this.stopped = true; } };
        const stream = { track, getTracks: () => [track] };
        streams.push(stream);
        return stream;
      },
    },
  };
  // Node 21+ ships a read-only global navigator.
  Object.defineProperty(globalThis, "navigator", { value: navigator, configurable: true });
  class FakeContext {
    constructor() {
      this.state = "running";
      this.sampleRate = 1000;
      this.destination = {};
      this.audioWorklet = { addModule: async () => {} };
      contexts.push(this);
    }
    createGain() { return { gain: {}, connect() {} }; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    async resume() { this.state = "running"; }
    async suspend() { this.state = "suspended"; }
    async close() { this.state = "closed"; }
  }
  globalThis.AudioContext = FakeContext;
  globalThis.AudioWorkletNode = class {
    constructor() {
      this.port = { postMessage() {}, onmessage: null };
      FakeContext.lastNode = this;
    }
    connect() {}
  };
  const emit = (count) => {
    for (let index = 0; index < count; index++) {
      FakeContext.lastNode.port.onmessage({
        data: { samples: new Float32Array(100), peak: 0.1, rms: 0.05 },
      });
    }
  };
  return { streams, contexts, emit };
}

const { createMicrophone } = await import("../src/renderer/microphone.js");
const attempts = [{ audio: true }];
const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

test("o áudio ouvido entre a pressão e o início vira pré-gravação", async () => {
  const fakes = installFakes();
  const frames = [];
  const microphone = createMicrophone({ onFrame: (frame) => frames.push(frame) });
  microphone.prepare(attempts);
  await tick();
  // 1000 Hz e 500 ms de pré-gravação: só os últimos 5 quadros de 100 amostras.
  fakes.emit(8);
  const preroll = await microphone.start(attempts, () => true);
  assert.equal(preroll.length, 5);
  fakes.emit(2);
  assert.equal(frames.length, 2);
  assert.equal(fakes.streams.length, 1);
  microphone.stop();
  assert.equal(fakes.streams[0].track.stopped, true);
});

test("uma pressão sem ditado fecha o microfone", async () => {
  const fakes = installFakes();
  const microphone = createMicrophone({ onFrame: () => {} });
  microphone.prepare(attempts);
  await tick();
  microphone.release();
  assert.equal(fakes.streams[0].track.stopped, true);
});

test("soltar antes de o microfone abrir também o fecha quando ele chega", async () => {
  const fakes = installFakes({ openDelayMs: 20 });
  const microphone = createMicrophone({ onFrame: () => {} });
  microphone.prepare(attempts);
  microphone.release();
  await tick(40);
  assert.equal(fakes.streams.length, 1);
  assert.equal(fakes.streams[0].track.stopped, true);
});

test("início sem preparo abre o microfone na hora", async () => {
  const fakes = installFakes();
  const microphone = createMicrophone({ onFrame: () => {} });
  const preroll = await microphone.start(attempts, () => true);
  assert.deepEqual(preroll, []);
  assert.equal(fakes.streams.length, 1);
  assert.equal(fakes.streams[0].track.stopped, false);
});

test("ditado cancelado enquanto o microfone abre não deixa o microfone ligado", async () => {
  const fakes = installFakes({ openDelayMs: 20 });
  const microphone = createMicrophone({ onFrame: () => {} });
  let current = true;
  microphone.prepare(attempts);
  const started = microphone.start(attempts, () => current);
  current = false;
  microphone.stop();
  assert.equal(await started, null);
  assert.equal(fakes.streams[0].track.stopped, true);
});

test("falha no preparo reaparece no início para o usuário ver", async () => {
  const error = Object.assign(new Error("negado"), { name: "NotAllowedError" });
  installFakes({ failWith: error });
  const microphone = createMicrophone({ onFrame: () => {} });
  microphone.prepare(attempts);
  await assert.rejects(microphone.start(attempts, () => true), /negado/);
});

test("o contexto de áudio é reaproveitado entre ditados", async () => {
  const fakes = installFakes();
  const microphone = createMicrophone({ onFrame: () => {} });
  await microphone.start(attempts, () => true);
  microphone.stop();
  await tick();
  assert.equal(fakes.contexts[0].state, "suspended");
  await microphone.start(attempts, () => true);
  assert.equal(fakes.contexts.length, 1);
  assert.equal(fakes.contexts[0].state, "running");
});
