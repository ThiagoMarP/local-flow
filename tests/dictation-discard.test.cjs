const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// The renderer's ES module dependency, loaded once for the vm context below.
let realRecordingHint;
test.before(async () => {
  ({ recordingHint: realRecordingHint } = await import("../src/renderer/recording-hint.js"));
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function createRenderer(options = {}) {
  const elements = new Map();
  const events = [];
  const uiStates = [];
  const cancelCalls = [];
  const close = deferred();
  const cancelled = deferred();
  let worklet;
  let transcriptions = 0;
  let command;
  let keydown;
  let progressHandler;
  let nextRun = 0;

  function makeNode() {
    const listeners = new Map();
    return {
      textContent: "",
      value: "",
      children: [],
      style: {},
      disabled: false,
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener(type, listener) { listeners.set(type, listener); },
      dispatch(type) { return listeners.get(type)?.(); },
      append(...nodes) {
        for (const node of nodes) {
          node.parent = this;
          this.children.push(node);
        }
      },
      replaceChildren(...nodes) {
        this.children = [];
        this.append(...nodes);
      },
      after(node) {
        const siblings = this.parent?.children;
        if (!siblings) return;
        node.parent = this.parent;
        siblings.splice(siblings.indexOf(this) + 1, 0, node);
      },
      remove() {
        const siblings = this.parent?.children;
        if (siblings) siblings.splice(siblings.indexOf(this), 1);
      },
      setAttribute() {},
      focus() {},
    };
  }

  function element(selector) {
    if (!elements.has(selector)) {
      const node = makeNode();
      node.value = selector === "#profileSelect" ? "parakeet" : "";
      elements.set(selector, node);
    }
    return elements.get(selector);
  }

  const localFlow = {
    onDictationCommand(listener) { command = listener; },
    onMeetingCommand() {},
    onUiState() {},
    onTranscriptionProgress(listener) { progressHandler = listener; },
    onMeetingStatus() {},
    onNavigate() {},
    updateUiState(state) { uiStates.push(state); },
    reportDictationEvent(event) {
      events.push(event);
      if (event.type === "cancelled" && event.source === "manual") {
        cancelled.resolve();
      }
    },
    async transcribe(payload) {
      transcriptions += 1;
      if (options.transcribe) return options.transcribe(payload);
      throw new Error("Parada de teste após invocar a transcrição");
    },
    async cancelTranscription(runId) {
      cancelCalls.push(runId);
      return options.cancelTranscription?.(runId) || { accepted: true };
    },
    async getTranscriptionHistory() { return options.history || []; },
    async saveTranscriptionCorrection(id, text) {
      return options.saveCorrection?.(id, text);
    },
    async clearTranscriptionHistory() { return true; },
  };
  const context = vm.createContext({
    document: {
      querySelector: element,
      querySelectorAll: () => [],
      createElement: makeNode,
    },
    window: {
      localFlow,
      crypto: { randomUUID: () => `test-run-${++nextRun}` },
      addEventListener(type, listener) {
        if (type === "keydown") keydown = listener;
      },
      setInterval: () => 1,
      clearInterval() {},
      localStorage: options.localStorage || new Map(Object.entries({})),
      setTimeout,
      clearTimeout,
    },
    navigator: { mediaDevices: { getUserMedia: options.getUserMedia || (async () => ({
      getTracks: () => [{ stop() {} }],
    })) } },
    AudioContext: class {
      constructor() {
        this.state = "running";
        this.sampleRate = 48000;
        this.audioWorklet = { addModule: async () => {} };
        this.destination = {};
      }
      createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
      createGain() { return { gain: {}, connect() {}, disconnect() {} }; }
      async close() { await close.promise; this.state = "closed"; }
    },
    AudioWorkletNode: class {
      constructor() { this.port = { onmessage: null }; worklet = this; }
      connect() {}
      disconnect() {}
    },
    createSettingsController: () => ({
      setDisabled() {},
      get: () => ({ maxRecordingSeconds: 600 }),
      getDraft: () => ({ replacements: [], snippets: [] }),
    }),
    createSetupController: () => ({ setDisabled() {}, setActiveProfile() {} }),
    createMeetingsController: () => ({ refresh: async () => {} }),
    isMeetingCapturing: () => false,
    startMeetingCapture: async () => {},
    stopMeetingCapture: async () => {},
    joinAndEncode: () => new Uint8Array(64),
    recordingHint: (input) => realRecordingHint(input),
  });

  const source = fs.readFileSync(
    path.join(__dirname, "../src/renderer/renderer.js"), "utf8",
  );
  // Load the real renderer handlers, replacing only its imports and boot task.
  const body = source.slice(source.indexOf("const recordButton ="))
    .replace(/\s*initialize\(\);\s*$/, "");
  vm.runInContext(body, context, { filename: "renderer.js" });

  return {
    element,
    showLast(record) {
      context.testLastRecord = record;
      vm.runInContext("setLastMessage(testLastRecord)", context);
    },
    loadHistory() { return vm.runInContext("loadHistory()", context); },
    evaluate(code) { return vm.runInContext(code, context); },
    get worklet() { return worklet; },
    get command() { return command; },
    get transcriptions() { return transcriptions; },
    get uiStates() { return uiStates; },
    get cancelCalls() { return cancelCalls; },
    keydown(key = "Escape") {
      let prevented = false;
      keydown?.({
        key,
        repeat: false,
        preventDefault() { prevented = true; },
        stopPropagation() {},
      });
      return prevented;
    },
    progress(update) { progressHandler?.(update); },
    events,
    close,
    cancelled,
  };
}

function addVoicedAudio(renderer) {
  for (let index = 0; index < 5; index++) {
    renderer.worklet.port.onmessage({
      data: { samples: new Float32Array(480).fill(0.2), peak: 0.2, rms: 0.1 },
    });
  }
}

test("controle: stop global de gravação ativa invoca a transcrição", async () => {
  const renderer = createRenderer();
  await renderer.element("#recordButton").dispatch("click");
  addVoicedAudio(renderer);
  renderer.close.resolve();
  await renderer.command({ action: "stop" });
  assert.equal(renderer.transcriptions, 1);
});

test("descartar antes de AudioContext.close impedir transcrição por stop global", async () => {
  const renderer = createRenderer();
  await renderer.element("#recordButton").dispatch("click");
  addVoicedAudio(renderer);

  renderer.element("#discardRecordingButton").dispatch("click");
  assert.match(renderer.element("#status").textContent, /Descartando/);

  // This arrives while close() is still pending, as can happen with the global shortcut.
  await renderer.command({ action: "stop" });
  assert.equal(renderer.transcriptions, 0);
  renderer.close.resolve();
  await renderer.cancelled.promise;
  assert.equal(renderer.transcriptions, 0);
  assert.match(renderer.element("#status").textContent, /descartada/i);
  assert.equal(renderer.events.some((event) => event.type === "completed"), false);
  assert.equal(renderer.events.some((event) => event.type === "cancelled"), true);
});

test("Esc descarta a gravação ativa antes da transcrição", async () => {
  const renderer = createRenderer();
  await renderer.element("#recordButton").dispatch("click");
  addVoicedAudio(renderer);

  assert.equal(renderer.keydown(), true);
  assert.match(renderer.element("#status").textContent, /Descartando/);
  renderer.close.resolve();
  await new Promise(setImmediate);

  assert.equal(renderer.transcriptions, 0);
  assert.match(renderer.element("#status").textContent, /descartada/i);
  assert.equal(renderer.events.filter((event) => event.type === "cancelled").length, 1);
  assert.equal(renderer.events.find((event) => event.type === "cancelled").source, "escape");
});

test("Esc enquanto o microfone abre descarta a captura que chegar atrasada", async () => {
  const microphone = deferred();
  let stoppedTracks = 0;
  const renderer = createRenderer({ getUserMedia: () => microphone.promise });
  const start = renderer.element("#recordButton").dispatch("click");

  assert.equal(renderer.keydown(), true);
  await new Promise(setImmediate);
  microphone.resolve({ getTracks: () => [{ stop() { stoppedTracks += 1; } }] });
  await start;

  assert.equal(stoppedTracks, 1);
  assert.equal(renderer.worklet, undefined);
  assert.equal(renderer.transcriptions, 0);
  assert.match(renderer.element("#status").textContent, /descartada/i);
});

test("Esc após parar, durante fechamento do áudio, impede iniciar o modelo", async () => {
  const renderer = createRenderer();
  await renderer.element("#recordButton").dispatch("click");
  addVoicedAudio(renderer);
  const stop = renderer.element("#stopButton").dispatch("click");
  assert.equal(renderer.uiStates.at(-1).state, "processing");
  const runId = renderer.uiStates.at(-1).runId;

  assert.equal(renderer.keydown(), true);
  await new Promise(setImmediate);
  assert.equal(renderer.cancelCalls.length, 0);
  assert.match(renderer.element("#status").textContent, /cancelado/i);
  assert.equal(renderer.uiStates.at(-1).runId, runId);
  renderer.close.resolve();
  await stop;
  assert.equal(renderer.transcriptions, 0);
  assert.equal(renderer.events.some((event) => event.type === "completed"), false);
});

test("Esc durante transcrição aceita abort e ignora resultado tardio", async () => {
  const response = deferred();
  let invokedRunId;
  const renderer = createRenderer({
    transcribe: ({ runId }) => {
      invokedRunId = runId;
      return response.promise;
    },
  });
  await renderer.element("#recordButton").dispatch("click");
  addVoicedAudio(renderer);
  renderer.close.resolve();
  const stop = renderer.element("#stopButton").dispatch("click");
  await new Promise(setImmediate);

  assert.equal(typeof invokedRunId, "string");
  assert.equal(renderer.uiStates.some((state) =>
    state.source === "dictation" && state.state === "processing" && state.runId === invokedRunId), true);
  assert.equal(renderer.keydown(), true);
  await new Promise(setImmediate);
  assert.deepEqual(renderer.cancelCalls, [invokedRunId]);
  assert.match(renderer.element("#status").textContent, /cancelado/i);

  response.resolve({ text: "NÃO PODE APARECER", autoPasted: false });
  await stop;
  assert.equal(renderer.element("#lastMessageText").value, "");
  assert.equal(renderer.events.filter((event) => event.type === "completed").length, 0);
  assert.equal(renderer.events.filter((event) => event.type === "cancelled").length, 1);
  assert.equal(renderer.uiStates.at(-1).runId, invokedRunId);
});

test("comando de Esc global confirmado cancela ditado em processamento", async () => {
  const response = deferred();
  const renderer = createRenderer({ transcribe: () => response.promise });
  await renderer.element("#recordButton").dispatch("click");
  addVoicedAudio(renderer);
  renderer.close.resolve();
  const stop = renderer.element("#stopButton").dispatch("click");
  await new Promise(setImmediate);

  await renderer.command({ action: "cancel", source: "escape" });
  assert.equal(renderer.cancelCalls.length, 0);
  assert.match(renderer.element("#status").textContent, /cancelado/i);
  response.reject(Object.assign(new Error("Cancelado"), { name: "AbortError" }));
  await stop;
  assert.equal(renderer.events.filter((event) => event.type === "cancelled").length, 1);
  assert.equal(renderer.events.some((event) => event.type === "error"), false);
});

test("comando global tardio do ditado A não cancela o ditado B", async () => {
  const renderer = createRenderer();
  await renderer.element("#recordButton").dispatch("click");
  const runA = renderer.uiStates.at(-1).runId;
  renderer.close.resolve();
  await renderer.command({ action: "cancel", source: "escape", runId: runA });

  await renderer.element("#recordButton").dispatch("click");
  const runB = renderer.uiStates.at(-1).runId;
  assert.notEqual(runA, runB);
  await renderer.command({ action: "cancel", source: "escape", runId: runA });
  assert.match(renderer.element("#status").textContent, /Ouvindo/);
  assert.equal(renderer.events.filter((event) => event.type === "cancelled").length, 1);

  await renderer.command({ action: "cancel", source: "escape", runId: runB });
  assert.equal(renderer.events.filter((event) => event.type === "cancelled").length, 2);
});

test("Esc após início da entrega preserva o resultado concluído", async () => {
  const response = deferred();
  let invokedRunId;
  const renderer = createRenderer({
    transcribe: ({ runId }) => {
      invokedRunId = runId;
      return response.promise;
    },
    cancelTranscription: () => ({ accepted: false, reason: "already-delivering" }),
  });
  await renderer.element("#recordButton").dispatch("click");
  addVoicedAudio(renderer);
  renderer.close.resolve();
  const stop = renderer.element("#stopButton").dispatch("click");
  await new Promise(setImmediate);

  assert.equal(renderer.keydown(), true);
  await new Promise(setImmediate);
  assert.match(renderer.element("#status").textContent, /Finalizando a colagem/);
  assert.equal(renderer.events.filter((event) => event.type === "cancelled").length, 0);
  renderer.progress({ stage: "delivering", runId: invokedRunId });
  assert.equal(renderer.keydown(), false);

  response.resolve({ text: "Texto entregue", autoPasted: true });
  await stop;
  assert.equal(renderer.element("#lastMessageText").value, "Texto entregue");
  assert.equal(renderer.events.filter((event) => event.type === "completed").length, 1);
  assert.equal(renderer.uiStates.at(-1).runId, invokedRunId);
});

test("limpar histórico também limpa o cartão da última mensagem", async () => {
  const renderer = createRenderer();
  renderer.showLast({ id: "antigo", text: "Texto salvo", at: 1 });
  assert.equal(renderer.element("#lastMessageText").value, "Texto salvo");
  await renderer.element("#historyClearButton").dispatch("click");
  await renderer.element("#historyClearButton").dispatch("click");
  assert.equal(renderer.element("#lastMessageText").value, "");
  assert.equal(renderer.element("#copyLastButton").disabled, true);
  assert.equal(renderer.element("#lastMessageMeta").textContent, "Nenhuma transcrição ainda.");
});

test("correção antiga concluída depois de ditado novo não substitui o cartão", async () => {
  const saving = deferred();
  const old = { id: "antigo", text: "Texto antigo", at: 1 };
  const renderer = createRenderer({
    history: [old],
    saveCorrection: () => saving.promise,
    transcribe: async () => ({
      historyId: "novo",
      text: "Texto novo",
      autoPasted: false,
    }),
  });
  renderer.showLast(old);
  await renderer.loadHistory();

  const row = renderer.element("#historyList").children.find(
    (node) => node.className === "history-row",
  );
  row.children[1].dispatch("click");
  const editor = renderer.element("#historyList").children.find(
    (node) => node.className === "history-editor",
  );
  const textarea = editor.children[0].children[0];
  textarea.value = "Texto antigo corrigido";
  const savePending = editor.children[2].children[0].dispatch("click");

  await renderer.element("#recordButton").dispatch("click");
  addVoicedAudio(renderer);
  renderer.close.resolve();
  await renderer.element("#stopButton").dispatch("click");
  saving.resolve({ ...old, correctedText: "Texto antigo corrigido" });
  await savePending;
  assert.equal(renderer.element("#lastMessageText").value, "Texto novo");
  assert.equal(renderer.events.some((event) => event.type === "completed"), true);
});

// A cápsula só avisa "Ctrl+V" quando o texto ficou apenas na área de
// transferência; um ditado colado de fato mantém o pulso normal, e o aviso
// não vaza para o estado seguinte.
test("sucesso publica o aviso de colagem manual só quando não colou", async () => {
  for (const [autoPasted, manualPaste] of [[false, true], [true, false]]) {
    const renderer = createRenderer({
      transcribe: async () => ({ text: "Oi", autoPasted, reason: autoPasted ? null : "target-focus-lost" }),
    });
    await renderer.element("#recordButton").dispatch("click");
    addVoicedAudio(renderer);
    renderer.close.resolve();
    await renderer.element("#stopButton").dispatch("click");
    const last = renderer.uiStates.at(-1);
    assert.equal(last.state, "success");
    assert.equal(last.manualPaste, manualPaste);

    // Republicar o mesmo sucesso (ex.: trocar o perfil) não repete o aviso.
    await renderer.element("#profileSelect").dispatch("change");
    assert.equal(renderer.uiStates.at(-1).manualPaste, false);

    await renderer.element("#recordButton").dispatch("click");
    assert.equal(renderer.uiStates.at(-1).manualPaste, false);
  }
});

function fakeStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    map,
  };
}

// Nas primeiras gravações a cápsula ensina que Esc cancela; depois de 20, não.
test("ensina o Esc nas primeiras gravações e para depois do limite", async () => {
  const storage = fakeStorage();
  const renderer = createRenderer({ localStorage: storage });
  await renderer.element("#recordButton").dispatch("click");
  assert.equal(renderer.uiStates.at(-1).state, "recording");
  assert.equal(renderer.uiStates.at(-1).hint, "esc");
  assert.equal(storage.map.get("localFlow.escHintsShown"), "1");

  const veteran = createRenderer({
    localStorage: fakeStorage({ "localFlow.escHintsShown": "20" }),
  });
  await veteran.element("#recordButton").dispatch("click");
  assert.equal(veteran.uiStates.at(-1).hint, null);
});

// O relógio de 250 ms publicava nível 0 entre as amostras do microfone e as
// barras da cápsula despencavam quatro vezes por segundo.
test("publicação do relógio mantém o último nível do microfone", async () => {
  const renderer = createRenderer({ localStorage: fakeStorage() });
  await renderer.element("#recordButton").dispatch("click");
  addVoicedAudio(renderer);
  const level = renderer.uiStates.findLast((state) => state.level > 0)?.level;
  assert.ok(level > 0);
  renderer.evaluate("updateTimer()");
  assert.equal(renderer.uiStates.at(-1).level, level);
});
