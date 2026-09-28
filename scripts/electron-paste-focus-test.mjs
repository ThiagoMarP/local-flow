import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runElectron } from "./electron-runner.mjs";

const tempDir = await mkdtemp(path.join(os.tmpdir(), "local-flow-paste-focus-"));
const statusPath = path.join(tempDir, "status.json");
const triggerPath = path.join(tempDir, "trigger.txt");
const title = `LocalFlowFocusTarget-${Date.now()}`;
const targetScript = path.join(
  process.cwd(), "native", "windows", "paste-focus-test-target.ps1",
);
const audioPath = path.join(
  process.cwd(), "benchmarks", "samples", "05-lista.wav",
);

let target;
try {
  const output = await runElectron({
    env: {
      LOCAL_FLOW_INSERTION_TEST_AUDIO: audioPath,
      LOCAL_FLOW_INSERTION_TEST_TITLE: title,
      LOCAL_FLOW_INSERTION_TEST_DELAY_MS: "1800",
      LOCAL_FLOW_INSERTION_TEST_MENU_TRIGGER_PATH: triggerPath,
    },
    expectedOutput: "LOCAL_FLOW_INSERTION_OK=",
    timeoutMs: 60000,
    onOutput: (chunk) => {
      if (!chunk.includes("LOCAL_FLOW_READY") || target) return;
      target = spawn("powershell.exe", [
        "-NoLogo", "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass",
        "-File", targetScript,
        "-Title", title,
        "-StatusPath", statusPath,
        "-TriggerPath", triggerPath,
      ], { windowsHide: false });
    },
  });
  const status = JSON.parse(await readFile(statusPath, "utf8"));
  console.log(output.match(/LOCAL_FLOW_INSERTION_OK=.*$/m)?.[0] || output);
  console.log(`FOCUS_TARGET=${JSON.stringify(status)}`);
  if (!status.text.includes("revisar o contrato")) {
    throw new Error("Paste reported success but the original text field remained empty");
  }
  if (status.helpOpen) {
    throw new Error("Help menu remained open after paste");
  }
} finally {
  target?.kill();
  await rm(tempDir, { recursive: true, force: true });
}
