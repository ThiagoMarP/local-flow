import { access, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const requiredFiles = [
  "PHASE_8.md",
  "electron-builder.yml",
  "README.md",
  "docs/INSTALL.md",
  "src/main/services/app-paths.cjs",
  "src/main/services/model-installer.cjs",
  "src/main/setup-ipc.cjs",
  "src/renderer/setup-controller.js",
  "tests/app-paths.test.cjs",
  "tests/model-installer.test.cjs",
  "scripts/electron-setup-test.mjs",
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

const builder = await readFile(
  path.join(root, "electron-builder.yml"),
  "utf8",
);
const main = await readFile(path.join(root, "src/main/main.cjs"), "utf8");
const setupIpc = await readFile(
  path.join(root, "src/main/setup-ipc.cjs"),
  "utf8",
);
const preload = await readFile(
  path.join(root, "src/preload/preload.cjs"),
  "utf8",
);
const renderer = await readFile(
  path.join(root, "src/renderer/index.html"),
  "utf8",
);
const pkg = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);

const signals = [
  [builder, "nsis", "alvo de instalador NSIS"],
  [builder, "extraResources", "binários nativos como recursos"],
  [setupIpc, "setup:status", "IPC de status de setup"],
  [setupIpc, "setup:download", "IPC de download de modelo"],
  [main, "registerSetupIpc", "registro do IPC de setup no main"],
  [preload, "getSetupStatus", "ponte de setup no preload"],
  [renderer, "setupPanel", "painel de setup no dashboard"],
];
for (const [source, signal, label] of signals) {
  const present = source.includes(signal);
  valid &&= present;
  console.log(`${present ? "OK" : "--"} ${label}`);
}

const hasDist = Boolean(pkg.scripts?.dist);
const hasBuilderDep = Boolean(pkg.devDependencies?.["electron-builder"]);
valid &&= hasDist && hasBuilderDep;
console.log(`${hasDist ? "OK" : "--"} script de empacotamento (dist)`);
console.log(`${hasBuilderDep ? "OK" : "--"} dependência electron-builder`);

console.log(
  valid
    ? "\nEstrutura essencial da Fase 8 validada."
    : "\nA Fase 8 ainda possui requisitos estruturais ausentes.",
);
process.exitCode = valid ? 0 : 1;
