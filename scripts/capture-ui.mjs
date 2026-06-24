import path from "node:path";
import { runElectron } from "./electron-runner.mjs";

const target =
  process.argv[2] ||
  path.join(process.cwd(), "work", "phase-2-ui.png");
const showSettings = process.argv.includes("--settings");
await runElectron({
  env: {
    LOCAL_FLOW_CAPTURE_PATH: target,
    LOCAL_FLOW_SETTINGS_PREVIEW: showSettings ? "1" : "0",
  },
  expectedOutput: "LOCAL_FLOW_CAPTURED=",
  timeoutMs: 30000,
});
console.log(target);
