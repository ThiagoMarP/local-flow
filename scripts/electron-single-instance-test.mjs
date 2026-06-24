import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runElectron } from "./electron-runner.mjs";

const electronPath = path.join(
  process.cwd(),
  "node_modules",
  "electron",
  "dist",
  "electron.exe",
);
const userDataPath = path.join(
  os.tmpdir(),
  "local-flow-single-instance-test",
  `${Date.now()}-${Math.random().toString(16).slice(2)}`,
);
await mkdir(userDataPath, { recursive: true });
let launchedSecond = false;

await runElectron({
  userDataPath,
  electronArgs: [
    "--disable-gpu",
    "--disable-software-rasterizer",
    "--in-process-gpu",
    "--hidden",
  ],
  env: { LOCAL_FLOW_SINGLE_INSTANCE_TEST: "1" },
  expectedOutput: "LOCAL_FLOW_SINGLE_INSTANCE_OK",
  timeoutMs: 30000,
  onOutput: (text) => {
    if (
      launchedSecond ||
      !text.includes("LOCAL_FLOW_SINGLE_INSTANCE_PRIMARY_READY")
    ) {
      return;
    }
    launchedSecond = true;
    const second = spawn(
      electronPath,
      [
        "--disable-gpu",
        "--disable-software-rasterizer",
        "--in-process-gpu",
        "--hidden",
        ".",
      ],
      {
      cwd: process.cwd(),
      env: {
        ...process.env,
        LOCAL_FLOW_USER_DATA: userDataPath,
        LOCAL_FLOW_SINGLE_INSTANCE_TEST: "1",
      },
      windowsHide: true,
      stdio: "ignore",
      },
    );
    second.unref();
  },
});

console.log("Instância única validada.");
