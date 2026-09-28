const assert = require("node:assert/strict");
const test = require("node:test");
const { LastTranscriptionPaster } = require("../src/main/repaste.cjs");

function setup({
  last = { id: "a", text: "olá mundo", correctedText: null },
  insertResult = { autoPasted: true, clipboardRestored: false, reason: null },
  insertError = null,
  busy = false,
  noHistory = false,
} = {}) {
  const calls = { inserted: [], states: [], captured: 0, logs: [] };
  const target = { hwnd: 42, focusHwnd: 43, isSelf: false };
  const paster = new LastTranscriptionPaster({
    historyStore: noHistory ? null : { last: async () => last },
    captureTarget: async () => {
      calls.captured += 1;
      return target;
    },
    clipboardService: {
      insert: async (text, insertTarget, settings) => {
        calls.inserted.push({ text, target: insertTarget, settings });
        if (insertError) throw insertError;
        return insertResult;
      },
    },
    settingsStore: { get: () => ({ autoPaste: true }) },
    isBusy: () => busy,
    showState: (state) => calls.states.push(state),
    getProfile: () => "parakeet",
    logger: {
      info: async (event, data) => calls.logs.push([event, data]),
      error: async (event) => calls.logs.push([event]),
    },
  });
  return { paster, calls, target };
}

test("cola a última transcrição na janela em foco e mostra o pulso normal", async () => {
  const { paster, calls, target } = setup();
  assert.equal(await paster.paste(), "pasted");
  assert.deepEqual(calls.inserted, [
    { text: "olá mundo", target, settings: { autoPaste: true } },
  ]);
  assert.equal(calls.states.length, 1);
  assert.equal(calls.states[0].state, "success");
  assert.equal(calls.states[0].manualPaste, false);
  assert.equal(calls.states[0].profile, "parakeet");
});

// A correção salva no histórico é o texto que o usuário decidiu que vale.
test("prefere a correção salva ao texto original", async () => {
  const { paster, calls } = setup({
    last: { id: "a", text: "olá mundo", correctedText: "Olá, mundo!" },
  });
  await paster.paste();
  assert.equal(calls.inserted[0].text, "Olá, mundo!");
});

test("quando não consegue colar, avisa para usar Ctrl+V", async () => {
  const { paster, calls } = setup({
    insertResult: { autoPasted: false, clipboardRestored: false, reason: "target-focus-lost" },
  });
  assert.equal(await paster.paste(), "copied");
  assert.equal(calls.states[0].state, "success");
  assert.equal(calls.states[0].manualPaste, true);
});

test("sem histórico, mostra erro curto e não mexe na área de transferência", async () => {
  for (const options of [{ last: null }, { noHistory: true }, { last: { id: "a", text: "" } }]) {
    const { paster, calls } = setup(options);
    assert.equal(await paster.paste(), "empty");
    assert.equal(calls.inserted.length, 0);
    assert.equal(calls.states[0].state, "error");
    assert.equal(calls.states[0].message, "Nada para colar");
  }
});

// Durante um ditado a cápsula e a área de transferência pertencem a ele.
test("ignora o atalho enquanto um ditado está em andamento", async () => {
  const { paster, calls } = setup({ busy: true });
  assert.equal(await paster.paste(), "busy");
  assert.equal(calls.captured, 0);
  assert.equal(calls.inserted.length, 0);
  assert.equal(calls.states.length, 0);
});

test("ignora toques repetidos enquanto a colagem anterior não terminou", async () => {
  const { paster, calls } = setup();
  const [first, second] = await Promise.all([paster.paste(), paster.paste()]);
  assert.equal(first, "pasted");
  assert.equal(second, "busy");
  assert.equal(calls.inserted.length, 1);
  assert.equal(await paster.paste(), "pasted");
});

test("falha inesperada vira erro na cápsula em vez de exceção", async () => {
  const { paster, calls } = setup({ insertError: new Error("clipboard locked") });
  assert.equal(await paster.paste(), "failed");
  assert.equal(calls.states[0].state, "error");
  assert.equal(calls.states[0].message, "Não consegui colar");
});

test("com destino informado, não captura a janela em foco", async () => {
  const { paster, calls } = setup({
    insertResult: { autoPasted: false, clipboardRestored: false, reason: "target-unavailable" },
  });
  const tray = { hwnd: null, isSelf: false };
  assert.equal(await paster.paste({ target: tray }), "copied");
  assert.equal(calls.captured, 0);
  assert.equal(calls.inserted[0].target, tray);
  assert.equal(calls.states[0].manualPaste, true);
});
