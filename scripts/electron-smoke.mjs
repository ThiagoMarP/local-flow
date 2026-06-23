import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";

const electronPath = path.join(
  process.cwd(),
  "node_modules",
  "electron",
  "dist",
  "electron.exe",
);

try {
  await access(electronPath);
} catch {
  console.error(
    "O executável do Electron não está instalado. Execute npm.cmd run electron:install.",
  );
  process.exit(1);
}

const child = spawn(electronPath, ["."], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    LOCAL_FLOW_SMOKE_TEST: "1",
  },
  windowsHide: true,
});

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

const timeout = setTimeout(() => {
  child.kill();
  console.error(output);
  console.error("O aplicativo não concluiu o smoke test em 20 segundos.");
  process.exitCode = 1;
}, 20000);

child.on("close", (code) => {
  clearTimeout(timeout);
  if (code !== 0 || !output.includes("LOCAL_FLOW_READY")) {
    console.error(output);
    console.error("A janela do Electron não confirmou a inicialização.");
    process.exitCode = 1;
    return;
  }
  console.log("Smoke test do Electron concluído.");
});
