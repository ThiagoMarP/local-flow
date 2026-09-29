import { access, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const requiredFiles = [
  "docs/historico/PHASE_5.md",
  "src/main/services/clipboard-service.cjs",
  "src/main/services/housekeeping.cjs",
  "src/main/services/login-item-service.cjs",
  "src/main/services/privacy-logger.cjs",
  "src/main/services/settings-store.cjs",
  "src/main/services/test-harness.cjs",
  "src/main/services/window-manager.cjs",
  "src/renderer/settings-controller.js",
  "scripts/electron-settings-test.mjs",
  "scripts/electron-single-instance-test.mjs",
  "scripts/electron-metrics.mjs",
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

const mainSource = await readFile(
  path.join(root, "src", "main", "main.cjs"),
  "utf8",
);
// Permission gating moved into its own module in Phase 8; the security control
// still has to exist in the main process, so the verifier looks there too.
const permissionsSource = await readFile(
  path.join(root, "src", "main", "permissions.cjs"),
  "utf8",
);
const processSource = `${mainSource}\n${permissionsSource}`;
const mainLines = mainSource.split(/\r?\n/).length;
const requiredSignals = [
  "requestSingleInstanceLock",
  "setPermissionRequestHandler",
  "LOCAL_FLOW_METRICS",
  "powerMonitor.on(\"suspend\"",
  "powerMonitor.on(\"lock-screen\"",
];
for (const signal of requiredSignals) {
  const present = processSource.includes(signal);
  valid &&= present;
  console.log(`${present ? "OK" : "--"} main: ${signal}`);
}

const sizeAccepted = mainLines <= 650;
valid &&= sizeAccepted;
console.log(
  `${sizeAccepted ? "OK" : "--"} main.cjs: ${mainLines} linhas (limite 650)`,
);

console.log(
  valid
    ? "\nEstrutura essencial da Fase 5 validada."
    : "\nA Fase 5 ainda possui requisitos estruturais ausentes.",
);
process.exitCode = valid ? 0 : 1;
