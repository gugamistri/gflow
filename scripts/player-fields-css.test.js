import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// why: o /p, o /v e o embed só carregam o player.css — se o estilo dos campos do cartão de lead
// morar só no editor.css, o <input> volta ao tamanho nativo (~256px) e estoura o cartão no celular.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const stylesheets = (html) => [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((m) => m[1]);

function ruleBody(css, selector) {
  // why: só a regra que começa na linha — ".fixed-preview .fixed-card …" (prévia do editor) é outra
  const m = new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`).exec(css);
  return m ? m[2] : null;
}

test("páginas do player (/v, /p, embed) carregam player.css e não editor.css", () => {
  for (const [file, html] of [["view.html", read("view.html")], ["api/lib/view-shell.cjs", read("api/lib/view-shell.cjs")]]) {
    const sheets = stylesheets(html);
    assert.ok(sheets.some((h) => h.endsWith("/css/player.css")), `${file} sem player.css`);
    assert.ok(!sheets.some((h) => h.endsWith("/css/editor.css")), `${file} não deveria carregar editor.css`);
  }
});

test("campos do cartão de lead cabem na coluna: regra no player.css com width 100% e border-box", () => {
  const body = ruleBody(read("css/player.css"), ".fixed-card .fixed-form .fixed-input");
  assert.ok(body, "player.css precisa estilizar .fixed-card .fixed-form .fixed-input");
  assert.match(body, /box-sizing:\s*border-box/);
  assert.match(body, /width:\s*100%/);
  assert.match(read("css/player.css"), /\.fixed-field\s*\{[^}]*min-width:\s*0/);
});

test("editor.css não duplica a regra base dos campos do cartão (fonte única no player.css)", () => {
  assert.equal(ruleBody(read("css/editor.css"), ".fixed-card .fixed-form .fixed-input"), null);
});
