import path from "node:path";
import { runElectron } from "./electron-runner.mjs";

const sample = path.join(
  process.cwd(),
  "benchmarks",
  "samples",
  "05-lista.wav",
);
const output = await runElectron({
  electronArgs: [
    "--disable-gpu",
    "--disable-software-rasterizer",
    "--in-process-gpu",
  ],
  env: {
    LOCAL_FLOW_REVISION_TEST_AUDIO: sample,
    LOCAL_FLOW_E2E_REVISION_MODE: "smart",
    LOCAL_FLOW_E2E_REVISION_MODEL: "qwen2.5:3b",
  },
  expectedOutput: [
    "LOCAL_FLOW_REVISION_OK=",
    '"fallback":true',
    '"reason":"content-term-changed"',
  ],
  timeoutMs: 90000,
});
console.log(
  output.match(/LOCAL_FLOW_REVISION_OK=.*$/m)?.[0] || output,
);
