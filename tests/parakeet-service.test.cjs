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
        assert.deepEqual(args.slice(5), ["--format", "text"]);
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
