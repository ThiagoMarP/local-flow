const assert = require("node:assert/strict");
const test = require("node:test");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const helperPath = path.join(
  __dirname,
  "..",
  "native",
  "windows",
  "foreground-helper.ps1",
);

test("paste focus path does not activate the target window menu", () => {
  const source = readFileSync(helperPath, "utf8").replace(/\r\n/g, "\n");
  const focusBody = source.match(
    /public static bool FocusWindow\(IntPtr target\) \{([\s\S]*?)\n    \}\n\n    public static void SendPaste/s,
  )?.[1];

  assert.ok(focusBody, "FocusWindow implementation not found");
  assert.doesNotMatch(
    focusBody,
    /keybd_event\(VK_MENU/,
    "focusing must not synthesize a bare Alt press",
  );
  assert.doesNotMatch(
    focusBody,
    /SetFocus\(target\)/,
    "focusing must not replace the browser's child text control focus",
  );
});
