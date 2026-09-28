const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const { resolveAppPaths } = require("../src/main/services/app-paths.cjs");

test("modo desenvolvimento resolve a partir da raiz do projeto", () => {
  const root = path.join("C:", "projeto");
  const paths = resolveAppPaths({ projectRoot: root, env: {} });
  assert.equal(paths.packaged, false);
  assert.equal(
    paths.whisperCli,
    path.join(root, "native", "whisper", "whisper-cli.exe"),
  );
  assert.equal(paths.modelsDir, path.join(root, "models"));
  assert.equal(
    paths.parakeetCli,
    path.join(root, "native", "parakeet", "bin", "nemo-speech.exe"),
  );
  assert.equal(
    paths.foregroundHelper,
    path.join(root, "native", "windows", "foreground-helper.ps1"),
  );
  assert.equal(
    paths.hotkeyListener,
    path.join(root, "native", "windows", "hotkey-listener.ps1"),
  );
});

test("modo empacotado usa resourcesPath e userData", () => {
  const root = path.join("C:", "projeto");
  const resources = path.join("C:", "Arquivos", "Local Flow", "resources");
  const userData = path.join("C:", "Users", "x", "AppData", "Roaming", "Local Flow");
  const original = process.resourcesPath;
  Object.defineProperty(process, "resourcesPath", {
    value: resources,
    configurable: true,
  });
  try {
    const app = { isPackaged: true, getPath: () => userData };
    const paths = resolveAppPaths({
      app,
      projectRoot: root,
      env: {},
    });
    assert.equal(paths.packaged, true);
    assert.equal(paths.whisperDir, path.join(resources, "native", "whisper"));
    assert.equal(
      paths.whisperCli,
      path.join(resources, "native", "whisper", "whisper-cli.exe"),
    );
    assert.equal(
      paths.foregroundHelper,
      path.join(resources, "native", "windows", "foreground-helper.ps1"),
    );
    assert.equal(paths.modelsDir, path.join(userData, "models"));
    assert.equal(
      paths.parakeetCli,
      path.join(resources, "native", "parakeet", "bin", "nemo-speech.exe"),
    );
  } finally {
    if (original === undefined) delete process.resourcesPath;
    else
      Object.defineProperty(process, "resourcesPath", {
        value: original,
        configurable: true,
      });
  }
});

test("LOCAL_FLOW_MODELS_DIR sobrepõe o diretório de modelos", () => {
  const root = path.join("C:", "projeto");
  const custom = path.join("D:", "modelos-local-flow");
  const paths = resolveAppPaths({
    projectRoot: root,
    env: { LOCAL_FLOW_MODELS_DIR: custom },
  });
  assert.equal(paths.modelsDir, path.resolve(custom));
});

test("projectRoot é obrigatório", () => {
  assert.throws(() => resolveAppPaths({}), /projectRoot/);
});
