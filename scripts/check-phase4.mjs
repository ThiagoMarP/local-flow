import { access } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const requiredFiles = [
  "native/windows/foreground-helper.ps1",
  "src/main/windows-bridge.cjs",
  "src/main/shortcut-controller.cjs",
  "docs/historico/PHASE_4.md",
];

let valid = true;
for (const file of requiredFiles) {
  try {
    await access(path.join(root, file));
    console.log(`OK ${file}`);
  } catch {
    valid = false;
    console.log(`-- ${file}`);
  }
}

console.log(
  valid
    ? "\nArquivos essenciais da Fase 4 disponíveis."
    : "\nA Fase 4 ainda possui arquivos ausentes.",
);
process.exitCode = valid ? 0 : 1;

