import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";

copyFileSync("js/i18n.js", "extension/lib/i18n.js");

const out = "downloads/guiaflow-captura.zip";
mkdirSync("downloads", { recursive: true });
rmSync(out, { force: true });
execFileSync(
  "zip",
  ["-r", "-X", `../${out}`, ".", "-x", "*.test.js", "-x", "*.DS_Store"],
  { cwd: "extension", stdio: "inherit" }
);
