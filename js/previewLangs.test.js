import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
const menu = readFileSync(new URL("./langMenu.js", import.meta.url), "utf8");

test("prévia do editor monta o menu de idioma quando há mais de um idioma e limpa ao sair", () => {
  assert.match(app, /createLangMenu\(\{[\s\S]*demo: project/);
  assert.match(app, /startPreviewLangs\(\);\s*document\.body\.classList\.add\("is-presenting"\)/);
  assert.match(app, /player\.stop\?\.\(\);\s*stopPreviewLangs\(\)/);
  assert.match(app, /getDemo: \(\) => previewView \|\| project/);
  assert.match(menu, /function destroy\(\)/);
});

test("projeto de um idioma não cria menu (resolvePlayerLangs devolve null)", async () => {
  const { resolvePlayerLangs } = await import("./langMenu.js");
  assert.equal(resolvePlayerLangs({ steps: [] }, {}), null);
});
