const assert = require("node:assert/strict");
const test = require("node:test");
const {
  LoginItemService,
} = require("../src/main/services/login-item-service.cjs");

test("configura inicialização de desenvolvimento com projeto", () => {
  let received;
  const app = {
    isPackaged: false,
    setLoginItemSettings: (settings) => {
      received = settings;
    },
    getLoginItemSettings: () => ({ openAtLogin: true }),
  };
  const service = new LoginItemService({
    app,
    projectRoot: "C:\\projeto",
  });
  const result = service.apply(true);
  assert.deepEqual(received, {
    openAtLogin: true,
    path: process.execPath,
    args: ["C:\\projeto", "--hidden"],
  });
  assert.equal(result.openAtLogin, true);
});
