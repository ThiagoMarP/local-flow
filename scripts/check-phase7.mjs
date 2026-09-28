import { access, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const requiredFiles = [
  "PHASE_7.md",
  "src/main/services/personalization-service.cjs",
  "tests/personalization-service.test.cjs",
  "scripts/electron-personalization-test.mjs",
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
const pipeline = await readFile(
  path.join(
    root,
    "src",
    "main",
    "services",
    "transcription-pipeline.cjs",
  ),
  "utf8",
);
const renderer = await readFile(
  path.join(root, "src", "renderer", "index.html"),
  "utf8",
);
const signals = [
  [settings, 'writingProfile: "neutral"', "perfil neutro padrão"],
  [settings, "normalizeReplacements", "substituições persistentes"],
  [settings, "normalizeSnippets", "snippets persistentes"],
  [pipeline, "applyReplacements", "substituição antes da revisão"],
  [pipeline, "expandSnippets", "snippet depois da revisão"],
  [renderer, "replacementRulesInput", "editor de substituições"],
  [renderer, "snippetRulesInput", "editor de snippets"],
];
for (const [source, signal, label] of signals) {
  const present = source.includes(signal);
  valid &&= present;
  console.log(`${present ? "OK" : "--"} ${label}`);
}

console.log(
  valid
    ? "\nEstrutura essencial da Fase 7 validada."
    : "\nA Fase 7 ainda possui requisitos estruturais ausentes.",
);
process.exitCode = valid ? 0 : 1;
