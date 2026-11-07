import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolvePlayerUiLocale } from "./i18n.js";

test("resolvePlayerUiLocale: ?lang= vence o idioma do navegador", () => {
  assert.equal(resolvePlayerUiLocale({ search: "?lang=en", language: "pt-BR" }), "en");
  assert.equal(resolvePlayerUiLocale({ search: "?lang=es", language: "en-US" }), "es");
  assert.equal(resolvePlayerUiLocale({ search: "?lang=pt", language: "en" }), "pt");
  assert.equal(resolvePlayerUiLocale({ search: "?embed=1&lang=en-US", language: "pt-BR" }), "en");
  assert.equal(resolvePlayerUiLocale({ search: "lang=es", language: "pt" }), "es");
});

test("resolvePlayerUiLocale: ?lang= inválido cai no navigator.language", () => {
  assert.equal(resolvePlayerUiLocale({ search: "?lang=fr", language: "en-GB" }), "en");
  assert.equal(resolvePlayerUiLocale({ search: "?lang=", language: "es-MX" }), "es");
  assert.equal(resolvePlayerUiLocale({ search: "", language: "pt-PT" }), "pt");
});

test("resolvePlayerUiLocale: sem ?lang= e sem idioma conhecido, o fallback é pt", () => {
  assert.equal(resolvePlayerUiLocale({ search: "", language: "de-DE" }), "pt");
  assert.equal(resolvePlayerUiLocale({ search: "?lang=ja", language: "fr" }), "pt");
  assert.equal(resolvePlayerUiLocale({}), "pt");
  assert.equal(resolvePlayerUiLocale({ language: "" }), "pt");
});

test("o shell do player lê ?lang= e navigator.language, com fallback pt", () => {
  const view = readFileSync(new URL("../view.html", import.meta.url), "utf8");
  const shell = readFileSync(new URL("../api/lib/view-shell.cjs", import.meta.url), "utf8");
  for (const [name, html] of [["view.html", view], ["view-shell", shell]]) {
    const script = html.slice(html.indexOf("<script>"), html.indexOf("</script>"));
    assert.match(script, /URLSearchParams\(location\.search\)\.get\("lang"\)/, name);
    assert.match(script, /navigator\.language/, name);
    assert.equal(/ns-locale/.test(script), false, name);
    assert.match(script, /pick = "pt"/, name);
    assert.match(script, /pick === "pt" \? "pt-BR" : pick/, name);
  }
});
