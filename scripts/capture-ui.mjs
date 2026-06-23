import path from "node:path";
import { runElectron } from "./electron-runner.mjs";

const target =
  process.argv[2] ||
  path.join(process.cwd(), "work", "phase-2-ui.png");
await runElectron({
  env: { LOCAL_FLOW_CAPTURE_PATH: target },
  expectedOutput: "LOCAL_FLOW_CAPTURED=",
  timeoutMs: 30000,
});
console.log(target);

