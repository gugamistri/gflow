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

test("Resultados (Análise e Contatos) no menu ☰ só no celular, com o mesmo critério do botão", () => {
  assert.match(html, /id="btn-menu-results"/);
  assert.match(app, /menuResults\.hidden = !showAnalytics/);
  assert.match(app, /getElementById\("btn-menu-results"\)\?\.addEventListener\("click"[\s\S]{0,160}openAnalytics\(\)/);
  assert.match(css, /body:not\(\.is-compact-touch\) #btn-menu-results\s*\{\s*display:\s*none\s*!important\s*;\s*\}/);
});

test("botão da conta no celular: 44px com o estilo dos outros botões", () => {
  assert.match(css, /body\.is-compact-touch \.account-chip-toggle \{[^}]*width: 44px;[^}]*height: 44px;[^}]*border: 1px solid/);
});
