import { access } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const requiredFiles = [
  "src/main/window-layout.cjs",
  "src/main/ui-state.cjs",
  "src/renderer/capsule.html",
  "src/renderer/capsule.css",
  "src/renderer/capsule.js",
  "docs/historico/PHASE_3.md",
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
    ? "\nArquivos essenciais da Fase 3 disponíveis."
    : "\nA Fase 3 ainda possui arquivos ausentes.",
);
process.exitCode = valid ? 0 : 1;

