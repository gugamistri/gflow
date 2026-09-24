import assert from "node:assert/strict";
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

test("catálogos compartilham as mesmas chaves", () => {
  const keys = Object.keys(catalogs.pt).sort();
  for (const loc of SUPPORTED_LOCALES) {
    assert.deepEqual(Object.keys(catalogs[loc]).sort(), keys, loc);
  }
  assert.ok(keys.length > 50);
});
