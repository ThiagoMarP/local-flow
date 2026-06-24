import { spawn } from "node:child_process";
import {
  access,
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runElectron } from "./electron-runner.mjs";

const tempDir = await mkdtemp(
  path.join(os.tmpdir(), "local-flow-insertion-test-"),
);
const outputPath = path.join(tempDir, "result.txt");
const title = `LocalFlowInsertionTarget-${Date.now()}`;
const targetScript = path.join(
  process.cwd(),
  "native",
  "windows",
  "insertion-test-target.ps1",
);
const sample = path.join(
  process.cwd(),
  "benchmarks",
  "samples",
  "05-lista.wav",
);

let target;

try {
  const output = await runElectron({
    env: {
      LOCAL_FLOW_INSERTION_TEST_AUDIO: sample,
      LOCAL_FLOW_INSERTION_TEST_TITLE: title,
      LOCAL_FLOW_INSERTION_TEST_DELAY_MS: "1800",
    },
    expectedOutput: "LOCAL_FLOW_INSERTION_OK=",
    timeoutMs: 60000,
    onSpawn: async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      target = spawn(
        "powershell.exe",
        [
          "-NoLogo",
          "-NoProfile",
          "-STA",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          targetScript,
          "-Title",
          title,
          "-OutputPath",
          outputPath,
        ],
        { windowsHide: false },
      );
    },
  });

  let insertedText = "";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await access(outputPath);
      insertedText = await readFile(outputPath, "utf8");
      if (insertedText.trim()) break;
    } catch {
      // A janela ainda não recebeu a colagem.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  if (!insertedText.includes("revisar o contrato")) {
    throw new Error(
      `O alvo não recebeu a transcrição esperada: ${insertedText}`,
    );
  }
  console.log(
    output.match(/LOCAL_FLOW_INSERTION_OK=.*$/m)?.[0] || output,
  );
  console.log(`Texto recebido pelo alvo: ${insertedText}`);
} finally {
  target?.kill();
  await rm(tempDir, { recursive: true, force: true });
}
