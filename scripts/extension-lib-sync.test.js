import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { EXTENSION_LIB_FILES } from "./sync-extension-lib.mjs";

test("extension/lib tem as mesmas cópias de js/ (rode node scripts/sync-extension-lib.mjs)", () => {
  for (const f of EXTENSION_LIB_FILES) {
    const src = readFileSync(new URL(`../js/${f}`, import.meta.url), "utf8");
    const copy = readFileSync(new URL(`../extension/lib/${f}`, import.meta.url), "utf8");
    assert.equal(copy === src, true, `extension/lib/${f} desatualizado`);
  }
  // as cópias só importam umas às outras (nada de fora do pacote)
  for (const f of EXTENSION_LIB_FILES) {
    const src = readFileSync(new URL(`../js/${f}`, import.meta.url), "utf8");
    for (const m of src.matchAll(/^import [^;]*from "\.\/([^"]+)";/gm)) assert.ok(EXTENSION_LIB_FILES.includes(m[1]), `${f} importa ${m[1]}`);
  }
});

test("pacote da extensão: manifest na raiz, sem testes nem arquivos ocultos", async () => {
  const { extensionPackFiles } = await import("./pack-extension.mjs");
  const files = extensionPackFiles(new URL("../extension", import.meta.url).pathname);
  assert.ok(files.includes("manifest.json"));
  assert.ok(files.includes("lib/whats-new.js") && files.includes("lib/releaseNotes.js"));
  assert.equal(files.some((f) => /\.test\.js$|\.map$|(^|\/)\./.test(f)), false);
});
