import path from "node:path";
import { runElectron } from "./electron-runner.mjs";

const sample =
  process.argv[2] ||
  path.join(process.cwd(), "benchmarks", "samples", "05-lista.wav");
const output = await runElectron({
  env: { LOCAL_FLOW_E2E_AUDIO: sample },
  expectedOutput: "LOCAL_FLOW_E2E_OK=",
  timeoutMs: 60000,
});
console.log(output.match(/LOCAL_FLOW_E2E_OK=.*$/m)?.[0] || output);

