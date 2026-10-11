import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { catalogs, SUPPORTED_LOCALES } from "./i18n.js";
import { legalCatalogs } from "./legal-i18n.js";

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

test("privacidade e termos usam o mesmo i18n da /ajuda", () => {
  for (const file of ["privacidade.html", "termos.html"]) {
    const html = read(file);
    assert.match(html, /localStorage\.getItem\("ns-locale"\)/, file);
    assert.match(html, /<select id="locale-select"[^>]*>/, file);
    for (const loc of SUPPORTED_LOCALES) assert.match(html, new RegExp(`<option value="${loc}">`), file);
    assert.match(html, /import \{ initLocale, applyI18n, bindLocaleSelect \} from "\.\/a\/49\/js\/i18n\.js"/, file);
    assert.match(html, /import "\.\/a\/49\/js\/legal-i18n\.js"/, file);
    const keys = [...html.matchAll(/data-i18n(?:-html|-aria)?="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(keys.length > 40, file);
    for (const key of keys) {
      for (const loc of SUPPORTED_LOCALES) {
        assert.ok(catalogs[loc][key], `${file} ${loc} ${key}`);
      }
    }
  }
});

test("textos legais existem nas três línguas, com os mesmos links e sem 'nuvem'", () => {
  const ptKeys = Object.keys(legalCatalogs.pt).sort();
  for (const loc of SUPPORTED_LOCALES) {
    assert.deepEqual(Object.keys(legalCatalogs[loc]).sort(), ptKeys, loc);
    for (const [key, value] of Object.entries(legalCatalogs[loc])) {
      assert.equal(/nuvem/i.test(value), false, `${loc} ${key}`);
      const tags = (s) => s.match(/<[^>]+>/g) || [];
      assert.deepEqual(tags(value), tags(legalCatalogs.pt[key]), `${loc} ${key}`);
    }
  }
  assert.equal(legalCatalogs.en["privacy.updated"], "Last updated: October 11, 2026");
  assert.equal(legalCatalogs.es["privacy.updated"], "Última actualización: 11 de octubre de 2026");
  assert.equal(legalCatalogs.en["terms.updated"], "Last updated: October 11, 2026");
  assert.equal(legalCatalogs.es["terms.updated"], "Última actualización: 11 de octubre de 2026");
  assert.equal(legalCatalogs.pt["privacy.updated"], "Última atualização: 11 de outubro de 2026");
});

test("o aviso do Pro não diz mais que os termos estão só em português", () => {
  for (const loc of SUPPORTED_LOCALES) {
    const text = catalogs[loc]["billing.legal"];
    assert.match(text, /href=\\?"\/termos\\?"/);
    assert.match(text, /href=\\?"\/privacidade\\?"/);
    assert.equal(/portugu/i.test(text), false, loc);
  }
});

test("privacidade e termos explicam a captura de contatos: autor controlador, GuiaFlow operador", () => {
  const privacy = read("privacidade.html");
  const terms = read("termos.html");
  assert.match(privacy, /id="contatos-visitantes"/);
  assert.match(terms, /id="contatos-visitantes"/);
  for (const loc of SUPPORTED_LOCALES) {
    const c = legalCatalogs[loc];
    assert.ok(c["privacy.leads.p2"] && c["terms.leads.p1"], loc);
    assert.ok(c["privacy.retencao.li6"] && c["privacy.resumo.li6"], loc);
  }
  assert.match(legalCatalogs.pt["privacy.leads.p2"], /autor do tour é o controlador/);
  assert.match(legalCatalogs.pt["privacy.leads.p2"], /GuiaFlow é o operador/);
  assert.match(legalCatalogs.en["privacy.leads.p2"], /controller/);
  assert.match(legalCatalogs.en["privacy.leads.p2"], /processor/);
  assert.match(legalCatalogs.es["privacy.leads.p2"], /encargado/);
  assert.equal(legalCatalogs.pt["terms.contato.title"], "14. Contato");
});
