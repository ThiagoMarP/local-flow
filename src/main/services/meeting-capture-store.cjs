// Durable, bounded meeting capture. A committed chunk is one renamed directory
// containing both channels, so a crash cannot leave a half-pair in the queue.
const { randomUUID } = require("node:crypto");
const { mkdir, readFile, readdir, rename, rm, stat, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { validateWav } = require("../whisper-service.cjs");

const MAX_CHUNK_BYTES = 2 * 1024 * 1024; // comfortably above a 10-second 16 kHz WAV

function chunkName(index) {
  return String(index).padStart(6, "0");
}

function validChunk(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length > MAX_CHUNK_BYTES) {
    throw new Error("Bloco de reunião inválido ou grande demais.");
  }
  if (buffer.length === 44) {
    if (buffer.toString("ascii", 0, 4) !== "RIFF" ||
      buffer.toString("ascii", 8, 12) !== "WAVE" ||
      buffer.toString("ascii", 36, 40) !== "data" ||
      buffer.readUInt32LE(24) !== 16000 ||
      buffer.readUInt16LE(22) !== 1 ||
      buffer.readUInt16LE(34) !== 16 ||
      buffer.readUInt32LE(40) !== 0) {
      throw new Error("Bloco de reunião vazio inválido.");
    }
    return 0;
  }
  return validateWav(buffer).durationSeconds;
}

class MeetingCaptureStore {
  constructor({ baseDir }) {
    if (!baseDir) throw new Error("baseDir é obrigatório.");
    this.baseDir = baseDir;
  }

  dir(id) {
    if (!/^[\dTZ-]+-[a-f0-9]{8}$/.test(String(id || ""))) {
      throw new Error("Identificador de captura inválido.");
    }
    return path.join(this.baseDir, id);
  }

  async readMeta(id) {
    return JSON.parse(await readFile(path.join(this.dir(id), "meta.json"), "utf8"));
  }

  async writeMeta(id, meta) {
    const target = path.join(this.dir(id), "meta.json");
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(meta), "utf8");
    await rename(temporary, target);
    return meta;
  }

  async start({ mode = "both", at = Date.now() } = {}) {
    await mkdir(this.baseDir, { recursive: true });
    const id = `${new Date(at).toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
    await mkdir(path.join(this.dir(id), "chunks"), { recursive: true });
    const meta = {
      at,
      mode,
      state: "recording",
      interrupted: false,
      chunkCount: 0,
      durationSeconds: 0,
      micSeconds: 0,
      systemSeconds: 0,
      turns: null,
      summarized: false,
    };
    await this.writeMeta(id, meta);
    return { id, ...meta };
  }

  async append({ id, index, micWav, systemWav }) {
    const meta = await this.readMeta(id);
    if (meta.state !== "recording" || !Number.isInteger(index) || index !== meta.chunkCount) {
      throw new Error("Bloco fora de ordem ou reunião não está gravando.");
    }
    const mic = Buffer.from(micWav || []);
    const system = Buffer.from(systemWav || []);
    const micSeconds = validChunk(mic);
    const systemSeconds = validChunk(system);
    if (micSeconds === 0 && systemSeconds === 0) return { id, index, skipped: true };
    const chunksDir = path.join(this.dir(id), "chunks");
    const temporary = path.join(chunksDir, `.${chunkName(index)}-${randomUUID()}.tmp`);
    const finalDir = path.join(chunksDir, chunkName(index));
    await mkdir(temporary);
    try {
      await Promise.all([
        writeFile(path.join(temporary, "mic.wav"), mic),
        writeFile(path.join(temporary, "system.wav"), system),
      ]);
      await rename(temporary, finalDir);
    } catch (error) {
      await rm(temporary, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
    const next = {
      ...meta,
      chunkCount: index + 1,
      durationSeconds: meta.durationSeconds + Math.max(micSeconds, systemSeconds),
      micSeconds: meta.micSeconds + micSeconds,
      systemSeconds: meta.systemSeconds + systemSeconds,
    };
    await this.writeMeta(id, next);
    return { id, index, chunkCount: next.chunkCount, durationSeconds: next.durationSeconds };
  }

  // Reconcile committed directories after a crash between atomic directory
  // rename and metadata update. Ignore .tmp directories and any gap.
  async reconcile(id) {
    const meta = await this.readMeta(id);
    const chunksDir = path.join(this.dir(id), "chunks");
    const names = new Set((await readdir(chunksDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^\d{6}$/.test(entry.name))
      .map((entry) => entry.name));
    let chunkCount = 0;
    let micSeconds = 0;
    let systemSeconds = 0;
    let durationSeconds = 0;
    while (names.has(chunkName(chunkCount))) {
      const dir = path.join(chunksDir, chunkName(chunkCount));
      const [mic, system] = await Promise.all([
        stat(path.join(dir, "mic.wav")),
        stat(path.join(dir, "system.wav")),
      ]);
      if (mic.size < 44 || system.size < 44 || mic.size > MAX_CHUNK_BYTES || system.size > MAX_CHUNK_BYTES) break;
      const micDuration = (mic.size - 44) / 32000;
      const systemDuration = (system.size - 44) / 32000;
      micSeconds += micDuration;
      systemSeconds += systemDuration;
      durationSeconds += Math.max(micDuration, systemDuration);
      chunkCount += 1;
    }
    return { ...meta, chunkCount, micSeconds, systemSeconds, durationSeconds };
  }

  async complete(id, { interrupted = false } = {}) {
    const meta = await this.reconcile(id);
    if (meta.state !== "recording" && meta.state !== "processing") {
      throw new Error("Reunião já foi finalizada.");
    }
    const next = {
      ...meta,
      state: meta.chunkCount ? "processing" : "failed",
      interrupted: Boolean(meta.interrupted || interrupted),
      error: meta.chunkCount ? null : "A gravação terminou sem áudio salvo.",
    };
    await this.writeMeta(id, next);
    return { id, dir: this.dir(id), ...next };
  }

  async finish(id, patch) {
    const meta = await this.readMeta(id);
    return this.writeMeta(id, { ...meta, ...patch });
  }

  async recoverPending() {
    await mkdir(this.baseDir, { recursive: true });
    const entries = await readdir(this.baseDir, { withFileTypes: true });
    const pending = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^[\dTZ-]+-[a-f0-9]{8}$/.test(entry.name)) continue;
      let meta;
      try { meta = await this.readMeta(entry.name); } catch { continue; }
      if (meta.state !== "recording" && meta.state !== "processing") continue;
      try {
        pending.push(await this.complete(entry.name, { interrupted: meta.state === "recording" }));
      } catch {
        // A damaged capture is left on disk for inspection; other meetings recover.
      }
    }
    return pending;
  }
}

module.exports = { MeetingCaptureStore, chunkName, validChunk };
