import { runElectron } from "./electron-runner.mjs";

const output = await runElectron({
  electronArgs: [
    "--disable-gpu",
    "--disable-software-rasterizer",
    "--in-process-gpu",
  ],
  env: { LOCAL_FLOW_MIC_SELF_TEST: "1" },
  expectedOutput: "LOCAL_FLOW_MIC_OK=",
  timeoutMs: 30000,
});
const line = output.match(/LOCAL_FLOW_MIC_OK=(.*)$/m)?.[1];
const result = JSON.parse(line);
if (result.error) {
  throw new Error(`Autoteste do microfone falhou: ${result.error}`);
}
if (result.wavBytes <= 44 || result.chunks < 1) {
  throw new Error("O autoteste não capturou amostras de áudio.");
}
console.log(JSON.stringify(result, null, 2));
