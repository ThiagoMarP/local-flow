const {
  appendFile,
  mkdir,
  readdir,
  rename,
  rm,
  stat,
} = require("node:fs/promises");
const path = require("node:path");

const SENSITIVE_KEY =
  /audio|text|transcri|clipboard|vocabulary|prompt|title|content|body/i;

function sanitizeMetadata(value, key = "") {
  if (SENSITIVE_KEY.test(key)) return "[REDACTED]";
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeMetadata(item));
  }
  if (typeof value === "object") {
    const output = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      output[childKey] = sanitizeMetadata(childValue, childKey);
    }
    return output;
  }
  if (typeof value === "string") return value.slice(0, 300);
  if (typeof value === "number" || typeof value === "boolean") return value;
  return String(value).slice(0, 300);
}

class PrivacyLogger {
  constructor({
    directory,
    maxBytes = 1024 * 1024,
    maxFiles = 3,
    clock = () => new Date(),
  } = {}) {
    if (!directory) throw new Error("directory é obrigatório.");
    this.directory = directory;
    this.filePath = path.join(directory, "local-flow.jsonl");
    this.maxBytes = maxBytes;
    this.maxFiles = maxFiles;
    this.clock = clock;
    this.queue = Promise.resolve();
  }

  info(event, metadata) {
    return this.write("info", event, metadata);
  }

  warn(event, metadata) {
    return this.write("warn", event, metadata);
  }

  error(event, error, metadata = {}) {
    return this.write("error", event, {
      ...metadata,
      errorName: error?.name || "Error",
      errorCode: error?.code || null,
    });
  }

  write(level, event, metadata = {}) {
    const entry = {
      timestamp: this.clock().toISOString(),
      level,
      event: String(event).slice(0, 100),
      metadata: sanitizeMetadata(metadata),
    };
    this.queue = this.queue
      .then(async () => {
        await mkdir(this.directory, { recursive: true });
        await this.rotateIfNeeded();
        await appendFile(
          this.filePath,
          `${JSON.stringify(entry)}\n`,
          "utf8",
        );
      })
      .catch(() => {});
    return this.queue;
  }

  async rotateIfNeeded() {
    try {
      const info = await stat(this.filePath);
      if (info.size < this.maxBytes) return;
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }

    for (let index = this.maxFiles - 1; index >= 1; index -= 1) {
      const source =
        index === 1 ? this.filePath : `${this.filePath}.${index - 1}`;
      const target = `${this.filePath}.${index}`;
      await rm(target, { force: true });
      await rename(source, target).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }

  async prune() {
    await mkdir(this.directory, { recursive: true });
    const files = (await readdir(this.directory))
      .filter((name) => name.startsWith("local-flow.jsonl."))
      .sort();
    const excess = files.slice(0, Math.max(0, files.length - this.maxFiles));
    await Promise.all(
      excess.map((file) =>
        rm(path.join(this.directory, file), { force: true }),
      ),
    );
  }

  flush() {
    return this.queue;
  }
}

module.exports = { PrivacyLogger, sanitizeMetadata };

