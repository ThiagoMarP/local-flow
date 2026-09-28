import path from "node:path";
import { runElectron } from "./electron-runner.mjs";

const target =
  process.argv[2] ||
  path.join(process.cwd(), "work", "phase-2-ui.png");
const showSettings = process.argv.includes("--settings");
const showRevisionMenu = process.argv.includes("--revision-menu");
const showShortcutMenu = process.argv.includes("--shortcut-menu");
const showPersonalization = process.argv.includes("--personalization");
await runElectron({
  electronArgs: ["--in-process-gpu"],
  env: {
    LOCAL_FLOW_CAPTURE_PATH: target,
    LOCAL_FLOW_SETTINGS_PREVIEW: showSettings ? "1" : "0",
    LOCAL_FLOW_REVISION_MENU_PREVIEW: showRevisionMenu ? "1" : "0",
    LOCAL_FLOW_SHORTCUT_MENU_PREVIEW: showShortcutMenu ? "1" : "0",
    LOCAL_FLOW_PERSONALIZATION_PREVIEW: showPersonalization
      ? "1"
      : "0",
  },
  expectedOutput: "LOCAL_FLOW_CAPTURED=",
  timeoutMs: 30000,
});
console.log(target);
