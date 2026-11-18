import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ASSET_PREFIX_RE } from "./asset-version.mjs";

const root = new URL("../", import.meta.url);
const read = (name) => readFileSync(new URL(name, root), "utf8");

const TITLE = "Demo para founders e times de produto: entregue um link, não mais uma reunião | GuiaFlow";
const H1 = "Entregue uma demo, não mais uma reunião";
const CANONICAL = "https://guiaflow.pro/para-times-de-produto";
const unesc = (s) => s.replaceAll("&quot;", '"').replaceAll("&#x27;", "'").replaceAll("&amp;", "&");

test("/para-times-de-produto: só pt-BR, canonical próprio, assets versionados, CTAs e exemplos", () => {
  const html = read("para-times-de-produto.html");
  assert.match(html, /<html lang="pt-BR">/);
  assert.ok(html.includes(`<title>${TITLE}</title>`));
  assert.ok(html.includes(`<h1>${H1}</h1>`));
  assert.ok(html.includes(`<link rel="canonical" href="${CANONICAL}" />`));
  assert.equal(/hreflang="(en|es)"/.test(html), false, "sem versão en/es ainda");
  for (const css of ["theme", "shell", "ajuda"]) assert.match(html, new RegExp(`${ASSET_PREFIX_RE}css\\/${css}\\.css`));
  assert.match(html, new RegExp(`<script type="module" src="\\/${ASSET_PREFIX_RE}js\\/landingAnalytics\\.js"><\\/script>`));
  assert.match(html, /href="\/editor">Abrir o editor grátis</);
  assert.match(html, /href="https:\/\/guiaflow\.pro\/editor\?pro=1">Assinar o Pro — R\$ 36\/mês ou R\$ 359\/ano</);
  assert.match(html, /href="https:\/\/guiaflow\.pro\/exemplos\/guia"/);
  assert.match(html, /src="\/exemplos\/guia\?embed=1"/);
  assert.match(html, /href="\/integracoes"/);
  assert.match(html, /servidor MCP/);
  assert.match(html, /Cursor ou ao Claude/);
  assert.match(html, /href="\/para-agencias"/);
  assert.match(html, /href="\/para-consultorias"/);
  assert.match(html, /href="\/tour-de-produto"/);
  assert.equal(/href="\/(?:p|v)\//.test(html), false, "não cria links /p ou /v");
  assert.equal(read("en.html").includes("/para-times-de-produto"), false);
  assert.equal(read("es.html").includes("/para-times-de-produto"), false);
  assert.equal(read("cortesia.html").includes("/para-times-de-produto"), false);
});

test("/para-times-de-produto: copy sem vocabulário vetado, sem cases, sem fontes de concorrente inventadas", () => {
  const html = read("para-times-de-produto.html");
  assert.equal(/plataforma|intelig[eê]ncia|ecossistema|potencializ|platform|intelligence|ecosystem|empower/i.test(html), false);
  assert.equal(/nstech|Plano&amp;Plano|Plano&Plano/i.test(html), false);
  assert.equal(html.includes("área Clientes"), false);
  assert.match(html, /Não é white-label/);
  assert.equal(/<h2>Fontes<\/h2>|class="sources"/.test(html), false);
  const lead = html.match(/<p class="lead">([\s\S]*?)<\/p>/)[1].replace(/<[^>]+>/g, "").trim();
  const words = lead.split(/\s+/).length;
  assert.ok(words >= 40 && words <= 60, `lead com ${words} palavras`);
});

test("/para-times-de-produto: JSON-LD WebPage + BreadcrumbList + FAQPage, FAQ igual à visível", () => {
  const html = read("para-times-de-produto.html");
  const data = JSON.parse(html.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/)[1]);
  assert.deepEqual(data["@graph"].map((n) => n["@type"]), ["WebPage", "BreadcrumbList", "FAQPage"]);
  assert.equal(data["@graph"][0].name, TITLE);
  assert.equal(data["@graph"][0].url, CANONICAL);
  const visible = unesc(html);
  const faq = data["@graph"][2].mainEntity;
  assert.equal(faq.length, 9);
  for (const q of faq) {
    assert.ok(visible.includes(`<h3>${q.name}</h3>`), q.name);
    assert.ok(visible.includes(`<p>${q.acceptedAnswer.text}</p>`), q.name);
  }
  assert.equal(/"@type":"(Review|AggregateRating|Product|Offer|SoftwareApplication)"/.test(JSON.stringify(data)), false);
});

test("/para-times-de-produto está no sitemap (sem hreflang) e no llms.txt", () => {
  const xml = read("sitemap.xml");
  const block = xml.split("<loc>https://guiaflow.pro/para-times-de-produto</loc>")[1]?.split("</url>")[0];
  assert.ok(block, "fora do sitemap");
  assert.match(block, /<lastmod>2026-11-17<\/lastmod>/);
  assert.equal(block.includes("hreflang"), false);
  assert.match(read("llms.txt"), /https:\/\/guiaflow\.pro\/para-times-de-produto/);
});

test("home PT aponta para /para-times-de-produto e /para-consultorias nos cards e no rodapé Comparações; /en e /es não", () => {
  const pt = read("index.html");
  assert.match(pt, /<h3 data-i18n="lp\.aud\.product\.title"><a href="\/para-times-de-produto"[^>]*>Times de produto e founders<\/a><\/h3>/);
  assert.match(pt, /<h3 data-i18n="lp\.aud\.consulting\.title"><a href="\/para-consultorias"[^>]*>Consultorias e implementação<\/a><\/h3>/);
  assert.match(pt, /<nav aria-label="Comparações"[^>]*>[\s\S]*href="\/para-times-de-produto">Para times de produto</);
  assert.match(pt, /<nav aria-label="Comparações"[^>]*>[\s\S]*href="\/para-consultorias">Para consultorias</);
  assert.equal(read("en.html").includes("/para-times-de-produto"), false);
  assert.equal(read("es.html").includes("/para-times-de-produto"), false);
  assert.equal(read("en.html").includes("/para-consultorias"), false);
  assert.equal(read("es.html").includes("/para-consultorias"), false);
});

test("build de locales não leva /para-times-de-produto nem /para-consultorias para /en nem /es", async () => {
  const { buildAll } = await import("./build-locale-pages.mjs");
  const files = buildAll();
  assert.match(files["index.html"], /href="\/para-times-de-produto"/);
  assert.match(files["index.html"], /href="\/para-consultorias"/);
  assert.equal(files["en.html"].includes("/para-times-de-produto"), false);
  assert.equal(files["es.html"].includes("/para-times-de-produto"), false);
  assert.equal(files["en.html"].includes("/para-consultorias"), false);
  assert.equal(files["es.html"].includes("/para-consultorias"), false);
});
