const { spawn } = require("node:child_process");
const { createInterface } = require("node:readline");

class WindowsBridge {
  constructor({ scriptPath, timeoutMs = 5000 } = {}) {
    if (!scriptPath) {
      throw new Error("scriptPath é obrigatório.");
    }
    this.scriptPath = scriptPath;
    this.timeoutMs = timeoutMs;
    this.nextId = 1;
    this.pending = new Map();
    this.process = null;
    this.stderr = "";
  }

  start() {
    if (this.process) return;
    this.process = spawn(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        this.scriptPath,
      ],
      {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    this.process.stderr.on("data", (chunk) => {
      this.stderr += chunk.toString();
      if (this.stderr.length > 8000) {
        this.stderr = this.stderr.slice(-8000);
      }
    });
    createInterface({ input: this.process.stdout }).on("line", (line) => {
      this.handleLine(line);
    });
    this.process.once("exit", (code) => {
      const error = new Error(
        `O auxiliar do Windows foi encerrado com código ${code}. ${this.stderr}`.trim(),
      );
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      this.pending.clear();
      this.process = null;
    });
    this.process.once("error", (error) => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      this.pending.clear();
      this.process = null;
    });
  }

  handleLine(line) {
    let response;
    try {
      response = JSON.parse(line);
    } catch {
      return;
    }
    const pending = this.pending.get(response.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(response.id);
    if (!response.ok) {
      pending.reject(new Error(response.error || "Falha no auxiliar Windows."));
      return;
    }
    pending.resolve(response.result);
  }

  request(command, payload = {}) {
    this.start();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `O auxiliar Windows não respondeu ao comando ${command}.`,
          ),
        );
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.process.stdin.write(
        `${JSON.stringify({ id, command, ...payload })}\n`,
        "utf8",
      );
    });
  }

  captureForeground() {
    return this.request("capture");
  }

  findByTitle(title) {
    return this.request("findByTitle", { title });
  }

  focusWindow(hwnd) {
    return this.request("focus", { hwnd: String(hwnd) });
  }

  pasteTo(hwnd) {
    return this.request("paste", { hwnd: String(hwnd) });
  }

  sendToggleShortcut() {
    return this.request("sendToggleShortcut");
  }

  dispose() {
    if (!this.process) return;
    this.process.stdin.end();
    this.process.kill();
    this.process = null;
  }
}

module.exports = { WindowsBridge };

