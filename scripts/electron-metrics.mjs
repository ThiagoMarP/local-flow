import { runElectron } from "./electron-runner.mjs";

const output = await runElectron({
  env: { LOCAL_FLOW_METRICS_TEST: "1" },
  expectedOutput: "LOCAL_FLOW_METRICS=",
  timeoutMs: 30000,
});
console.log(output.match(/LOCAL_FLOW_METRICS=.*$/m)?.[0] || output);
