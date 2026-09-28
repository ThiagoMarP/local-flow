import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runElectron } from "./electron-runner.mjs";

// Boots the app headlessly and asks the main process for the setup status that
// powers the first-run wizard. The Whisper engine ships in the dev tree, so it
// must report available; the temporary (empty) models directory must report all
// four profiles as missing.
const userDataPath = await mkdtemp(
  path.join(os.tmpdir(), "local-flow-setup-e2e-"),
);
const modelsDir = await mkdtemp(
  path.join(os.tmpdir(), "local-flow-models-e2e-"),
);

try {
  const output = await runElectron({
    userDataPath,
    cleanupUserData: false,
    env: {
      LOCAL_FLOW_SETUP_TEST: "1",
      LOCAL_FLOW_MODELS_DIR: modelsDir,
    },
    expectedOutput: "LOCAL_FLOW_SETUP_OK=",
  });

  const line = output.match(/LOCAL_FLOW_SETUP_OK=.*$/m)?.[0] || "";
  const payload = JSON.parse(line.replace("LOCAL_FLOW_SETUP_OK=", ""));

  if (!payload.whisperAvailable) {
    throw new Error("O mecanismo whisper-cli.exe não foi detectado.");
  }
  if (!payload.parakeetAvailable) {
    throw new Error("O mecanismo nemo-speech.exe não foi detectado.");
  }
  const profiles = Object.keys(payload.models).sort();
  const expected = ["accurate", "fast", "parakeet", "standard"];
  if (expected.some((profile) => !profiles.includes(profile))) {
    throw new Error(`Perfis ausentes no status: ${profiles.join(", ")}`);
  }
  if (Object.values(payload.models).some(Boolean)) {
    throw new Error(
      "Um diretório de modelos vazio deveria reportar todos indisponíveis.",
    );
  }

  console.log(line);
  console.log(
    "Status de setup verificado: mecanismos prontos e 4 modelos rastreados.",
  );
} finally {
  await rm(userDataPath, { recursive: true, force: true });
  await rm(modelsDir, { recursive: true, force: true });
}
