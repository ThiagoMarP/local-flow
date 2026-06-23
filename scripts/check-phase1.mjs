import { access, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const checks = [];

async function exists(label, target) {
  try {
    await access(target);
    checks.push({ label, ok: true });
  } catch {
    checks.push({ label, ok: false });
  }
}

await exists(
  "whisper-cli",
  path.join(root, "native", "whisper", "whisper-cli.exe"),
);
await exists(
  "modelo small",
  path.join(root, "models", "ggml-small-q5_1.bin"),
);
await exists(
  "modelo medium",
  path.join(root, "models", "ggml-medium-q5_0.bin"),
);

const sampleDir = path.join(root, "benchmarks", "samples");
let sampleCount = 0;
try {
  sampleCount = (await readdir(sampleDir)).filter((file) =>
    file.toLowerCase().endsWith(".wav"),
  ).length;
} catch {
  // Reportado abaixo.
}

console.log("Estado da Fase 1\n");
for (const check of checks) {
  console.log(`${check.ok ? "OK" : "--"} ${check.label}`);
}
console.log(`${sampleCount >= 10 ? "OK" : "--"} amostras WAV: ${sampleCount}/10`);

const ready = checks.every((check) => check.ok) && sampleCount >= 10;
console.log(
  ready
    ? "\nPronto para executar o benchmark."
    : "\nAinda faltam itens. Execute o setup e grave as amostras.",
);

process.exitCode = ready ? 0 : 1;

