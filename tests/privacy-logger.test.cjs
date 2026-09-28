const assert = require("node:assert/strict");
const test = require("node:test");
const { mkdtemp, readFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  PrivacyLogger,
  sanitizeMetadata,
} = require("../src/main/services/privacy-logger.cjs");

test("redige conteúdo sensível", () => {
  assert.deepEqual(
    sanitizeMetadata({
      text: "segredo",
      clipboardValue: "segredo",
      profile: "fast",
      nested: { vocabulary: ["nome"] },
      replacements: [{ from: "zap", to: "WhatsApp" }],
      snippets: [{ trigger: "assinatura", expansion: "nome" }],
    }),
    {
      text: "[REDACTED]",
      clipboardValue: "[REDACTED]",
      profile: "fast",
      nested: { vocabulary: "[REDACTED]" },
      replacements: "[REDACTED]",
      snippets: "[REDACTED]",
    },
  );
});

test("log gravado não contém texto ditado", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lf-logs-"));
  const logger = new PrivacyLogger({ directory });
  await logger.info("dictation_completed", {
    text: "conteúdo privado",
    elapsedMs: 1200,
  });
  await logger.flush();
  const raw = await readFile(
    path.join(directory, "local-flow.jsonl"),
    "utf8",
  );
  assert.equal(raw.includes("conteúdo privado"), false);
  assert.equal(raw.includes("[REDACTED]"), true);
});
