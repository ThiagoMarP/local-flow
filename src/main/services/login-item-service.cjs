class LoginItemService {
  constructor({ app, projectRoot } = {}) {
    this.app = app;
    this.projectRoot = projectRoot;
  }

  apply(enabled) {
    const args = ["--hidden"];
    if (!this.app.isPackaged) {
      args.unshift(this.projectRoot);
    }
    this.app.setLoginItemSettings({
      openAtLogin: Boolean(enabled),
      path: process.execPath,
      args,
    });
    return this.get();
  }

  get() {
    return this.app.getLoginItemSettings({
      path: process.execPath,
      args: this.app.isPackaged
        ? ["--hidden"]
        : [this.projectRoot, "--hidden"],
    });
  }
}

module.exports = { LoginItemService };

