import assert from "node:assert/strict";
import test from "node:test";
import { modelRowActions } from "../src/renderer/setup-controller.js";

const idle = { activeProfile: "standard", downloading: null, disabled: false };
const model = (profile, extra = {}) => ({ profile, available: true, ...extra });

test("modelo instalado fora de uso oferece Usar este", () => {
  const actions = modelRowActions(model("parakeet"), idle);
  assert.equal(actions.active, false);
  assert.deepEqual(actions.use, { label: "Usar este", disabled: false });
  assert.deepEqual(actions.main, { role: "redownload", label: "Baixar novamente", disabled: false });
});

test("modelo em uso não oferece Usar este", () => {
  const actions = modelRowActions(model("standard"), idle);
  assert.equal(actions.active, true);
  assert.equal(actions.use, null);
  assert.equal(actions.main.role, "redownload");
});

test("modelo não baixado só oferece Baixar", () => {
  const actions = modelRowActions(model("accurate", { available: false }), idle);
  assert.equal(actions.use, null);
  assert.deepEqual(actions.main, { role: "download", label: "Baixar", disabled: false });
});

test("durante o download: Cancelar no modelo e demais downloads bloqueados", () => {
  const busyDownload = { ...idle, downloading: "accurate" };
  assert.deepEqual(
    modelRowActions(model("accurate", { available: false }), busyDownload).main,
    { role: "cancel", label: "Cancelar", disabled: false },
  );
  const other = modelRowActions(model("parakeet"), busyDownload);
  assert.equal(other.main.disabled, true);
  // Trocar o modelo em uso não depende do download de outro.
  assert.equal(other.use.disabled, false);
});

// Gravando ou transcrevendo, nada muda o modelo no meio do caminho.
test("com o painel ocupado tudo fica desativado", () => {
  const actions = modelRowActions(model("parakeet"), { ...idle, disabled: true });
  assert.equal(actions.use.disabled, true);
  assert.equal(actions.main.disabled, true);
});
