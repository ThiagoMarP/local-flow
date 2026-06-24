const { readdir, rm, stat } = require("node:fs/promises");
const path = require("node:path");

function isWithin(baseDir, target) {
  const base = `${path.resolve(baseDir)}${path.sep}`;
  return path.resolve(target).startsWith(base);
}

async function cleanOldEntries({
  baseDir,
  prefix,
  olderThanMs,
  now = Date.now(),
  logger,
}) {
  let names;
  try {
    names = await readdir(baseDir);
  } catch (error) {
    if (error.code === "ENOENT") return { removed: 0 };
    throw error;
  }

  let removed = 0;
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    const target = path.join(baseDir, name);
    if (!isWithin(baseDir, target)) continue;
    try {
      const info = await stat(target);
      if (now - info.mtimeMs < olderThanMs) continue;
      await rm(target, { recursive: true, force: true });
      removed += 1;
    } catch (error) {
      await logger?.warn("housekeeping_entry_failed", {
        reason: error.code || error.name,
      });
    }
  }
  return { removed };
}

module.exports = { cleanOldEntries, isWithin };

