import path from "node:path";
import { runElectron } from "./electron-runner.mjs";

const target =
  process.argv[2] ||
  path.join(process.cwd(), "work", "phase-3-capsule.png");
const state = process.argv[3] || "recording";
await runElectron({
  env: {
    LOCAL_FLOW_CAPTURE_CAPSULE_PATH: target,
    LOCAL_FLOW_CAPSULE_STATE: state,
  },
  expectedOutput: "LOCAL_FLOW_CAPSULE_CAPTURED=",
  timeoutMs: 30000,
});
console.log(target);

