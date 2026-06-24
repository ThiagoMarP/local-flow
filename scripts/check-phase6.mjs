import { access, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const requiredFiles = [
  "PHASE_6.md",
  "src/main/services/revision-service.cjs",
  "src/main/services/transcription-pipeline.cjs",
  "tests/revision-service.test.cjs",
  "tests/transcription-pipeline.test.cjs",
  "scripts/electron-revision-test.mjs",
  "scripts/electron-revision-real-test.mjs",
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

const settings = await readFile(
  path.join(root, "src", "main", "services", "settings-store.cjs"),
  "utf8",
);
const main = await readFile(
  path.join(root, "src", "main", "main.cjs"),
  "utf8",
);
const renderer = await readFile(
  path.join(root, "src", "renderer", "renderer.js"),
  "utf8",
);
const signals = [
  [settings, 'revisionMode: "literal"', "modo literal padrão"],
  [main, "TranscriptionPipeline", "pipeline integrado"],
  [main, "revisionFallback", "fallback registrado"],
  [renderer, "onTranscriptionProgress", "progresso na interface"],
];
for (const [source, signal, label] of signals) {
  const present = source.includes(signal);
  valid &&= present;
  console.log(`${present ? "OK" : "--"} ${label}`);
}

console.log(
  valid
    ? "\nEstrutura essencial da Fase 6 validada."
    : "\nA Fase 6 ainda possui requisitos estruturais ausentes.",
);
process.exitCode = valid ? 0 : 1;
