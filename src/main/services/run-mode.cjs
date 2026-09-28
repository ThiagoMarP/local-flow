function detectRunMode(env = process.env) {
  const singleInstanceTestRun =
    env.LOCAL_FLOW_SINGLE_INSTANCE_TEST === "1";
  const revisionTestRun = Boolean(env.LOCAL_FLOW_REVISION_TEST_AUDIO);
  const e2eTestRun = Boolean(env.LOCAL_FLOW_E2E_AUDIO);
  const personalizationTestRun = Boolean(
    env.LOCAL_FLOW_PERSONALIZATION_TEST_AUDIO,
  );
  const settingsTestRun =
    Boolean(env.LOCAL_FLOW_SETTINGS_TEST_WRITE) ||
    Boolean(env.LOCAL_FLOW_SETTINGS_TEST_EXPECT);
  const setupTestRun = env.LOCAL_FLOW_SETUP_TEST === "1";
  const automatedRun =
    env.LOCAL_FLOW_SMOKE_TEST === "1" ||
    Boolean(env.LOCAL_FLOW_CAPTURE_PATH) ||
    Boolean(env.LOCAL_FLOW_CAPTURE_CAPSULE_PATH) ||
    e2eTestRun ||
    env.LOCAL_FLOW_MIC_SELF_TEST === "1" ||
    env.LOCAL_FLOW_TRAY_TEST === "1" ||
    env.LOCAL_FLOW_SELECT_TEST === "1" ||
    env.LOCAL_FLOW_LIFECYCLE_TEST === "1" ||
    env.LOCAL_FLOW_SHORTCUT_TEST === "1" ||
    Boolean(env.LOCAL_FLOW_SHORTCUT_INPUT_TEST_FILE) ||
    Boolean(env.LOCAL_FLOW_INSERTION_TEST_AUDIO) ||
    personalizationTestRun ||
    revisionTestRun ||
    settingsTestRun ||
    setupTestRun ||
    env.LOCAL_FLOW_METRICS_TEST === "1";

  return {
    automatedRun,
    e2eTestRun,
    persistentWindowRun:
      !automatedRun || env.LOCAL_FLOW_LIFECYCLE_TEST === "1",
    personalizationTestRun,
    revisionTestRun,
    settingsTestRun,
    setupTestRun,
    singleInstanceTestRun,
  };
}

module.exports = { detectRunMode };
