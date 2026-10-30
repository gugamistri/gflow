// Regressão: o interruptor "mostrar a narração como legenda" tem de estar no painel da direita (seção Narração).
// why: #46/#47 (a/42–a/43) tiraram o checkbox do painel e o deixaram só como ícone na barra do passo, escondido sem texto.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { catalogs, SUPPORTED_LOCALES } from "./i18n.js";
import { stepShowsCaption } from "./playback.js";

const html = readFileSync(new URL("../editor.html", import.meta.url), "utf8");
const editorJs = readFileSync(new URL("./editor.js", import.meta.url), "utf8");

function section(startMarker, endMarker) {
  const i = html.indexOf(startMarker);
  assert.ok(i >= 0, startMarker);
  const j = html.indexOf(endMarker, i);
  return html.slice(i, j);
}

test("painel da direita: interruptor da legenda na seção Narração, sempre à vista", () => {
  const narration = section('data-sec="narration"', "</details>");
  assert.match(narration, /<input type="checkbox" id="prop-show-caption"[^>]*\schecked\b/);
  const wrap = narration.match(/<label[^>]*id="wrap-show-caption"[^>]*>/)?.[0];
  assert.ok(wrap, "wrap-show-caption no painel");
  assert.doesNotMatch(wrap, /\shidden\b/);
  assert.match(narration, /data-i18n="props.showCaption"/);
  assert.match(narration, /data-i18n="props.showCaptionHint"/);
  // um só checkbox com esse id no editor
  assert.equal((html.match(/id="prop-show-caption"/g) || []).length, 1);
});

test("barra do passo: só um atalho que espelha o checkbox do painel", () => {
  const tag = html.match(/<button[^>]*id="stb-show-caption"[^>]*>/)?.[0];
  assert.ok(tag, "stb-show-caption");
  assert.match(tag, /aria-pressed="/);
  assert.match(tag, /data-i18n-title="narrbar.showTextTitle"/);
  assert.match(editorJs, /stbShowCaption\?\.addEventListener\("click", \(\) => toggleCheckbox\(els\.propShowCaption\)\)/);
  assert.match(editorJs, /els\.stbShowCaption\?\.setAttribute\("aria-pressed"/);
  // o painel nunca é escondido pelo JS (era `wrapShow.hidden = !hasText`)
  assert.doesNotMatch(editorJs, /wrap-show-caption/);
});

test("textos do interruptor em todos os idiomas; o aviso do painel não manda mais para a barra", () => {
  for (const loc of SUPPORTED_LOCALES) {
    const c = catalogs[loc];
    for (const k of ["props.showCaption", "props.showCaptionHint", "narrbar.showTextTitle"]) assert.ok(c[k], `${loc}:${k}`);
    assert.match(c["props.showCaptionHint"], /CC/);
  }
  assert.doesNotMatch(catalogs.pt["narrbar.panelNote"], /mostrar o texto/i);
});

test("o valor salvo é o que o player usa em preview, /p, /v e embed", () => {
  assert.equal(stepShowsCaption({ caption: "Oi" }), true);
  assert.equal(stepShowsCaption({ caption: "Oi", showCaption: false }), false);
  assert.match(editorJs, /step\.showCaption = els\.propShowCaption \? els\.propShowCaption\.checked : true;/);
});
