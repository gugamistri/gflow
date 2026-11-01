/**
 * Pacote da Chrome Web Store: manifest na raiz, sem testes, mapas nem arquivos ocultos.
 * Uso: node scripts/pack-extension.mjs [saída.zip]   (padrão: downloads/guiaflow-captura.zip)
 * why: usa `zip` quando existe; senão o zipfile do Python (máquinas sem o pacote zip).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { syncExtensionLib } from "./sync-extension-lib.mjs";

/** Arquivos do pacote (caminhos relativos a extension/), em ordem. */
export function extensionPackFiles(dir = "extension") {
  const out = [];
  const walk = (rel) => {
    for (const ent of readdirSync(join(dir, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.name.startsWith(".")) continue;
      if (ent.isDirectory()) walk(path);
      else if (!/\.test\.js$|\.map$|\.DS_Store$/.test(ent.name)) out.push(path);
    }
  };
  walk("");
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  syncExtensionLib();
  const version = JSON.parse(readFileSync("extension/manifest.json", "utf8")).version;
  const out = resolve(process.argv[2] || "downloads/guiaflow-captura.zip");
  mkdirSync(dirname(out), { recursive: true });
  rmSync(out, { force: true });
  const files = extensionPackFiles();
  if (spawnSync("zip", ["-v"]).status === 0) {
    execFileSync("zip", ["-X", "-q", out, ...files], { cwd: "extension", stdio: "inherit" });
  } else {
    const py = [
      "import sys, zipfile",
      "out, files = sys.argv[1], sys.argv[2:]",
      "with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:",
      "    for f in files: z.write(f, f)",
    ].join("\n");
    execFileSync("python3", ["-c", py, out, ...files], { cwd: "extension", stdio: "inherit" });
  }
  console.log(`${out} (${version}, ${files.length} arquivos)`);
}
