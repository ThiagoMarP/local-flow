const assert = require("node:assert/strict");
const test = require("node:test");
const {
  configureMicrophonePermission,
} = require("../src/main/permissions.cjs");

function createSessionHarness() {
  const handlers = {};
  return {
    handlers,
    session: {
      defaultSession: {
        setPermissionCheckHandler(handler) {
          handlers.check = handler;
        },
        setPermissionRequestHandler(handler) {
          handlers.request = handler;
        },
      },
    },
  };
}

test("permite mídia ao frame principal do dashboard empacotado", () => {
  const dashboard = {};
  const { session, handlers } = createSessionHarness();
  configureMicrophonePermission({
    session,
    getDashboardWebContents: () => dashboard,
  });

  assert.equal(
    handlers.check(dashboard, "media", "ms-appx://local-flow", {
      isMainFrame: true,
    }),
    true,
  );
  let allowed;
  handlers.request(
    dashboard,
    "media",
    (value) => {
      allowed = value;
    },
    { requestingUrl: "ms-appx://local-flow", isMainFrame: true },
  );
  assert.equal(allowed, true);
});

test("nega mídia a outra janela e a subframes", () => {
  const dashboard = {};
  const { session, handlers } = createSessionHarness();
  configureMicrophonePermission({
    session,
    getDashboardWebContents: () => dashboard,
  });

  assert.equal(
    handlers.check({}, "media", "file://local", { isMainFrame: true }),
    false,
  );
  assert.equal(
    handlers.check(dashboard, "media", "file://local", {
      isMainFrame: false,
    }),
    false,
  );
  assert.equal(
    handlers.check(dashboard, "notifications", "file://local", {
      isMainFrame: true,
    }),
    false,
  );
});
