const assert = require("node:assert/strict");
const test = require("node:test");
const {
  mkdtemp,
  mkdir,
  stat,
  utimes,
} = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  cleanOldEntries,
  isWithin,
} = require("../src/main/services/housekeeping.cjs");

test("remove somente entradas antigas com prefixo permitido", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lf-clean-"));
  const oldJob = path.join(directory, "job-old");
  const recentJob = path.join(directory, "job-new");
  const unrelated = path.join(directory, "keep-me");
  await Promise.all([
    mkdir(oldJob),
    mkdir(recentJob),
    mkdir(unrelated),
  ]);
  const old = new Date(Date.now() - 10_000);
  await utimes(oldJob, old, old);

  const result = await cleanOldEntries({
    baseDir: directory,
    prefix: "job-",
    olderThanMs: 5000,
  });
  assert.equal(result.removed, 1);
  await assert.rejects(stat(oldJob));
  await stat(recentJob);
  await stat(unrelated);
});

test("valida que alvos permanecem dentro da pasta", () => {
  assert.equal(isWithin("C:\\base", "C:\\base\\job-1"), true);
  assert.equal(isWithin("C:\\base", "C:\\other\\job-1"), false);
});
