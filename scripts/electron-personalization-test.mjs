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
    LOCAL_FLOW_PERSONALIZATION_TEST_AUDIO: sample,
  },
  expectedOutput: [
    "LOCAL_FLOW_PERSONALIZATION_OK=",
    '"replacementsApplied":1',
    '"snippetsExpanded":1',
    "Atenciosamente",
  ],
  timeoutMs: 60000,
});
console.log(
  output.match(/LOCAL_FLOW_PERSONALIZATION_OK=.*$/m)?.[0] || output,
);
