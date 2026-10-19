import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { flagCountry, flagSvg } from "./flags.js";

test("bandeira por idioma: pt→BR, en→GB, es→ES; região explícita vence", () => {
  assert.equal(flagCountry("pt"), "BR");
  assert.equal(flagCountry("pt-BR"), "BR");
  assert.equal(flagCountry("pt-PT"), "PT");
  assert.equal(flagCountry("en"), "GB");
  assert.equal(flagCountry("en-US"), "US");
  assert.equal(flagCountry("es"), "ES");
});

test("flagSvg é SVG local (sem emoji), decorativo, e cai para o código quando não há bandeira", () => {
  const svg = flagSvg("pt-BR");
  assert.match(svg, /^<svg class="gf-flag"/);
  assert.match(svg, /data-flag="BR"/);
  assert.match(svg, /aria-hidden="true"/);
  assert.doesNotMatch(svg, /\p{Regional_Indicator}/u);
  assert.match(flagSvg("all"), /gf-flag-globe/);
  assert.match(flagSvg("xx"), /gf-flag-code/);
});

test("editor: Editando em sem rótulo visível, com aria-label mantido e seletor de bandeira", () => {
  const html = readFileSync(new URL("../editor.html", import.meta.url), "utf8");
  assert.match(html, /<select id="edit-lang" aria-label="Editando em" data-i18n-aria="ml\.editingIn">/);
  assert.doesNotMatch(html, /Editando em:<\/span>/);
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  for (const id of ["edit-lang", "locale-select", "export-video-lang", "embed-lang"]) {
    assert.ok(app.includes(`"${id}"`), id);
  }
  assert.match(app, /enhanceLangSelect/);
});

test("landing/ajuda: menu de idioma com bandeiras e links rastreáveis", () => {
  for (const f of ["../index.html", "../en.html", "../es.html", "../ajuda.html"]) {
    const html = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.match(html, /<details class="locale-menu">/, f);
    assert.match(html, /<nav class="locale-links" id="locale-links"/, f);
    assert.match(html, /hreflang="en"/, f);
    assert.match(html, /data-flag="BR"/, f);
  }
});

test("selos Pro somem para assinante, exceto no diálogo de upgrade", () => {
  const css = readFileSync(new URL("../css/app.css", import.meta.url), "utf8");
  assert.match(css, /body\.gf-subscriber \.pro-badge:not\(#modal-upgrade \.pro-badge\)/);
  assert.match(css, /body\.gf-subscriber \.pro-crown/);
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  assert.match(app, /classList\.toggle\("gf-subscriber", subscriber\)/);
});
