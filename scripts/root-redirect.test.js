import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

/** Roda o script inline do topo do <head> da / com um localStorage falso; devolve para onde foi. */
function runHead(file, store, search = "") {
  const html = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const code = html.match(/<script>\s*(\/\*[\s\S]*?\(function \(\) \{[\s\S]*?\}\)\(\);)\s*<\/script>/)[1];
  let went = null;
  const ctx = {
    URLSearchParams,
    JSON,
    window: { location: { search, hash: "", replace: (u) => { went = u; } } },
    document: { documentElement: { getAttribute: () => null, style: {} } },
    localStorage: { getItem: (k) => (k in store ? store[k] : null) },
  };
  ctx.window.window = ctx.window;
  vm.runInNewContext(code, ctx);
  return went;
}

const idx = (projects) => ({ "demo-studio-index-v2": JSON.stringify({ projects }) });

for (const file of ["index.html", "en.html", "es.html"]) {
  test(`${file}: exemplo intocado não manda para o editor; projeto do usuário manda`, () => {
    assert.equal(runHead(file, {}), null);
    assert.equal(runHead(file, idx([{ id: "a", name: "Como usar o Guia", stock: true }])), null);
    assert.equal(runHead(file, idx([{ id: "a", name: "Como usar o Guia" }])), null);
    assert.equal(runHead(file, idx([{ id: "a", name: "Como usar o Guia", stock: false }])), "/editor");
    assert.equal(runHead(file, idx([{ id: "a", name: "Como usar o Guia", stock: true }, { id: "b", name: "Meu tour" }])), "/editor");
    assert.equal(runHead(file, {}, "?session_id=x"), "/editor?session_id=x");
  });
}
