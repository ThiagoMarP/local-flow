import { runElectron } from "./electron-runner.mjs";

const output = await runElectron({
  env: { LOCAL_FLOW_LIFECYCLE_TEST: "1" },
  expectedOutput: [
    "LOCAL_FLOW_TRAY_READY",
    "LOCAL_FLOW_LIFECYCLE_OK=",
  ],
  timeoutMs: 30000,
});
console.log(
  output.match(/LOCAL_FLOW_LIFECYCLE_OK=.*$/m)?.[0] || output,
);

