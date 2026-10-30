// Regressão: texto do autor no balão (driver.js usa innerHTML) nunca vira marcação.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { escapeHtml, popoverBodyHtml, popoverTitleHtml, safeCssColor } from "./htmlText.js";

const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const PAYLOADS = [
  '<img src=x onerror="alert(1)">',
  "<script>alert(1)</script>",
  '"><svg onload=alert(1)>',
  "<a href=\"javascript:alert(1)\">x</a>",
  "' onmouseover='alert(1)",
];

function noMarkup(html) {
  // depois de escapar não sobra nenhum < ou > cru, nem aspas que fechem atributo
  assert.doesNotMatch(html.replace(/<br\/>/g, ""), /[<>"']/);
}

test("título e texto do balão saem escapados para os payloads conhecidos", () => {
  for (const p of PAYLOADS) {
    noMarkup(popoverTitleHtml(p));
    noMarkup(popoverBodyHtml(p));
    noMarkup(escapeHtml(p));
  }
  assert.equal(popoverTitleHtml("<b>oi</b>"), "&lt;b&gt;oi&lt;/b&gt;");
});

test("texto normal fica igual ao de antes: acentos, &, emojis e quebras de linha", () => {
  assert.equal(popoverTitleHtml("Clique em Salvar"), "Clique em Salvar");
  assert.equal(popoverBodyHtml("Linha 1\nLinha 2"), "Linha 1<br/>Linha 2");
  assert.equal(popoverBodyHtml("a\r\nb\rc"), "a<br/>b<br/>c");
  assert.equal(popoverBodyHtml("Preço: R$ 450 mil & condomínio 🙂"), "Preço: R$ 450 mil &amp; condomínio 🙂");
  assert.equal(popoverTitleHtml(""), "");
  assert.equal(popoverBodyHtml(undefined), "");
});

test("cores do tema em style=: só formatos de cor", () => {
  for (const ok of ["#2A9D8F", "#fff", "rgb(1, 2, 3)", "rgba(0,0,0,.5)", "hsl(200 50% 40%)", "teal"]) assert.equal(safeCssColor(ok), ok);
  for (const bad of ['red;" onclick="x', "url(javascript:x)", "#fff\"><img src=x>", "expression(alert(1))", "a b"]) assert.equal(safeCssColor(bad), "");
});

test("player (preview, /p, /v, embed) passa título e texto pelo escape antes do driver.js", () => {
  const src = read("./player.js");
  assert.match(src, /title: popoverTitleHtml\(step\.popover\?\.title \|\| step\.label \|\| ""\)/);
  assert.match(src, /description: popoverBodyHtml\(step\.popover\?\.description \|\| ""\)/);
  assert.doesNotMatch(src, /description: \(step\.popover\?\.description \|\| ""\)\.replace/);
});

test("player do HTML offline usa a mesma regra (cópia inline) e o seletor de passo inicial também escapa", () => {
  const src = read("./standalonePlayer.js");
  const fn = src.slice(src.indexOf("function gfEscapeHtml("), src.indexOf("}\n", src.indexOf("function gfEscapeHtml(")) + 1);
  const gfEscapeHtml = new Function(`${fn}; return gfEscapeHtml;`)();
  for (const p of PAYLOADS) assert.equal(gfEscapeHtml(p), escapeHtml(p));
  assert.match(src, /title: gfEscapeHtml\(step\.popover\?\.title \|\| step\.label \|\| ""\)/);
  assert.match(src, /description: gfEscapeHtml\(/);
  assert.match(src, /const label = gfEscapeHtml\(step\.popover\?\.title/);
  assert.doesNotMatch(src, /description: \(step\.popover\?\.description \|\| ""\)\.replace/);
});

test("biblioteca e temas do editor: id e cores do tema escapados", () => {
  const src = read("./app.js");
  assert.match(src, /data-theme-id="\$\{escapeAttr\(id\)\}"/);
  assert.doesNotMatch(src, /style="background:\$\{(c|colors\.\w+)\}/);
});
