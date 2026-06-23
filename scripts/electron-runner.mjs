import { spawn } from "node:child_process";
import { access, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function runElectron({
  env = {},
  expectedOutput,
  timeoutMs = 30000,
}) {
  const electronPath = path.join(
    process.cwd(),
    "node_modules",
    "electron",
    "dist",
    "electron.exe",
  );
  await access(electronPath);
  const userDataPath = path.join(
    os.tmpdir(),
    "local-flow-electron-test",
    `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  await mkdir(userDataPath, { recursive: true });

  return new Promise((resolve, reject) => {
    const child = spawn(electronPath, ["."], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        LOCAL_FLOW_USER_DATA: userDataPath,
        ...env,
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
      reject(
        new Error(
          `${output}\nElectron excedeu o limite de ${timeoutMs} ms.`,
        ),
      );
    }, timeoutMs);

    child.on("close", async (code) => {
      clearTimeout(timeout);
      await rm(userDataPath, { recursive: true, force: true }).catch(
        () => {},
      );
      const expectedValues = Array.isArray(expectedOutput)
        ? expectedOutput
        : [expectedOutput];
      const missing = expectedValues.filter(
        (value) => !output.includes(value),
      );
      if (code !== 0 || missing.length > 0) {
        reject(
          new Error(
            `${output}\nSaída esperada não encontrada: ${missing.join(", ")}`,
          ),
        );
        return;
      }
      resolve(output);
    });
  });
}
