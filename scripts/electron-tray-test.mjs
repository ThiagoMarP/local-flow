import { runElectron } from "./electron-runner.mjs";

await runElectron({
  env: { LOCAL_FLOW_TRAY_TEST: "1" },
  expectedOutput: "LOCAL_FLOW_TRAY_READY",
  timeoutMs: 20000,
});
console.log("Bandeja do sistema criada com sucesso.");

