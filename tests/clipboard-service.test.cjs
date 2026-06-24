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

test("restaura clipboard após colagem bem-sucedida", async () => {
  const clipboard = createClipboard("anterior");
  const service = new ClipboardService({
    clipboard,
    windowsBridge: {
      pasteTo: async () => ({ pasted: true }),
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

