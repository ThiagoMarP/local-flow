import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runElectron } from "./electron-runner.mjs";

const userDataPath = await mkdtemp(
  path.join(os.tmpdir(), "local-flow-settings-e2e-"),
);
const patch = {
  profile: "fast",
  vocabulary: ["Local Flow", "Ollama"],
  maxRecordingSeconds: 60,
  revisionMode: "clean",
  revisionModel: "qwen2.5:7b",
  autoPaste: false,
  restoreClipboard: false,
  startMinimized: true,
};

try {
  await runElectron({
    userDataPath,
    cleanupUserData: false,
    env: {
      LOCAL_FLOW_SETTINGS_TEST_WRITE: JSON.stringify(patch),
    },
    expectedOutput: "LOCAL_FLOW_SETTINGS_WRITTEN=",
  });
  const output = await runElectron({
    userDataPath,
    cleanupUserData: false,
    env: {
      LOCAL_FLOW_SETTINGS_TEST_EXPECT: JSON.stringify(patch),
    },
    expectedOutput: "LOCAL_FLOW_SETTINGS_PERSISTED=",
  });
  console.log(
    output.match(/LOCAL_FLOW_SETTINGS_PERSISTED=.*$/m)?.[0] || output,
  );
} finally {
  await rm(userDataPath, { recursive: true, force: true });
}
