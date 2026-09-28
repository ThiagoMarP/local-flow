const assert = require("node:assert/strict");
const test = require("node:test");
const {
  detectRunMode,
} = require("../src/main/services/run-mode.cjs");

test("execução normal mantém janelas persistentes", () => {
  const mode = detectRunMode({});
  assert.equal(mode.automatedRun, false);
  assert.equal(mode.persistentWindowRun, true);
});

test("teste de revisão é automatizado e sem persistência", () => {
  const mode = detectRunMode({
    LOCAL_FLOW_REVISION_TEST_AUDIO: "sample.wav",
  });
  assert.equal(mode.automatedRun, true);
  assert.equal(mode.revisionTestRun, true);
  assert.equal(mode.persistentWindowRun, false);
});

test("teste de personalização é automatizado", () => {
  const mode = detectRunMode({
    LOCAL_FLOW_PERSONALIZATION_TEST_AUDIO: "sample.wav",
  });
  assert.equal(mode.automatedRun, true);
  assert.equal(mode.personalizationTestRun, true);
});

test("teste de setup é automatizado e sem persistência", () => {
  const mode = detectRunMode({ LOCAL_FLOW_SETUP_TEST: "1" });
  assert.equal(mode.automatedRun, true);
  assert.equal(mode.setupTestRun, true);
  assert.equal(mode.persistentWindowRun, false);
});
