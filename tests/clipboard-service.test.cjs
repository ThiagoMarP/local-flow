const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ClipboardService,
} = require("../src/main/services/clipboard-service.cjs");

function createClipboard(initial = "") {
  let value = initial;
  return {
    availableFormats: () => (value ? ["text/plain"] : []),
    readText: () => value,
    writeText: (next) => {
      value = next;
    },
    value: () => value,
  };
}

test("mantém texto no clipboard quando colagem está desativada", async () => {
  const clipboard = createClipboard("anterior");
  const service = new ClipboardService({
    clipboard,
    windowsBridge: {},
    delay: 0,
  });
  const result = await service.insert("novo", null, {
    autoPaste: false,
    restoreClipboard: true,
  });
  assert.equal(result.autoPasted, false);
  assert.equal(result.reason, "auto-paste-disabled");
  assert.equal(clipboard.value(), "novo");
});

test("restaura clipboard quando o destino confirma recebimento", async () => {
  const clipboard = createClipboard("anterior");
  const service = new ClipboardService({
    clipboard,
    windowsBridge: {
      pasteTo: async () => ({
        pasted: true,
        focusVerified: true,
        deliveryVerified: true,
      }),
    },
    delay: 0,
  });
  const result = await service.insert(
    "novo",
    {
      hwnd: "42",
      isSelf: false,
      clipboard: service.snapshotText(),
    },
    { autoPaste: true, restoreClipboard: true },
  );
  assert.equal(result.autoPasted, true);
  assert.equal(result.clipboardRestored, true);
  assert.equal(clipboard.value(), "anterior");
});

test("mantém transcrição copiável quando envio de Ctrl+V não comprova inserção", async () => {
  const clipboard = createClipboard("anterior");
  let pasteArguments;
  const service = new ClipboardService({
    clipboard,
    windowsBridge: {
      pasteTo: async (...args) => {
        pasteArguments = args;
        return {
          pasted: true,
          focusVerified: true,
          deliveryVerified: false,
        };
      },
    },
    delay: 0,
  });
  const result = await service.insert(
    "novo",
    { hwnd: "42", focusHwnd: "84", isSelf: false },
    { autoPaste: true, restoreClipboard: true },
  );
  assert.deepEqual(pasteArguments, ["42", "84"]);
  assert.equal(result.autoPasted, true);
  assert.equal(result.clipboardRestored, false);
  assert.equal(clipboard.value(), "novo");
});

test("preserva transcrição quando auxiliar falha", async () => {
  const clipboard = createClipboard("anterior");
  const service = new ClipboardService({
    clipboard,
    windowsBridge: {
      pasteTo: async () => {
        throw new Error("falha");
      },
    },
    delay: 0,
  });
  const result = await service.insert(
    "novo",
    { hwnd: "42", isSelf: false },
    { autoPaste: true, restoreClipboard: true },
  );
  assert.equal(result.autoPasted, false);
  assert.equal(result.reason, "windows-helper-failed");
  assert.equal(clipboard.value(), "novo");
});

test("não declara colagem quando o auxiliar perdeu o foco do campo", async () => {
  const clipboard = createClipboard("anterior");
  const service = new ClipboardService({
    clipboard,
    windowsBridge: {
      pasteTo: async () => ({ pasted: true, focusVerified: false }),
    },
    delay: 0,
  });
  const result = await service.insert(
    "novo",
    { hwnd: "42", focusHwnd: "84", isSelf: false },
    { autoPaste: true, restoreClipboard: true },
  );
  assert.equal(result.autoPasted, false);
  assert.equal(result.reason, "target-focus-lost");
  assert.equal(clipboard.value(), "novo");
});
