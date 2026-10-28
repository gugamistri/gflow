import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = ["shell", "player", "editor"].map((n) => readFileSync(new URL(`../css/${n}.css`, import.meta.url), "utf8")).join("\n");
const html = readFileSync(new URL("../editor.html", import.meta.url), "utf8");
const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");

test("celular: sem ⚙ (Ajustes abre o mesmo #prefs-panel) e sem Resultados no cabeçalho", () => {
  assert.match(css, /body\.is-compact-touch #btn-prefs,\s*body\.is-compact-touch #btn-results\s*\{\s*display:\s*none\s*!important\s*;\s*\}/);
  assert.match(app, /onSettings: \(\) => \{\s*const prefs = document\.getElementById\("prefs-panel"\)/);
});

test("GUI-32: no celular, Resultados fica em Publicar (barra de baixo), com o mesmo critério do botão", () => {
  assert.equal(html.includes('id="btn-menu-results"'), false);
  const sheet = html.slice(html.indexOf('id="mobile-publish"'), html.indexOf("\n  </div>", html.indexOf('id="mobile-publish"')));
  for (const k of ["capture", "share", "results"]) assert.match(sheet, new RegExp(`data-publish="${k}"`), k);
  assert.match(sheet, /data-publish="results"[^>]*hidden/);
  assert.match(app, /mobileBar\?\.paintPublish\?\.\(\)/);
  // com a barra de baixo, Captura e Compartilhar saem do cabeçalho (abrem por Publicar)
  assert.match(css, /body\.has-mobile-bar #btn-capture,\s*body\.has-mobile-bar \.topbar \.export-panel > summary \{ display: none !important; \}/);
});

test("GUI-32: Entrar pelo ☰ só no celular; o chip da Conta só aparece com login", () => {
  assert.match(html, /class="more-item compact-only" id="btn-menu-account"/);
  assert.match(app, /chip\.hidden = !enabled \|\| !signedIn;/);
});

test("botão da conta no celular: 44px com o estilo dos outros botões", () => {
  assert.match(css, /body\.is-compact-touch \.account-chip-toggle \{[^}]*width: 44px;[^}]*height: 44px;[^}]*border: 1px solid/);
});
