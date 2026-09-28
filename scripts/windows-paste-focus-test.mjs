import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { WindowsBridge } = require("../src/main/windows-bridge.cjs");
const tempDir = await mkdtemp(path.join(os.tmpdir(), "local-flow-paste-"));
const statusPath = path.join(tempDir, "status.json");
const triggerPath = path.join(tempDir, "trigger.txt");
const title = `LocalFlowFocusTarget-${Date.now()}`;
const targetScript = path.join(process.cwd(), "native", "windows", "paste-focus-test-target.ps1");
const helperScript = path.join(process.cwd(), "native", "windows", "foreground-helper.ps1");
const bridge = new WindowsBridge({ scriptPath: helperScript });
const expectedText = `LOCAL_FLOW_PASTE_TEST_${Date.now()}`;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readStatus() {
  try {
    return JSON.parse(await readFile(statusPath, "utf8"));
  } catch {
    return null;
  }
}

async function waitForStatus(predicate, timeoutMs = 5000) {
  const until = Date.now() + timeoutMs;
  do {
    const status = await readStatus();
    if (status && predicate(status)) return status;
    await pause(50);
  } while (Date.now() < until);
  throw new Error(`Alvo não atingiu o estado esperado: ${JSON.stringify(await readStatus())}`);
}

let target;
try {
  target = spawn("powershell.exe", [
    "-NoLogo", "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass",
    "-File", targetScript, "-Title", title,
    "-StatusPath", statusPath, "-TriggerPath", triggerPath,
    "-PasteText", expectedText,
  ], { windowsHide: false });
  await waitForStatus((status) => status.textFocused && status.foreground);
  const window = await bridge.findByTitle(title);
  assert.ok(window?.hwnd, "Janela de destino não encontrada");
  assert.notEqual(window.focusHwnd, "0", "Campo do destino não estava em foco");
  const foreground = await bridge.captureForeground();
  if (!foreground?.hwnd) {
    throw new Error("Windows não expôs um foreground HWND nesta sessão; colagem física indisponível");
  }
  assert.equal(foreground.hwnd, window.hwnd, "Alvo não está em primeiro plano");
  const result = await bridge.pasteTo(window.hwnd, window.focusHwnd);
  assert.equal(result.pasted, true, `Ctrl+V não enviado: ${JSON.stringify(result)}`);
  const status = await waitForStatus((current) => current.text.includes(expectedText));
  assert.equal(result.focusVerified, true, "Foco não confirmado após Ctrl+V");
  assert.equal(result.deliveryVerified, false, "Helper não deve alegar entrega no campo");
  assert.equal(status.textFocused, true, "Campo perdeu o foco");
  assert.equal(status.foreground, true, "Janela perdeu o primeiro plano");
  assert.equal(status.helpOpen, false, "Menu de ajuda ficou aberto");
  console.log(`LOCAL_FLOW_WINDOWS_PASTE_OK=${JSON.stringify({ result, status })}`);
} finally {
  bridge.dispose();
  if (target && target.exitCode === null) {
    await writeFile(triggerPath, "quit").catch(() => {});
    await Promise.race([
      new Promise((resolve) => target.once("exit", resolve)),
      pause(1000),
    ]);
    if (target.exitCode === null) target.kill();
  }
  await rm(tempDir, { recursive: true, force: true });
}
