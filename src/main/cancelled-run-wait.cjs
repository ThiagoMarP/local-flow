// A newly recorded dictation may reach the main process while a cancelled
// model subprocess is still shutting down. Wait briefly for that cleanup so
// the new run is not rejected as "already transcribing".
function waitForCancelledRunCleanup(settled, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    Promise.resolve(settled).then(
      () => { clearTimeout(timer); resolve(true); },
      () => { clearTimeout(timer); resolve(true); },
    );
  });
}

module.exports = { waitForCancelledRunCleanup };
