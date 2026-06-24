import { runElectron } from "./electron-runner.mjs";

const output = await runElectron({
  env: { LOCAL_FLOW_SHORTCUT_TEST: "1" },
  expectedOutput: '"registered":true',
  timeoutMs: 30000,
});
console.log(
  output.match(/LOCAL_FLOW_SHORTCUT_READY=.*$/m)?.[0] || output,
);
console.log("Atalho global registrado com sucesso.");
