// Meeting history (Fase E). Each capture is a folder under userData/
// meeting-captures/<timestamp>/ holding mic.wav, system.wav, transcript.txt,
// resumo.md and meta.json. This store lists and reads them for the "Reuniões"
// page — no separate index file; the folders on disk are the source of truth.

const { readdir, readFile, rm, stat } = require("node:fs/promises");
const path = require("node:path");

// Folder names come from new Date().toISOString().replace(/[:.]/g, "-"), e.g.
// "2026-06-30T19-11-05-350Z". Recover the timestamp for folders saved before
// meta.json existed.
function parseFolderDate(name) {
  const match = String(name).match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
  );
  if (!match) return null;
  const value = Date.parse(
    `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`,
  );
  return Number.isFinite(value) ? value : null;
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

class MeetingStore {
  constructor({ baseDir }) {
    if (!baseDir) throw new Error("baseDir é obrigatório.");
    this.baseDir = baseDir;
  }

  // Reject anything that isn't a plain folder name, so a crafted id can't walk
  // out of the captures directory.
  safeId(id) {
    const name = path.basename(String(id || ""));
    if (!name || name === "." || name === "..") {
      throw new Error("Identificador de reunião inválido.");
    }
    return name;
  }

  // Light record for the list: metadata plus the summary markdown (small), so
  // the page can render and search without a second call per meeting. The full
  // transcript is loaded lazily by get().
  async summary(id) {
    const dir = path.join(this.baseDir, id);
    let meta = {};
    try {
      meta = JSON.parse(await readFile(path.join(dir, "meta.json"), "utf8"));
    } catch {
      meta = {};
    }
    const summaryText = await readFile(
      path.join(dir, "resumo.md"),
      "utf8",
    ).catch(() => "");
    const hasTranscript = await exists(path.join(dir, "transcript.txt"));
    return {
      id,
      at: Number(meta.at) || parseFolderDate(id) || 0,
      durationSeconds: Number(meta.durationSeconds) || 0,
      turns: Number.isFinite(meta.turns) ? meta.turns : null,
      summarized: Boolean(meta.summarized),
      state: typeof meta.state === "string" ? meta.state : hasTranscript ? "done" : "failed",
      interrupted: Boolean(meta.interrupted),
      error: typeof meta.error === "string" ? meta.error : null,
      failureCount: Array.isArray(meta.failures) ? meta.failures.length : 0,
      hasTranscript,
      hasSummary: Boolean(summaryText),
      summary: summaryText,
    };
  }

  async list() {
    let entries;
    try {
      entries = await readdir(this.baseDir, { withFileTypes: true });
    } catch {
      return [];
    }
    const meetings = [];
    for (const entry of entries) {
      if (entry.isDirectory()) meetings.push(await this.summary(entry.name));
    }
    return meetings.sort((a, b) => b.at - a.at);
  }

  async get(id) {
    const safe = this.safeId(id);
    const dir = path.join(this.baseDir, safe);
    const base = await this.summary(safe);
    const [transcript, summary] = await Promise.all([
      readFile(path.join(dir, "transcript.txt"), "utf8").catch(() => ""),
      readFile(path.join(dir, "resumo.md"), "utf8").catch(() => ""),
    ]);
    return { ...base, transcript, summary };
  }

  async remove(id) {
    const safe = this.safeId(id);
    const current = await this.summary(safe);
    if (current.state === "recording" || current.state === "processing") {
      throw new Error("Aguarde a reunião terminar antes de excluí-la.");
    }
    await rm(path.join(this.baseDir, safe), { recursive: true, force: true });
    return this.list();
  }
}

module.exports = { MeetingStore, parseFolderDate };
