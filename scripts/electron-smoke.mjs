import { runElectron } from "./electron-runner.mjs";

await runElectron({
  env: { LOCAL_FLOW_SMOKE_TEST: "1" },
  expectedOutput: ["LOCAL_FLOW_READY", "LOCAL_FLOW_CAPSULE_READY"],
  timeoutMs: 20000,
});
console.log("Smoke test do Electron concluído.");
