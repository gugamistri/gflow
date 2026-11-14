import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ASSET_PREFIX_RE } from "../scripts/asset-version.mjs";
import { catalogs, SUPPORTED_LOCALES } from "./i18n.js";
import { legalCatalogs } from "./legal-i18n.js";

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

test("privacidade e termos usam o mesmo i18n da /ajuda", () => {
  for (const file of ["privacidade.html", "termos.html"]) {
    const html = read(file);
    assert.match(html, /localStorage\.getItem\("ns-locale"\)/, file);
    assert.match(html, /<nav class="locale-links"[^>]*>/, file);
    for (const loc of SUPPORTED_LOCALES) assert.match(html, new RegExp(`<a href="[^"]+" hreflang="[^"]*" lang="${loc === "pt" ? "pt-BR" : loc}"`), file);
    assert.match(html, new RegExp(`import \\{ initLocale, applyI18n, bindLocaleSelect \\} from "\\.\\/${ASSET_PREFIX_RE}js\\/i18n\\.js"`), file);
    assert.match(html, new RegExp(`import "\\.\\/${ASSET_PREFIX_RE}js\\/legal-i18n\\.js"`), file);
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
  assert.equal(legalCatalogs.en["privacy.updated"], "Last updated: November 14, 2026");
  assert.equal(legalCatalogs.es["privacy.updated"], "Última actualización: 14 de noviembre de 2026");
  assert.equal(legalCatalogs.en["terms.updated"], "Last updated: October 11, 2026");
  assert.equal(legalCatalogs.es["terms.updated"], "Última actualización: 11 de octubre de 2026");
  assert.equal(legalCatalogs.pt["privacy.updated"], "Última atualização: 14 de novembro de 2026");
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
  assert.match(privacy, /id="treinamento-identificado"/);
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

test("privacidade cita YouTube e Vimeo como terceiros que carregam ao abrir o passo do vídeo", () => {
  const privacy = read("privacidade.html");
  assert.match(privacy, /id="videos-incorporados"/);
  for (const loc of SUPPORTED_LOCALES) {
    const c = legalCatalogs[loc];
    assert.match(c["privacy.videos.p2"], /youtube-nocookie\.com/);
    assert.match(c["privacy.videos.p2"], /dnt=1/);
    assert.match(c["privacy.compartilhamento.li10"], /YouTube/);
    assert.match(c["privacy.compartilhamento.li10"], /Vimeo/);
    // why: o vídeo toca sozinho ao abrir o passo — o texto não pode mais dizer "só no clique/play"
    for (const k of ["privacy.videos.p2", "privacy.cookies.li7", "privacy.compartilhamento.li10"]) {
      assert.doesNotMatch(c[k], /clica no play|clicks play|clic en play/, `${loc} ${k}`);
    }
  }
});

test("privacidade explica a medição GTM: UTM 90 dias, DNT/GPC, primeira origem na conta, contagens sem dados pessoais", () => {
  const checks = {
    pt: [/90 dias/, /Não rastrear/, /GPC/, /uma única vez/, /sem dados pessoais/, /utm_source/],
    en: [/90 days/, /Do Not Track/, /GPC/, /recorded once/, /no personal data/, /utm_source/],
    es: [/90 días/, /No rastrear/, /GPC/, /una sola vez/, /sin datos personales/, /utm_source/],
  };
  for (const [loc, res] of Object.entries(checks)) {
    const text = ["privacy.gtm.li1", "privacy.gtm.li2", "privacy.gtm.li3"].map((k) => legalCatalogs[loc][k]).join(" ");
    for (const re of res) assert.match(text, re, `${loc} ${re}`);
  }
  assert.match(read("privacidade.html"), /id="medicao-guiaflow"/);
});
