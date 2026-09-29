import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { transcribeParakeetWav } = require(
  "../src/main/services/parakeet-service.cjs",
);
const root = process.cwd();
const samplesDir = path.join(root, "benchmarks", "samples");
const resultsDir = path.join(root, "docs", "historico", "outputs");
const prompts = JSON.parse(
  await readFile(path.join(root, "benchmarks", "prompts.json"), "utf8"),
);
const promptById = new Map(prompts.map((prompt) => [prompt.id, prompt]));

// Keep this normalization identical to scripts/benchmark.mjs so the WER values
// can be compared against the existing Whisper runs on the same recordings.
function normalize(text) {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordErrorRate(expected, actual) {
  const reference = normalize(expected).split(" ").filter(Boolean);
  const hypothesis = normalize(actual).split(" ").filter(Boolean);
  const matrix = Array.from({ length: reference.length + 1 }, () =>
    Array(hypothesis.length + 1).fill(0),
  );
  for (let i = 0; i <= reference.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= hypothesis.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= reference.length; i++) {
    for (let j = 1; j <= hypothesis.length; j++) {
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] +
          (reference[i - 1] === hypothesis[j - 1] ? 0 : 1),
      );
    }
  }
  return reference.length
    ? matrix[reference.length][hypothesis.length] / reference.length
    : 0;
}

const details = [];
for (const sampleFile of (await readdir(samplesDir)).filter((file) =>
  file.toLowerCase().endsWith(".wav"),
)) {
  const id = path.parse(sampleFile).name;
  const prompt = promptById.get(id);
  if (!prompt) continue;
  const result = await transcribeParakeetWav({
    projectRoot: root,
    wavBuffer: await readFile(path.join(samplesDir, sampleFile)),
  });
  const wer = wordErrorRate(prompt.text, result.text);
  details.push({
    sample: sampleFile,
    expected: prompt.text,
    actual: result.text,
    wer,
    elapsedMs: result.elapsedMs,
  });
  console.log(
    `${id}: ${(result.elapsedMs / 1000).toFixed(2)} s, WER ${(wer * 100).toFixed(1)}% — ${result.text}`,
  );
}

const summary = {
  model: "parakeet-tdt-0.6b-v3.q8_0.gguf",
  samples: details.length,
  averageWer:
    details.reduce((sum, row) => sum + row.wer, 0) / details.length,
  averageElapsedMs:
    details.reduce((sum, row) => sum + row.elapsedMs, 0) / details.length,
};
console.log(JSON.stringify(summary, null, 2));
await mkdir(resultsDir, { recursive: true });
await writeFile(
  path.join(resultsDir, "parakeet-v3-q8-report.json"),
  JSON.stringify({ generatedAt: new Date().toISOString(), summary, details }, null, 2),
);
