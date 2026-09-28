function createAbortError() {
  const error = new Error("Ditado cancelado.");
  error.name = "AbortError";
  error.code = "ABORT_ERR";
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw createAbortError();
}

module.exports = { createAbortError, throwIfAborted };
