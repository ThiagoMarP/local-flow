const { createWriteStream } = require("node:fs");
const { createHash } = require("node:crypto");
const { lstat, mkdir, rename, rm, stat } = require("node:fs/promises");
const path = require("node:path");
const { Readable, Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");

// Whisper profiles match MODEL_FILES in whisper-service.cjs. Parakeet uses a
// separate engine and its official GGUF release is pinned for reproducibility.
const MODEL_CATALOG = Object.freeze({
  fast: {
    profile: "fast",
    name: "Small · rápido",
    file: "ggml-small-q5_1.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin",
    approxBytes: 190085487,
  },
  standard: {
    profile: "standard",
    name: "Medium · padrão",
    file: "ggml-medium-q5_0.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium-q5_0.bin",
    approxBytes: 539212467,
  },
  accurate: {
    profile: "accurate",
    name: "Large V3 Turbo · precisão",
    file: "ggml-large-v3-turbo-q5_0.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin",
    approxBytes: 574041195,
  },
  parakeet: {
    profile: "parakeet",
    name: "Parakeet TDT 0.6B v3",
    file: "parakeet-tdt-0.6b-v3.q8_0.gguf",
    url: "https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3/resolve/541d1f99c6b0c3cd0b11a95167540bb8edefd82b/parakeet-tdt-0.6b-v3.q8_0.gguf",
    approxBytes: 713975456,
    sha256: "e3880d0aaaaf2c308ea2c35016b2b895c423eb3fda924c1b463d1c19b7f4d32e",
  },
});

function resolveModelEntry(profile) {
  const entry = MODEL_CATALOG[profile];
  if (!entry) {
    throw new Error(`Perfil de modelo inválido: ${profile}`);
  }
  return entry;
}

// Default network transport. Returns a Node Readable so the installer never has
// to know whether bytes came from fetch, a file, or a test fake.
async function fetchTransport(url, { signal, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url, { signal, redirect: "follow" });
  if (!response.ok || !response.body) {
    return { ok: false, status: response.status, total: 0, stream: null };
  }
  const total = Number(response.headers.get("content-length")) || 0;
  return {
    ok: true,
    status: response.status,
    total,
    stream: Readable.fromWeb(response.body),
  };
}

// Old development builds could leave `models` as a Windows junction. If its
// target was later removed, mkdir sees the junction but downloads cannot open
// a file through it. Heal only that precise case: a valid directory (including
// a valid junction) is preserved, and a normal file still raises an error.
async function ensureWritableModelsDir(modelsDir) {
  try {
    const info = await stat(modelsDir);
    if (!info.isDirectory()) {
      throw new Error(`A pasta de modelos não é um diretório: ${modelsDir}`);
    }
    return;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  try {
    const link = await lstat(modelsDir);
    if (!link.isSymbolicLink()) {
      throw new Error(`A pasta de modelos não pôde ser acessada: ${modelsDir}`);
    }
    await rm(modelsDir, { force: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  await mkdir(modelsDir, { recursive: true });
}

class ModelInstaller {
  constructor({ modelsDir, transport = fetchTransport, minRatio = 0.9 } = {}) {
    if (!modelsDir) {
      throw new Error("modelsDir é obrigatório.");
    }
    this.modelsDir = modelsDir;
    this.transport = transport;
    this.minRatio = minRatio;
    this.active = new Map();
  }

  list() {
    return Object.values(MODEL_CATALOG);
  }

  isDownloading(profile) {
    return this.active.has(profile);
  }

  async status() {
    const profiles = {};
    for (const entry of Object.values(MODEL_CATALOG)) {
      const target = path.join(this.modelsDir, entry.file);
      let available = false;
      let bytes = 0;
      try {
        const info = await stat(target);
        bytes = info.size;
        available = entry.sha256
          ? info.size === entry.approxBytes
          : info.size >= entry.approxBytes * this.minRatio;
      } catch {
        available = false;
      }
      profiles[entry.profile] = {
        profile: entry.profile,
        name: entry.name,
        file: entry.file,
        approxBytes: entry.approxBytes,
        available,
        bytes,
        downloading: this.active.has(entry.profile),
      };
    }
    return profiles;
  }

  cancel(profile) {
    const controller = this.active.get(profile);
    if (controller) controller.abort();
    return Boolean(controller);
  }

  async download(profile, { onProgress } = {}) {
    const entry = resolveModelEntry(profile);
    if (this.active.has(profile)) {
      throw new Error(`O modelo ${entry.name} já está sendo baixado.`);
    }
    const controller = new AbortController();
    this.active.set(profile, controller);
    const target = path.join(this.modelsDir, entry.file);
    const temp = `${target}.part`;

    try {
      await ensureWritableModelsDir(this.modelsDir);
      await rm(temp, { force: true });
      const { ok, status, total, stream } = await this.transport(entry.url, {
        signal: controller.signal,
      });
      if (!ok || !stream) {
        throw new Error(
          `Falha ao baixar ${entry.name}: resposta HTTP ${status || "desconhecida"}.`,
        );
      }

      const expected = total || entry.approxBytes;
      let received = 0;
      const hash = entry.sha256 ? createHash("sha256") : null;
      const counter = new Transform({
        transform: (chunk, _encoding, callback) => {
          received += chunk.length;
          hash?.update(chunk);
          onProgress?.({
            profile,
            name: entry.name,
            received,
            total: expected,
            ratio: expected ? Math.min(1, received / expected) : 0,
            done: false,
          });
          callback(null, chunk);
        },
      });

      await pipeline(stream, counter, createWriteStream(temp));

      if (entry.sha256 ? received !== entry.approxBytes : received < entry.approxBytes * this.minRatio) {
        throw new Error(
          `O download de ${entry.name} ficou incompleto (${received} bytes).`,
        );
      }
      if (hash && hash.digest("hex") !== entry.sha256) {
        throw new Error(`O download de ${entry.name} não passou na verificação de integridade.`);
      }

      await rename(temp, target);
      onProgress?.({
        profile,
        name: entry.name,
        received,
        total: expected,
        ratio: 1,
        done: true,
      });
      return { profile, file: entry.file, bytes: received, path: target };
    } catch (error) {
      await rm(temp, { force: true }).catch(() => {});
      throw error;
    } finally {
      this.active.delete(profile);
    }
  }
}

module.exports = {
  MODEL_CATALOG,
  ModelInstaller,
  ensureWritableModelsDir,
  fetchTransport,
  resolveModelEntry,
};
