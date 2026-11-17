import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ASSET_PREFIX_RE } from "./asset-version.mjs";

const root = new URL("../", import.meta.url);
const read = (name) => readFileSync(new URL(name, root), "utf8");

const TITLE = "Tour de produto interativo para o site e o lançamento | GuiaFlow";
const H1 = "Tour de produto interativo, sem instalar nada no seu app";
const CANONICAL = "https://guiaflow.pro/tour-de-produto";
const unesc = (s) => s.replaceAll("&quot;", '"').replaceAll("&#x27;", "'").replaceAll("&amp;", "&");

test("/tour-de-produto: só pt-BR, canonical próprio, assets versionados, CTAs e exemplos", () => {
  const html = read("tour-de-produto.html");
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
  assert.match(html, /href="\/demo-interativa"/);
  assert.match(html, /href="\/modelos"/);
  assert.match(html, /href="\/ajuda\/api"/);
  assert.match(html, /href="\/integracoes"/);
  assert.equal(/href="\/(?:p|v)\//.test(html), false, "não cria links /p ou /v");
  assert.match(read("demo-interativa.html"), /href="\/tour-de-produto"/);
  assert.match(read("para-agencias.html"), /href="\/tour-de-produto"/);
  assert.match(read("para-consultorias.html"), /href="\/tour-de-produto"/);
  assert.match(read("modelos.html"), /href="\/tour-de-produto"/);
  assert.match(read("alternativa-getdemo.html"), /href="\/tour-de-produto"/);
  assert.equal(read("index.html").includes("/tour-de-produto"), false);
  assert.equal(read("en.html").includes("/tour-de-produto"), false);
  assert.equal(read("es.html").includes("/tour-de-produto"), false);
  assert.equal(read("cortesia.html").includes("/tour-de-produto"), false);
});

test("/tour-de-produto: copy sem vocabulário vetado, onboarding qualificado, concorrentes com fonte e data", () => {
  const html = read("tour-de-produto.html");
  assert.equal(/plataforma|intelig[eê]ncia|ecossistema|potencializ|platform|intelligence|ecosystem|empower/i.test(html), false);
  assert.equal(/nstech|Plano&amp;Plano|Plano&Plano/i.test(html), false);
  assert.equal(html.includes("área Clientes"), false);
  assert.match(html, /não faz onboarding dentro do app/);
  assert.match(html, /onboarding por link/);
  assert.match(html, /verificados em \d{2}\/\d{2}\/2026/);
  for (const u of [
    "https://userguiding.com/pt-br/tours-guiados",
    "https://userguiding.com/pricing",
    "https://tipflow.com.br/pt-br/produto/walkthroughs",
    "https://supademo.com/pricing",
  ]) {
    assert.ok(html.includes(`<a href="${u}" rel="nofollow noopener" target="_blank">`), u);
  }
});

test("/tour-de-produto: JSON-LD WebPage + BreadcrumbList + FAQPage, FAQ igual à visível", () => {
  const html = read("tour-de-produto.html");
  const data = JSON.parse(html.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/)[1]);
  assert.deepEqual(data["@graph"].map((n) => n["@type"]), ["WebPage", "BreadcrumbList", "FAQPage"]);
  assert.equal(data["@graph"][0].name, TITLE);
  assert.equal(data["@graph"][0].url, CANONICAL);
  const visible = unesc(html);
  const faq = data["@graph"][2].mainEntity;
  assert.equal(faq.length, 6);
  for (const q of faq) {
    assert.ok(visible.includes(`<h3>${q.name}</h3>`), q.name);
    assert.ok(visible.includes(`<p>${q.acceptedAnswer.text}</p>`), q.name);
  }
  assert.equal(/"@type":"(Review|AggregateRating|Product|Offer)"/.test(JSON.stringify(data)), false);
});

test("/tour-de-produto está no sitemap (sem hreflang) e no llms.txt", () => {
  const xml = read("sitemap.xml");
  const block = xml.split("<loc>https://guiaflow.pro/tour-de-produto</loc>")[1]?.split("</url>")[0];
  assert.ok(block, "fora do sitemap");
  assert.match(block, /<lastmod>2026-11-17<\/lastmod>/);
  assert.equal(block.includes("hreflang"), false);
  assert.match(read("llms.txt"), /https:\/\/guiaflow\.pro\/tour-de-produto/);
});
