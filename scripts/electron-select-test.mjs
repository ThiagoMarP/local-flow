import { runElectron } from "./electron-runner.mjs";

const output = await runElectron({
  env: { LOCAL_FLOW_SELECT_TEST: "1" },
  expectedOutput: "LOCAL_FLOW_SELECT_TEST=",
});
const match = output.match(/LOCAL_FLOW_SELECT_TEST=(\{[^\r\n]+\})/);
const result = JSON.parse(match?.[1] || "{}");
if (
  result.mode !== "fast" ||
  result.shortcut !== "CommandOrControl+Alt+D" ||
  result.modeLabel !== "Limpeza rápida" ||
  result.shortcutLabel !== "Ctrl+Alt+D" ||
  result.modelDisabled !== true
) {
  throw new Error(`Seletor não persistiu a seleção: ${JSON.stringify(result)}`);
}
console.log("Dropdowns persistiram Limpeza rápida e atalho: OK");
