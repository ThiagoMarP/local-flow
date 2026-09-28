const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { ParakeetServer } = require("../src/main/services/parakeet-server.cjs");

function fakeRuntime({ readyAfter = 0, exitOnStart = false, respond } = {}) {
  const spawns = [];
  const requests = [];
  const spawnProcess = (executable, args, options) => {
    const child = new EventEmitter();
    child.killed = false;
    child.kill = () => {
      if (child.killed) return;
      child.killed = true;
      setImmediate(() => child.emit("exit", null));
    };
    spawns.push({ executable, args, options, child, readyPolls: 0 });
    if (exitOnStart) setImmediate(() => child.emit("exit", 1));
    return child;
  };
  const fetchImpl = async (url, init = {}) => {
    const current = spawns.at(-1);
    if (url.endsWith("/ready")) {
      current.readyPolls += 1;
      if (exitOnStart || current.child.killed || current.readyPolls <= readyAfter) {
        throw new Error("ECONNREFUSED");
      }
      return { ok: true };
    }
    requests.push({ url, init });
    if (respond) return respond(init);
    return { ok: true, json: async () => ({ text: "Olá." }) };
  };
  return { spawns, requests, spawnProcess, fetchImpl, pickPort: async () => 4321 };
}

function createServer(runtime, options = {}) {
  return new ParakeetServer({
    executable: "C:\\nemo-speech.exe",
    spawnProcess: runtime.spawnProcess,
    fetchImpl: runtime.fetchImpl,
    pickPort: runtime.pickPort,
    ...options,
  });
}

const wav = Buffer.from("RIFF");
const request = (extra = {}) => ({ wavBuffer: wav, modelPath: "m.gguf", ...extra });

test("sobe o servidor sob demanda e reaproveita entre ditados", async () => {
  const runtime = fakeRuntime({ readyAfter: 2 });
  const server = createServer(runtime);
  try {
    assert.equal(runtime.spawns.length, 0);
    assert.equal(await server.transcribe(request()), "Olá.");
    assert.equal(await server.transcribe(request()), "Olá.");
    assert.equal(runtime.spawns.length, 1);
    assert.deepEqual(runtime.spawns[0].args, [
      "--quiet", "serve", "--asr-model", "m.gguf",
      "--host", "127.0.0.1", "--port", "4321", "--no-ui",
    ]);
    assert.equal(
      runtime.requests[0].url,
      "http://127.0.0.1:4321/v1/audio/transcriptions",
    );
  } finally {
    server.dispose();
  }
});

test("passa a chave pela variável de ambiente, nunca pela linha de comando", async () => {
  const runtime = fakeRuntime();
  const server = createServer(runtime);
  try {
    await server.transcribe(request());
    const { args, options } = runtime.spawns[0];
    const key = options.env.NEMO_SPEECH_HTTP_API_KEY;
    assert.match(key, /^[0-9a-f]{48}$/);
    assert.ok(!args.some((arg) => arg.includes(key)));
    assert.equal(runtime.requests[0].init.headers.Authorization, `Bearer ${key}`);
  } finally {
    server.dispose();
  }
});

test("ditados simultâneos compartilham a mesma subida", async () => {
  const runtime = fakeRuntime({ readyAfter: 3 });
  const server = createServer(runtime);
  try {
    await Promise.all([server.transcribe(request()), server.transcribe(request())]);
    assert.equal(runtime.spawns.length, 1);
  } finally {
    server.dispose();
  }
});

test("desliga sozinho depois do tempo ocioso e sobe de novo no próximo ditado", async () => {
  const runtime = fakeRuntime();
  const events = [];
  const server = createServer(runtime, {
    idleMs: 20,
    onEvent: (event, metadata) => events.push({ event, metadata }),
  });
  try {
    await server.transcribe(request());
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(runtime.spawns[0].child.killed, true);
    assert.ok(events.some(
      (e) => e.event === "parakeet_server_stopped" && e.metadata.reason === "idle",
    ));
    await server.transcribe(request());
    assert.equal(runtime.spawns.length, 2);
  } finally {
    server.dispose();
  }
});

test("não desliga por ociosidade durante um ditado em andamento", async () => {
  let release;
  const runtime = fakeRuntime({
    respond: () => new Promise((resolve) => {
      release = () => resolve({ ok: true, json: async () => ({ text: "Longo." }) });
    }),
  });
  const server = createServer(runtime, { idleMs: 10 });
  try {
    const running = server.transcribe(request());
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(runtime.spawns[0].child.killed, false);
    release();
    assert.equal(await running, "Longo.");
  } finally {
    server.dispose();
  }
});

test("desativa o servidor quando ele não consegue subir", async () => {
  const runtime = fakeRuntime({ exitOnStart: true });
  const events = [];
  const server = createServer(runtime, { onEvent: (event) => events.push(event) });
  await assert.rejects(server.transcribe(request()));
  assert.equal(server.available, false);
  assert.ok(events.includes("parakeet_server_start_failed"));
});

test("cancelar o ditado rejeita com AbortError e mantém o servidor", async () => {
  const runtime = fakeRuntime({
    respond: (init) => new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")));
    }),
  });
  const server = createServer(runtime);
  const controller = new AbortController();
  try {
    const running = server.transcribe(request({ signal: controller.signal }));
    setTimeout(() => controller.abort(), 20);
    await assert.rejects(running, { name: "AbortError" });
    assert.equal(server.available, true);
  } finally {
    server.dispose();
  }
});

test("erro HTTP vira falha para o chamador recorrer ao CLI", async () => {
  const runtime = fakeRuntime({ respond: async () => ({ ok: false, status: 500 }) });
  const server = createServer(runtime);
  try {
    await assert.rejects(server.transcribe(request()), /HTTP 500/);
  } finally {
    server.dispose();
  }
});

test("encerrar o app mata o processo do servidor", async () => {
  const runtime = fakeRuntime();
  const server = createServer(runtime);
  await server.transcribe(request());
  server.dispose();
  assert.equal(runtime.spawns[0].child.killed, true);
  assert.equal(server.available, false);
});
