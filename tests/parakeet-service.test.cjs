const assert = require("node:assert/strict");
const test = require("node:test");
const { mkdtemp, readFile, rm, stat, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  PARAKEET_MODEL_FILE,
  runParakeetCli,
  transcribeParakeetWav,
} = require("../src/main/services/parakeet-service.cjs");

function oneSecondWav() {
  const samples = 16000;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + samples * 2, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(samples * 2, 40);
  return wav;
}

test("prepara WAV e chama o runtime oficial com o modelo local", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "local-flow-parakeet-test-"));
  const parakeetCli = path.join(dir, "nemo-speech.exe");
  const modelPath = path.join(dir, PARAKEET_MODEL_FILE);
  const wavBuffer = oneSecondWav();
  await writeFile(parakeetCli, "");
  await writeFile(modelPath, "");
  let jobDir;
  try {
    const result = await transcribeParakeetWav({
      parakeetCli,
      modelsDir: dir,
      wavBuffer,
      processRunner: async (executable, args, options) => {
        assert.equal(executable, parakeetCli);
        assert.deepEqual(args.slice(0, 2), ["--quiet", "transcribe"]);
        assert.equal(args[3], "--model");
        assert.equal(args[4], modelPath);
        // O CLI é o plano B quando o servidor (GPU) falha: sempre na CPU.
        assert.deepEqual(args.slice(5), ["--device", "cpu", "--format", "text"]);
        assert.deepEqual(await readFile(args[2]), wavBuffer);
        assert.equal(path.dirname(args[2]), options.cwd);
        jobDir = options.cwd;
        return "Olá mundo.\n";
      },
    });
    assert.equal(result.text, "Olá mundo.");
    assert.equal(result.profile, "parakeet");
    assert.equal(result.durationSeconds, 1);
    await assert.rejects(stat(jobDir), { code: "ENOENT" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("informa quando o modelo ainda não foi baixado", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "local-flow-parakeet-test-"));
  const parakeetCli = path.join(dir, "nemo-speech.exe");
  await writeFile(parakeetCli, "");
  try {
    await assert.rejects(
      transcribeParakeetWav({
        parakeetCli,
        modelsDir: dir,
        wavBuffer: oneSecondWav(),
      }),
      { code: "MODEL_NOT_INSTALLED" },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Parakeet não inicia um trabalho previamente cancelado", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    transcribeParakeetWav({ wavBuffer: oneSecondWav(), signal: controller.signal }),
    { name: "AbortError", code: "ABORT_ERR" },
  );
});

test("cancelar Parakeet encerra o subprocesso em andamento", async () => {
  const controller = new AbortController();
  const running = runParakeetCli(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    { signal: controller.signal, timeoutMs: 5000 },
  );
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(running, { name: "AbortError", code: "ABORT_ERR" });
});

async function withRuntime(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "local-flow-parakeet-test-"));
  const parakeetCli = path.join(dir, "nemo-speech.exe");
  await writeFile(parakeetCli, "");
  await writeFile(path.join(dir, PARAKEET_MODEL_FILE), "");
  try {
    await run({ modelsDir: dir, parakeetCli, wavBuffer: oneSecondWav() });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const cliMustNotRun = () => {
  throw new Error("CLI não deveria executar");
};

test("usa o servidor quente quando disponível, sem chamar o CLI", async () => {
  await withRuntime(async (runtime) => {
    const calls = [];
    const result = await transcribeParakeetWav({
      ...runtime,
      server: {
        available: true,
        transcribe: async (options) => {
          calls.push(options);
          return "Olá do servidor.\n";
        },
      },
      processRunner: cliMustNotRun,
    });
    assert.equal(result.text, "Olá do servidor.");
    assert.equal(calls[0].modelPath, path.join(runtime.modelsDir, PARAKEET_MODEL_FILE));
  });
});

test("volta ao CLI quando o servidor quente falha", async () => {
  await withRuntime(async (runtime) => {
    const fallbacks = [];
    const result = await transcribeParakeetWav({
      ...runtime,
      server: {
        available: true,
        transcribe: async () => {
          throw new Error("HTTP 500");
        },
      },
      onServerFallback: (error) => fallbacks.push(error.message),
      processRunner: async () => "Olá do CLI.",
    });
    assert.equal(result.text, "Olá do CLI.");
    assert.deepEqual(fallbacks, ["HTTP 500"]);
  });
});

test("não recorre ao CLI quando o ditado é cancelado no servidor", async () => {
  await withRuntime(async (runtime) => {
    const controller = new AbortController();
    await assert.rejects(
      transcribeParakeetWav({
        ...runtime,
        signal: controller.signal,
        server: {
          available: true,
          transcribe: async () => {
            controller.abort();
            const error = new Error("Ditado cancelado.");
            error.name = "AbortError";
            throw error;
          },
        },
        processRunner: cliMustNotRun,
      }),
      { name: "AbortError" },
    );
  });
});

test("ignora o servidor quando ele está indisponível", async () => {
  await withRuntime(async (runtime) => {
    const result = await transcribeParakeetWav({
      ...runtime,
      server: {
        available: false,
        transcribe: () => {
          throw new Error("servidor não deveria executar");
        },
      },
      processRunner: async () => "Olá do CLI.",
    });
    assert.equal(result.text, "Olá do CLI.");
  });
});

const { wordsToSegments } = require("../src/main/services/parakeet-service.cjs");

// Horários do Parakeet vêm em segundos por palavra; a reunião usa trechos em
// milissegundos, como os do Whisper.
test("agrupa palavras em trechos por frase e por pausa", () => {
  const words = [
    { word: "Bom", start: 0.5, end: 0.8 },
    { word: "dia.", start: 0.8, end: 1.2 },
    { word: "Vamos", start: 1.4, end: 1.7 },
    { word: "começar", start: 1.7, end: 2.2 },
    // pausa longa: novo trecho mesmo sem pontuação
    { word: "então", start: 4.0, end: 4.4 },
  ];
  assert.deepEqual(wordsToSegments(words), [
    { from: 500, to: 1200, text: "Bom dia." },
    { from: 1400, to: 2200, text: "Vamos começar" },
    { from: 4000, to: 4400, text: "então" },
  ]);
  assert.deepEqual(wordsToSegments([]), []);
  assert.deepEqual(wordsToSegments(undefined), []);
});

test("corta trecho longo sem pontuação em até 20 s", () => {
  const words = Array.from({ length: 60 }, (_, index) => ({
    word: "palavra",
    start: index * 0.5,
    end: index * 0.5 + 0.4,
  }));
  const segments = wordsToSegments(words);
  assert.ok(segments.length >= 2);
  for (const segment of segments) assert.ok(segment.to - segment.from <= 20_000);
});

test("com horários pelo servidor, devolve os trechos", async () => {
  await withRuntime(async (runtime) => {
    const calls = [];
    const result = await transcribeParakeetWav({
      ...runtime,
      withTimestamps: true,
      server: {
        available: true,
        transcribe: async (options) => {
          calls.push(options);
          return { text: "Oi. Tudo bem?", words: [
            { word: "Oi.", start: 0.1, end: 0.4 },
            { word: "Tudo", start: 0.6, end: 0.8 },
            { word: "bem?", start: 0.8, end: 1.0 },
          ] };
        },
      },
      processRunner: cliMustNotRun,
    });
    assert.equal(calls[0].withWords, true);
    assert.equal(result.text, "Oi. Tudo bem?");
    assert.deepEqual(result.segments, [
      { from: 100, to: 400, text: "Oi." },
      { from: 600, to: 1000, text: "Tudo bem?" },
    ]);
  });
});

test("com horários pelo CLI, usa --json e devolve os trechos", async () => {
  await withRuntime(async (runtime) => {
    let args;
    const result = await transcribeParakeetWav({
      ...runtime,
      withTimestamps: true,
      processRunner: async (_cli, cliArgs) => {
        args = cliArgs;
        return JSON.stringify({ text: "Oi.", words: [{ word: "Oi.", start: 0.2, end: 0.5 }] });
      },
    });
    assert.ok(args.includes("--json"));
    assert.ok(!args.includes("--format"));
    assert.deepEqual(result.segments, [{ from: 200, to: 500, text: "Oi." }]);
  });
});
