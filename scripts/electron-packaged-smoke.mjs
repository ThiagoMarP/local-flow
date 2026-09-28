// Smoke test for the PACKAGED build (catches bugs that only surface in the .exe,
// not under `npm start`): missing extraResources, broken asar contents, spawn/
// path resolution in packaged mode.
//
// Default run packs the app (electron-builder --dir) and verifies the on-disk
// layout — all SAC-safe (building works under Smart App Control; only running
// the unsigned .exe is blocked). Pass --run to additionally boot the packaged
// .exe and assert the setup self-test (needs SAC off / a signed build / CI).
//
//   node scripts/electron-packaged-smoke.mjs            # build + layout checks
//   node scripts/electron-packaged-smoke.mjs --skip-build
//   node scripts/electron-packaged-smoke.mjs --run      # + boot the .exe
import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  readdir,
  rm,
  stat,
} from "node:fs/promises";
import { constants as FS } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const distUnpacked = path.join(root, "dist", "win-unpacked");
const exePath = path.join(distUnpacked, "Local Flow.exe");
const resourcesDir = path.join(distUnpacked, "resources");

const flags = new Set(process.argv.slice(2));
const skipBuild = flags.has("--skip-build");
const doRun = flags.has("--run");

const ok = (message) => console.log(`  [OK] ${message}`);
const info = (message) => console.log(`\n> ${message}`);
const note = (message) => console.log(`  [..] ${message}`);

async function exists(target) {
  try {
    await access(target, FS.F_OK);
    return true;
  } catch {
    return false;
  }
}

function build() {
  info("Empacotando (electron-builder --dir)...");
  return new Promise((resolve, reject) => {
    const child = spawn("npm", ["run", "pack"], {
      cwd: root,
      shell: true,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`electron-builder saiu com código ${code}.`)),
    );
  });
}

async function checkLayout() {
  info("Verificando o layout do pacote...");

  if (!(await exists(exePath))) {
    throw new Error(`Executável empacotado não encontrado: ${exePath}`);
  }
  ok("Local Flow.exe");

  const asarPath = path.join(resourcesDir, "app.asar");
  if (!(await exists(asarPath))) {
    throw new Error(`app.asar não encontrado: ${asarPath}`);
  }
  const asarSize = (await stat(asarPath)).size;
  if (asarSize < 50_000) {
    throw new Error(`app.asar suspeito de estar vazio (${asarSize} bytes).`);
  }
  ok(`app.asar (${Math.round(asarSize / 1024)} KB)`);

  // Native binaries can't run from inside the asar, so they must ship on disk
  // as extraResources. Missing ones cause spawn ENOENT only in the packaged app.
  const whisperDir = path.join(resourcesDir, "native", "whisper");
  const requiredWhisper = [
    "whisper-cli.exe",
    "whisper.dll",
    "ggml.dll",
    "ggml-base.dll",
  ];
  for (const file of requiredWhisper) {
    if (!(await exists(path.join(whisperDir, file)))) {
      throw new Error(`extraResource ausente: native/whisper/${file}`);
    }
  }
  const whisperFiles = await readdir(whisperDir).catch(() => []);
  if (!whisperFiles.some((file) => /^ggml-cpu-.*\.dll$/i.test(file))) {
    throw new Error("nenhum ggml-cpu-*.dll foi empacotado.");
  }
  ok("native/whisper (cli + dlls + ggml-cpu-*)");

  const parakeetDir = path.join(resourcesDir, "native", "parakeet");
  for (const file of [
    path.join("bin", "nemo-speech.exe"),
    path.join("bin", "nemo_speech_asr.dll"),
    path.join("share", "nemo-speech", "model-index.json"),
    path.join("share", "licenses", "nemo-speech", "LICENSE"),
  ]) {
    if (!(await exists(path.join(parakeetDir, file)))) {
      throw new Error(`extraResource ausente: native/parakeet/${file}`);
    }
  }
  ok("native/parakeet (runtime e licenças)");

  const winDir = path.join(resourcesDir, "native", "windows");
  for (const file of ["foreground-helper.ps1", "hotkey-listener.ps1"]) {
    if (!(await exists(path.join(winDir, file)))) {
      throw new Error(`extraResource ausente: native/windows/${file}`);
    }
  }
  ok("native/windows (helpers .ps1)");

  await checkAsarContents(asarPath);
}

async function checkAsarContents(asarPath) {
  let asar;
  try {
    asar = createRequire(import.meta.url)("@electron/asar");
  } catch {
    note("@electron/asar indisponível — pulei a checagem interna do asar.");
    return;
  }
  const entries = asar
    .listPackage(asarPath)
    .map((entry) => entry.replace(/\\/g, "/"));
  // assets/icon.ico → ícone da bandeja (já nos mordeu antes); o resto garante
  // que o código do renderer/main (inclusive o worklet novo) foi de fato junto.
  const required = [
    "/package.json",
    "/assets/icon.ico",
    "/src/main/main.cjs",
    "/src/main/escape-shortcut.cjs",
    "/src/main/services/asr-service.cjs",
    "/src/main/services/cancellation.cjs",
    "/src/main/services/parakeet-service.cjs",
    "/src/main/services/meeting-capture-store.cjs",
    "/src/renderer/capture-worklet.js",
    "/src/renderer/meeting-recorder.js",
  ];
  for (const entry of required) {
    if (!entries.includes(entry)) {
      throw new Error(`faltando dentro do asar: ${entry}`);
    }
  }
  ok("asar contém ícone, serviços ASR, worklet e package.json");
}

async function runBoot() {
  info("Iniciando o .exe empacotado (setup self-test)...");
  const userDir = path.join(os.tmpdir(), `lf-pkg-user-${Date.now()}`);
  const modelsDir = path.join(os.tmpdir(), `lf-pkg-models-${Date.now()}`);
  await mkdir(userDir, { recursive: true });

  const output = await new Promise((resolve) => {
    const child = spawn(exePath, [], {
      cwd: distUnpacked,
      env: {
        ...process.env,
        LOCAL_FLOW_SETUP_TEST: "1",
        LOCAL_FLOW_USER_DATA: userDir,
        LOCAL_FLOW_MODELS_DIR: modelsDir,
      },
      windowsHide: true,
    });
    let buffer = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve(`${buffer}\n__TIMEOUT__`);
    }, 30000);
    child.stdout.on("data", (chunk) => (buffer += chunk));
    child.stderr.on("data", (chunk) => (buffer += chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve(`__SPAWN_ERROR__ ${error.message}`);
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve(buffer);
    });
  });

  await rm(userDir, { recursive: true, force: true }).catch(() => {});
  await rm(modelsDir, { recursive: true, force: true }).catch(() => {});

  const line = output
    .split(/\r?\n/)
    .find((entry) => entry.includes("LOCAL_FLOW_SETUP_OK="));
  if (!line) {
    if (output.includes("__TIMEOUT__") || output.includes("__SPAWN_ERROR__")) {
      note(
        "O .exe não respondeu — provavelmente o Smart App Control bloqueou o binário não-assinado.",
      );
      note(
        "Boot do empacotado fica INCONCLUSIVO aqui (rode com SAC off / build assinado / CI).",
      );
      return "skipped";
    }
    throw new Error(`Saída inesperada do app empacotado:\n${output}`);
  }
  const result = JSON.parse(line.replace(/.*LOCAL_FLOW_SETUP_OK=/, "").trim());
  if (!result.packaged) {
    throw new Error("app não está em modo empacotado (app.isPackaged=false).");
  }
  if (!result.whisperAvailable) {
    throw new Error(
      "motor Whisper não resolvido no pacote (spawn/asar path quebrado).",
    );
  }
  if (!result.parakeetAvailable) {
    throw new Error("motor Parakeet não resolvido no pacote.");
  }
  if (!Object.hasOwn(result.models || {}, "parakeet")) {
    throw new Error("modelo Parakeet não consta no setup empacotado.");
  }
  ok("boot empacotado: Whisper e Parakeet detectados");
  return "ran";
}

(async () => {
  if (skipBuild) info("Pulando build (--skip-build).");
  else await build();

  if (!(await exists(distUnpacked))) {
    throw new Error(
      "dist/win-unpacked não existe — rode sem --skip-build primeiro.",
    );
  }

  await checkLayout();

  let bootResult = "not-run";
  if (doRun) bootResult = await runBoot();
  else
    info(
      "Boot do .exe: pulado (use --run para iniciar o empacotado; pode ser barrado pelo SAC).",
    );

  const suffix =
    bootResult === "ran"
      ? " + boot OK"
      : bootResult === "skipped"
        ? " (boot inconclusivo / SAC)"
        : "";
  console.log(`\n[PASS] Smoke do build empacotado: layout OK${suffix}.`);
})().catch((error) => {
  console.error(`\n[FAIL] Smoke do build empacotado falhou:\n${error.message}`);
  process.exit(1);
});
