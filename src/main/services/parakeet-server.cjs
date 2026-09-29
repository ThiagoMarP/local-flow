const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const net = require("node:net");
const { createAbortError, throwIfAborted } = require("./cancellation.cjs");

const DEFAULT_IDLE_MS = 10 * 60 * 1000;
const DEFAULT_STARTUP_TIMEOUT_MS = 30000;
const READY_POLL_MS = 100;

function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Keeps one `nemo-speech serve` process with the Parakeet model loaded, so a
// dictation skips the ~600 ms model load the CLI pays on every run. The server
// starts on first use and stops after `idleMs` without requests to give the
// ~800 MB back to the system.
class ParakeetServer {
  constructor({
    executable,
    idleMs = DEFAULT_IDLE_MS,
    startupTimeoutMs = DEFAULT_STARTUP_TIMEOUT_MS,
    spawnProcess = spawn,
    fetchImpl = globalThis.fetch,
    pickPort = findFreePort,
    onEvent = () => {},
  }) {
    this.executable = executable;
    this.idleMs = idleMs;
    this.startupTimeoutMs = startupTimeoutMs;
    this.spawnProcess = spawnProcess;
    this.fetchImpl = fetchImpl;
    this.pickPort = pickPort;
    this.onEvent = onEvent;
    this.current = null;
    this.starting = null;
    this.inFlight = 0;
    this.idleTimer = null;
    this.startFailed = false;
    this.disposed = false;
  }

  get available() {
    return !this.startFailed && !this.disposed;
  }

  // `withWords` asks for per-word timestamps (verbose_json), which meetings
  // need to interleave speakers; it then resolves to { text, words }.
  async transcribe({ wavBuffer, modelPath, timeoutMs = 120000, signal, withWords = false }) {
    throwIfAborted(signal);
    const server = await this.ensureStarted(modelPath);
    throwIfAborted(signal);
    this.inFlight += 1;
    this.clearIdleTimer();
    const requestSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);
    try {
      const form = new FormData();
      form.append("file", new Blob([wavBuffer], { type: "audio/wav" }), "audio.wav");
      form.append("response_format", withWords ? "verbose_json" : "json");
      const response = await this.fetchImpl(
        `${server.baseUrl}/v1/audio/transcriptions`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${server.apiKey}` },
          body: form,
          signal: requestSignal,
        },
      );
      if (!response.ok) {
        throw new Error(`O servidor Parakeet respondeu HTTP ${response.status}.`);
      }
      const payload = await response.json();
      const text = typeof payload?.text === "string" ? payload.text : "";
      if (!withWords) return text;
      return { text, words: Array.isArray(payload?.words) ? payload.words : [] };
    } catch (error) {
      if (signal?.aborted) throw createAbortError();
      if (requestSignal.aborted) {
        throw new Error(
          `A transcrição excedeu o limite de ${Math.round(timeoutMs / 1000)} segundos.`,
        );
      }
      throw error;
    } finally {
      this.inFlight -= 1;
      this.scheduleIdleStop();
    }
  }

  async ensureStarted(modelPath) {
    if (this.disposed) throw new Error("O servidor Parakeet foi encerrado.");
    if (this.current?.modelPath === modelPath && !this.current.exited) {
      return this.current;
    }
    if (this.starting?.modelPath === modelPath) return this.starting.promise;
    if (this.current) this.stop("model_changed");
    const promise = this.start(modelPath).finally(() => {
      if (this.starting?.promise === promise) this.starting = null;
    });
    this.starting = { modelPath, promise };
    return promise;
  }

  async start(modelPath) {
    const startedAt = Date.now();
    const port = await this.pickPort();
    const apiKey = randomBytes(24).toString("hex");
    const child = this.spawnProcess(
      this.executable,
      [
        "--quiet",
        "serve",
        "--asr-model",
        modelPath,
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--no-ui",
      ],
      {
        windowsHide: true,
        stdio: "ignore",
        // The docs recommend the environment over argv so the key does not
        // show up in process listings.
        env: { ...process.env, NEMO_SPEECH_HTTP_API_KEY: apiKey },
      },
    );
    const server = {
      child,
      modelPath,
      apiKey,
      baseUrl: `http://127.0.0.1:${port}`,
      exited: false,
    };
    child.once("exit", (code) => {
      server.exited = true;
      if (this.current === server) {
        this.current = null;
        this.clearIdleTimer();
        this.onEvent("parakeet_server_exited", { code });
      }
    });
    child.once("error", () => {
      server.exited = true;
    });

    const deadline = startedAt + this.startupTimeoutMs;
    while (Date.now() < deadline && !server.exited && !this.disposed) {
      let ready = false;
      try {
        ready = (await this.fetchImpl(`${server.baseUrl}/ready`)).ok;
      } catch {
        // The listener is not up yet.
      }
      if (ready && !this.disposed) {
        this.current = server;
        this.onEvent("parakeet_server_ready", { startupMs: Date.now() - startedAt });
        this.scheduleIdleStop();
        return server;
      }
      if (!ready) await delay(READY_POLL_MS);
    }
    if (this.disposed) {
      child.kill();
      throw new Error("O servidor Parakeet foi encerrado.");
    }
    child.kill();
    this.startFailed = true;
    this.onEvent("parakeet_server_start_failed", {
      exited: server.exited,
      elapsedMs: Date.now() - startedAt,
    });
    throw new Error("O servidor Parakeet não ficou pronto.");
  }

  scheduleIdleStop() {
    this.clearIdleTimer();
    if (!this.current || this.inFlight > 0) return;
    this.idleTimer = setTimeout(() => this.stop("idle"), this.idleMs);
    this.idleTimer.unref?.();
  }

  clearIdleTimer() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  stop(reason = "requested") {
    this.clearIdleTimer();
    const server = this.current;
    this.current = null;
    if (!server || server.exited) return;
    server.child.kill();
    this.onEvent("parakeet_server_stopped", { reason });
  }

  dispose() {
    this.disposed = true;
    this.stop("dispose");
  }
}

module.exports = { ParakeetServer, findFreePort };
