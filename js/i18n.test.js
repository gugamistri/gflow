import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  catalogs,
  normalizeLocaleTag,
  resolveLocale,
  SUPPORTED_LOCALES,
} from "./i18n.js";

test("resolveLocale mapeia pt e variantes", () => {
  assert.equal(resolveLocale(["pt-BR"]), "pt");
  assert.equal(resolveLocale(["pt-PT", "en"]), "pt");
  assert.equal(resolveLocale(["pt"]), "pt");
});

test("resolveLocale mapeia es e variantes", () => {
  assert.equal(resolveLocale(["es-ES"]), "es");
  assert.equal(resolveLocale(["es-MX", "en-US"]), "es");
});

test("resolveLocale cai em en quando não há pt/es", () => {
  assert.equal(resolveLocale(["fr-FR", "de"]), "en");
  assert.equal(resolveLocale([]), "en");
  assert.equal(resolveLocale(null), "en");
});

test("normalizeLocaleTag rejeita tags vazias", () => {
  assert.equal(normalizeLocaleTag(""), null);
  assert.equal(normalizeLocaleTag("ja-JP"), null);
});

test("métricas do editor existem em pt, es e en", () => {
  assert.match(catalogs.pt["editor.metricsOne"], /1 passo · \{time\}/);
  assert.match(catalogs.pt["editor.metricsMany"], /\{n\} passos · \{time\}/);
  assert.match(catalogs.es["editor.metricsOne"], /1 paso · \{time\}/);
  assert.match(catalogs.es["editor.metricsMany"], /\{n\} pasos · \{time\}/);
  assert.match(catalogs.en["editor.metricsOne"], /1 step · \{time\}/);
  assert.match(catalogs.en["editor.metricsMany"], /\{n\} steps · \{time\}/);
});

test("o painel da nuvem não mostra o host da API", () => {
  for (const loc of SUPPORTED_LOCALES) {
    for (const [key, value] of Object.entries(catalogs[loc])) {
      if (!key.startsWith("share.cloud.")) continue;
      assert.equal(/api\.guiaflow\.pro/i.test(value), false, `${loc} ${key}`);
      assert.equal(/\bAPI\b/.test(value), false, `${loc} ${key}`);
    }
    assert.match(catalogs[loc]["share.cloud.sent"], /email/i);
    assert.match(catalogs[loc]["share.cloud.signedIn"], /\{email\}/);
    assert.equal(catalogs[loc]["share.cloud.openSite"], undefined);
  }
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const start = html.indexOf('id="cloud-login"');
  const end = html.indexOf('id="btn-export-html"');
  const panel = html.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.equal(/api\.guiaflow\.pro/i.test(panel), false);
  assert.equal(/app\.guiaflow\.pro/i.test(panel), false);
  assert.equal(panel.includes("cloud-open-site"), false);
  assert.match(panel, /link de confirmação do GuiaFlow/);
  assert.match(panel, /O link abriu noutro aparelho/);
});

test("catálogos compartilham as mesmas chaves", () => {
  const keys = Object.keys(catalogs.pt).sort();
  for (const loc of SUPPORTED_LOCALES) {
    assert.deepEqual(Object.keys(catalogs[loc]).sort(), keys, loc);
  }
  assert.ok(keys.length > 50);
});
