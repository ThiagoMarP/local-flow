import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

const root = process.cwd();
const whisperPath =
  process.env.WHISPER_CLI ||
  path.join(root, "native", "whisper", "whisper-cli.exe");
const modelsDir = path.join(root, "models");
const samplesDir =
  process.env.BENCHMARK_SAMPLES_DIR ||
  path.join(root, "benchmarks", "samples");
const resultsDir =
  process.env.BENCHMARK_RESULTS_DIR ||
  path.join(root, "benchmarks", "results");
const threadCount = String(process.env.WHISPER_THREADS || 12);
const initialPrompt = process.env.WHISPER_INITIAL_PROMPT?.trim() || "";
const prompts = JSON.parse(
  await readFile(path.join(root, "benchmarks", "prompts.json"), "utf8"),
);

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
      const substitution =
        matrix[i - 1][j - 1] +
        (reference[i - 1] === hypothesis[j - 1] ? 0 : 1);
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        substitution,
      );
    }
  }

  return reference.length
    ? matrix[reference.length][hypothesis.length] / reference.length
    : 0;
}

function runWhisper(model, sample, outputBase) {
  return new Promise((resolve, reject) => {
    const args = [
      "-m",
      model,
      "-f",
      sample,
      "-l",
      "pt",
      "-t",
      threadCount,
      "-nt",
      "-oj",
      "-of",
      outputBase,
    ];
    if (initialPrompt) {
      args.push("--prompt", initialPrompt, "--carry-initial-prompt");
    }
    const startedAt = performance.now();
    const child = spawn(whisperPath, args, {
      cwd: root,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const elapsedMs = performance.now() - startedAt;
      if (code !== 0) {
        reject(
          new Error(
            `whisper-cli terminou com código ${code}\n${stdout}\n${stderr}`,
          ),
        );
        return;
      }
      resolve({ elapsedMs, stdout, stderr });
    });
  });
}

async function getWavDurationSeconds(file) {
  const buffer = await readFile(file);
  if (buffer.toString("ascii", 0, 4) !== "RIFF") {
    throw new Error(`${file} não é um arquivo WAV RIFF.`);
  }

  let offset = 12;
  let bytesPerSecond = 0;
  let dataBytes = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const contentOffset = offset + 8;
    if (id === "fmt ") {
      bytesPerSecond = buffer.readUInt32LE(contentOffset + 8);
    }
    if (id === "data") {
      dataBytes = size;
      break;
    }
    offset = contentOffset + size + (size % 2);
  }

  if (!bytesPerSecond || !dataBytes) {
    throw new Error(`Não foi possível determinar a duração de ${file}.`);
  }
  return dataBytes / bytesPerSecond;
}

function extractText(json) {
  if (typeof json.text === "string") return json.text.trim();
  if (Array.isArray(json.transcription)) {
    return json.transcription
      .map((item) => item.text || item.texts?.[0] || "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return "";
}

await mkdir(resultsDir, { recursive: true });

const requestedModels = process.argv.slice(2);
const modelFiles = (await readdir(modelsDir))
  .filter((file) => file.endsWith(".bin"))
  .filter(
    (file) =>
      requestedModels.length === 0 ||
      requestedModels.some((name) => file.includes(name)),
  );
const sampleFiles = (await readdir(samplesDir)).filter((file) =>
  file.toLowerCase().endsWith(".wav"),
);

if (modelFiles.length === 0) {
  throw new Error("Nenhum modelo encontrado em models/.");
}
if (sampleFiles.length === 0) {
  throw new Error("Nenhuma amostra WAV encontrada em benchmarks/samples/.");
}

const promptById = new Map(prompts.map((prompt) => [prompt.id, prompt]));
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const details = [];

for (const modelFile of modelFiles) {
  const model = path.join(modelsDir, modelFile);
  for (const sampleFile of sampleFiles) {
    const id = path.parse(sampleFile).name;
    const prompt = promptById.get(id);
    if (!prompt) {
      console.warn(`Ignorando ${sampleFile}: não existe em prompts.json.`);
      continue;
    }

    const sample = path.join(samplesDir, sampleFile);
    const durationSeconds = await getWavDurationSeconds(sample);
    const outputBase = path.join(resultsDir, `${runId}-${modelFile}-${id}`);
    process.stdout.write(`Testando ${modelFile} / ${id}… `);
    const result = await runWhisper(model, sample, outputBase);
    const json = JSON.parse(await readFile(`${outputBase}.json`, "utf8"));
    const text = extractText(json);
    const wer = wordErrorRate(prompt.text, text);
    details.push({
      model: modelFile,
      sample: sampleFile,
      category: prompt.category,
      expected: prompt.text,
      actual: text,
      wer,
      elapsedMs: result.elapsedMs,
      durationSeconds,
      realTimeFactor: result.elapsedMs / 1000 / durationSeconds,
    });
    console.log(`${(result.elapsedMs / 1000).toFixed(2)}s, WER ${(wer * 100).toFixed(1)}%`);
  }
}

const summaries = modelFiles.map((model) => {
  const rows = details.filter((row) => row.model === model);
  return {
    model,
    samples: rows.length,
    averageWer:
      rows.reduce((total, row) => total + row.wer, 0) / Math.max(1, rows.length),
    averageElapsedMs:
      rows.reduce((total, row) => total + row.elapsedMs, 0) /
      Math.max(1, rows.length),
    maxElapsedMs: Math.max(...rows.map((row) => row.elapsedMs)),
    averageRealTimeFactor:
      rows.reduce((total, row) => total + row.realTimeFactor, 0) /
      Math.max(1, rows.length),
  };
});

const report = {
  generatedAt: new Date().toISOString(),
  whisperPath,
  threadCount: Number(threadCount),
  initialPrompt: initialPrompt || null,
  summaries,
  details,
};
await writeFile(
  path.join(resultsDir, `${runId}-report.json`),
  JSON.stringify(report, null, 2),
);

const markdown = [
  `# Benchmark Whisper — ${runId}`,
  "",
  `Threads: ${threadCount}`,
  `Vocabulário inicial: ${initialPrompt || "nenhum"}`,
  "",
  "| Modelo | Amostras | WER médio | Tempo médio | Pior tempo | Fator de tempo real |",
  "|---|---:|---:|---:|---:|---:|",
  ...summaries.map(
    (row) =>
      `| ${row.model} | ${row.samples} | ${(row.averageWer * 100).toFixed(1)}% | ${(row.averageElapsedMs / 1000).toFixed(2)}s | ${(row.maxElapsedMs / 1000).toFixed(2)}s | ${row.averageRealTimeFactor.toFixed(2)}x |`,
  ),
  "",
  "## Resultados por frase",
  "",
  ...details.flatMap((row) => [
    `### ${row.model} — ${row.sample}`,
    "",
    `- Esperado: ${row.expected}`,
    `- Obtido: ${row.actual}`,
    `- WER: ${(row.wer * 100).toFixed(1)}%`,
    `- Tempo: ${(row.elapsedMs / 1000).toFixed(2)}s`,
    `- Duração do áudio: ${row.durationSeconds.toFixed(2)}s`,
    `- Fator de tempo real: ${row.realTimeFactor.toFixed(2)}x`,
    "",
  ]),
].join("\n");

const markdownPath = path.join(resultsDir, `${runId}-report.md`);
await writeFile(markdownPath, markdown);
console.log(`\nRelatório criado em ${markdownPath}`);
