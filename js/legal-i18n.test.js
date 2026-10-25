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
    assert.match(html, /<nav class="locale-links"[^>]*>/, file);
    for (const loc of SUPPORTED_LOCALES) assert.match(html, new RegExp(`<a href="[^"]+" hreflang="[^"]*" lang="${loc === "pt" ? "pt-BR" : loc}"`), file);
    assert.match(html, /import \{ initLocale, applyI18n, bindLocaleSelect \} from "\.\/a\/151\/js\/i18n\.js"/, file);
    assert.match(html, /import "\.\/a\/151\/js\/legal-i18n\.js"/, file);
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
  assert.equal(legalCatalogs.en["privacy.updated"], "Last updated: October 13, 2026");
  assert.equal(legalCatalogs.es["privacy.updated"], "Última actualización: 13 de octubre de 2026");
  assert.equal(legalCatalogs.en["terms.updated"], "Last updated: October 11, 2026");
  assert.equal(legalCatalogs.es["terms.updated"], "Última actualización: 11 de octubre de 2026");
  assert.equal(legalCatalogs.pt["privacy.updated"], "Última atualização: 13 de outubro de 2026");
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

test("privacidade separa o link de login (15 min) do link de convite (7 dias)", () => {
  const html = read("privacidade.html");
  const week = { pt: /7 dias/, es: /7 días/, en: /7 days/ };
  for (const loc of SUPPORTED_LOCALES) {
    for (const key of ["privacy.pro.p3", "privacy.retencao.li4"]) {
      const value = legalCatalogs[loc][key];
      assert.match(value, /15/, `${loc} ${key}`);
      assert.match(value, week[loc], `${loc} ${key}`);
    }
  }
  assert.match(html, /convite do GuiaFlow Pro vale 7 dias/);
  assert.match(html, /link de ativação de um convite vale 7 dias/);
});

test("privacidade e termos explicam a análise de visitas: sem cookies, DNT/GPC, 90 dias / 25 meses", () => {
  const privacy = read("privacidade.html");
  assert.match(privacy, /id="visitas-tours"/);
  for (const loc of SUPPORTED_LOCALES) {
    const c = legalCatalogs[loc];
    for (const key of ["privacy.analytics.p1", "privacy.analytics.li4", "privacy.analytics.p3", "privacy.analytics.p5", "privacy.retencao.li7", "terms.leads.p3"]) {
      assert.ok(c[key], `${loc} ${key}`);
    }
    assert.match(c["privacy.analytics.p3"], /DNT/);
    assert.match(c["privacy.analytics.p3"], /GPC/);
    assert.match(c["privacy.analytics.p5"], /90/);
    assert.match(c["privacy.analytics.p5"], /25/);
    // why: o resumo e a seção de cookies não podem mais dizer que não há análise de audiência
    assert.equal(/análise de audiência|análisis de audiencia|audience analytics/i.test(c["privacy.resumo.li5"] + c["privacy.cookies.p1"]), false, loc);
  }
  assert.match(legalCatalogs.pt["privacy.analytics.p5"], /autor do tour é o controlador/);
  assert.match(legalCatalogs.en["privacy.analytics.p5"], /processor/);
  assert.match(legalCatalogs.es["privacy.analytics.p5"], /encargado/);
});
