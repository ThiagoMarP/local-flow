const { mkdir, readFile, rename, stat, writeFile } = require("node:fs/promises");
const path = require("node:path");

// Persists a local-only history of transcriptions so the dashboard can show
// them again after the app is reopened. Never transmitted — consistent with
// the app's local-first design. Newest first.
const MAX_TEXT_LENGTH = 20000;
const MAX_ITEMS = 200;

class TranscriptionHistoryStore {
  constructor({ filePath, maxItems = MAX_ITEMS } = {}) {
    if (!filePath) throw new Error("filePath é obrigatório.");
    this.filePath = filePath;
    this.maxItems = maxItems;
    this.pendingWrite = Promise.resolve();
  }

  // Returns the full list, newest first, sanitized.
  async list() {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8"));
      const items = Array.isArray(parsed?.items) ? parsed.items : [];
      return items
        .filter(
          (item) => item && typeof item.text === "string" && item.text.trim(),
        )
        .map((item) => ({
          id: String(item.id || ""),
          text: item.text,
          originalText: typeof item.originalText === "string" && item.originalText.trim()
            ? item.originalText.slice(0, MAX_TEXT_LENGTH)
            : null,
          correctedText: typeof item.correctedText === "string" && item.correctedText.trim()
            ? item.correctedText.slice(0, MAX_TEXT_LENGTH)
            : null,
          at: Number.isFinite(item.at) ? item.at : null,
        }))
        .slice(0, this.maxItems);
    } catch {
      return [];
    }
  }

  // The most recent entry (used by the "last message" card), or null.
  async last() {
    const items = await this.list();
    return items[0] || null;
  }

  // The history file itself marks that migration has already been attempted.
  // An existing empty file means the user cleared history and must stay empty.
  async migrateLegacyOnce(legacyFilePath) {
    try {
      await stat(this.filePath);
      return false;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    let legacy = null;
    try {
      legacy = JSON.parse(await readFile(legacyFilePath, "utf8"));
    } catch {
      // Missing or invalid legacy data must not prevent an empty history.
    }
    if (typeof legacy?.text === "string" && legacy.text.trim()) {
      await this.add({ text: legacy.text, at: legacy.at || Date.now() });
      return true;
    }
    await this.write([]);
    return false;
  }

  // Prepends a new transcription. Returns the stored entry, or null if empty.
  async add({ text, originalText, at = Date.now() } = {}) {
    const clean = String(text || "").slice(0, MAX_TEXT_LENGTH);
    if (!clean.trim()) return null;
    const entry = {
      id: `${at}-${Math.random().toString(36).slice(2, 8)}`,
      text: clean,
      originalText: typeof originalText === "string" && originalText.trim()
        ? originalText.slice(0, MAX_TEXT_LENGTH)
        : null,
      correctedText: null,
      at,
    };
    return this.mutate((items) => ({
      items: [entry, ...items].slice(0, this.maxItems),
      result: entry,
    }));
  }

  // Keeps the delivered transcription intact. A manual correction is a
  // separate version that can be cleared by saving the delivered text again.
  async saveCorrection(id, text) {
    if (typeof text !== "string" || !text.trim()) {
      throw new Error("A correção não pode ficar vazia.");
    }
    if (text.length > MAX_TEXT_LENGTH) {
      throw new Error(`A correção pode ter até ${MAX_TEXT_LENGTH} caracteres.`);
    }
    return this.mutate((items) => {
      const index = items.findIndex((item) => item.id === id);
      if (index < 0) throw new Error("Ditado não encontrado no histórico.");
      const updated = {
        ...items[index],
        correctedText: text === items[index].text ? null : text,
      };
      items[index] = updated;
      return { items, result: updated };
    });
  }

  remove(id) {
    return this.mutate((items) => {
      const next = items.filter((item) => item.id !== id);
      return { items: next, result: next };
    });
  }

  clear() {
    return this.mutate(() => ({ items: [], result: true }));
  }

  mutate(change) {
    const task = this.pendingWrite.then(async () => {
      const { items, result } = change(await this.list());
      await this.write(items);
      return result;
    });
    this.pendingWrite = task.catch(() => {});
    return task;
  }

  async write(items) {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(
      tempPath,
      `${JSON.stringify({ items }, null, 2)}\n`,
      "utf8",
    );
    await rename(tempPath, this.filePath);
  }
}

module.exports = { TranscriptionHistoryStore };
