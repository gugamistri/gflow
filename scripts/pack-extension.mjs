import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";

const out = "downloads/guiaflow-captura.zip";
mkdirSync("downloads", { recursive: true });
rmSync(out, { force: true });
execFileSync(
  "zip",
  ["-r", "-X", `../${out}`, ".", "-x", "*.test.js", "-x", "*.DS_Store"],
  { cwd: "extension", stdio: "inherit" }
);
