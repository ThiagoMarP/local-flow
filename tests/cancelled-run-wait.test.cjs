const assert = require("node:assert/strict");
const test = require("node:test");
const {
  waitForCancelledRunCleanup,
} = require("../src/main/cancelled-run-wait.cjs");

test("B aguarda o cleanup de A cancelada antes de iniciar", async () => {
  let settleA;
  const settledA = new Promise((resolve) => { settleA = resolve; });
  let aRunning = true;
  let bStarted = false;
  const startB = waitForCancelledRunCleanup(settledA, 100).then((settled) => {
    assert.equal(settled, true);
    assert.equal(aRunning, false);
    bStarted = true;
    return "B iniciou";
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(bStarted, false);
  aRunning = false;
  settleA();
  assert.equal(await startB, "B iniciou");
});

test("B não fica preso se o cleanup de A travar", async () => {
  const neverSettles = new Promise(() => {});
  assert.equal(await waitForCancelledRunCleanup(neverSettles, 5), false);
});
