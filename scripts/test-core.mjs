import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { readFile, readdir } from "node:fs/promises";

const require = createRequire(import.meta.url);
const { transcribeWav } = require("../src/main/whisper-service.cjs");

const root = process.cwd();
const requestedSample = process.argv[2];
const sampleFiles = requestedSample
  ? [requestedSample]
  : [
      "01-mensagem.wav",
      "02-correcao.wav",
      "03-numeros.wav",
      "04-email.wav",
      "05-lista.wav",
    ].map((file) => path.join(root, "benchmarks", "samples", file));

const tempRoot = path.join(os.tmpdir(), "local-flow");
async function listJobs() {
  try {
    return (await readdir(tempRoot)).filter((name) => name.startsWith("job-"));
  } catch {
    return [];
  }
}

const jobsBefore = await listJobs();
const results = [];
for (const samplePath of sampleFiles) {
  const wavBuffer = await readFile(samplePath);
  const result = await transcribeWav({
    projectRoot: root,
    wavBuffer,
    profile: "fast",
    vocabulary: ["Electron", "TypeScript", "Whisper", "Ollama"],
    threads: 24,
  });
  if (!result.text || result.text.length < 5) {
    throw new Error(
      `O teste do núcleo não retornou texto válido para ${samplePath}.`,
    );
  }
  results.push({
    sample: path.basename(samplePath),
    text: result.text,
    elapsedMs: result.elapsedMs,
  });
}

const jobsAfter = await listJobs();
if (jobsAfter.length !== jobsBefore.length) {
  throw new Error("O teste deixou arquivos temporários de transcrição.");
}

console.table(results);
console.log(`${results.length} transcrições concluídas sem resíduos temporários.`);
