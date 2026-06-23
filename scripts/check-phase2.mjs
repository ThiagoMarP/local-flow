import { access } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const requiredFiles = [
  "src/main/main.cjs",
  "src/main/whisper-service.cjs",
  "src/preload/preload.cjs",
  "src/renderer/audio.js",
  "src/renderer/index.html",
  "src/renderer/renderer.js",
  "src/renderer/styles.css",
  "native/whisper/whisper-cli.exe",
  "models/ggml-medium-q5_0.bin",
  "node_modules/electron/package.json",
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
    ? "\nArquivos essenciais da Fase 2 disponíveis."
    : "\nA Fase 2 ainda possui arquivos ausentes.",
);
process.exitCode = valid ? 0 : 1;
