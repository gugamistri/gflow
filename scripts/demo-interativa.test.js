import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ASSET_PREFIX_RE } from "./asset-version.mjs";

const root = new URL("../", import.meta.url);
const read = (name) => readFileSync(new URL(name, root), "utf8");

const TITLE = "Demo interativa: o que é e como criar grátis, sem cadastro | GuiaFlow";
const H1 = "Demo interativa: o que é e como criar a sua hoje";
const CANONICAL = "https://guiaflow.pro/demo-interativa";
const unesc = (s) => s.replaceAll("&quot;", '"').replaceAll("&#x27;", "'").replaceAll("&amp;", "&");

test("/demo-interativa: só pt-BR, canonical próprio, assets versionados, CTAs e exemplos", () => {
  const html = read("demo-interativa.html");
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
  assert.match(html, /href="https:\/\/guiaflow\.pro\/exemplos\/galeria"/);
  assert.match(html, /src="\/exemplos\/guia\?embed=1"/);
  assert.match(html, /href="\/para-agencias"/);
  assert.match(html, /href="\/alternativa-getdemo"/);
  assert.match(html, /href="\/ajuda"/);
  assert.match(read("para-agencias.html"), /href="\/demo-interativa"/);
  assert.match(read("alternativa-getdemo.html"), /href="\/demo-interativa"/);
});

test("/demo-interativa: copy sem vocabulário vetado e concorrentes com fonte e data", () => {
  const html = read("demo-interativa.html");
  assert.equal(/plataforma|intelig[eê]ncia|ecossistema|potencializ|platform|intelligence|ecosystem|empower/i.test(html), false);
  assert.equal(/nstech|Plano&amp;Plano|Plano&Plano/i.test(html), false);
  assert.match(html, /verificados em \d{2}\/\d{2}\/2026/);
  for (const u of ["https://supademo.com/pricing", "https://www.storylane.io/pricing", "https://demo-maker.dplooy.com/"]) {
    assert.ok(html.includes(`<a href="${u}" rel="nofollow noopener" target="_blank">`), u);
  }
  assert.match(html, /Dados de concorrentes conferidos em 17\/11\/2026/);
  assert.equal(/<h2>Fontes<\/h2>|GuiaFlow, consultado na mesma data/.test(html), false);
  const fontes = html.match(/<p class="sources" id="fontes">[\s\S]*?<\/p>/)[0];
  assert.ok(fontes);
  assert.equal(/guiaflow\.pro|github\.com\/gugamistri/i.test(fontes), false);
  for (const m of fontes.matchAll(/<a\b[^>]*>/g)) {
    assert.match(m[0], /\brel="nofollow noopener"/);
  }
});

test("/demo-interativa: JSON-LD WebPage + BreadcrumbList + FAQPage + HowTo, FAQ igual à visível", () => {
  const html = read("demo-interativa.html");
  const data = JSON.parse(html.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/)[1]);
  assert.deepEqual(data["@graph"].map((n) => n["@type"]), ["WebPage", "BreadcrumbList", "FAQPage", "HowTo"]);
  assert.equal(data["@graph"][0].name, TITLE);
  assert.equal(data["@graph"][0].url, CANONICAL);
  const visible = unesc(html);
  const faq = data["@graph"][2].mainEntity;
  assert.equal(faq.length, 7);
  for (const q of faq) {
    assert.ok(visible.includes(`<h3>${q.name}</h3>`), q.name);
    assert.ok(visible.includes(`<p>${q.acceptedAnswer.text}</p>`), q.name);
  }
  assert.equal(data["@graph"][3].step.length, 5);
  assert.equal(/"@type":"(Review|AggregateRating|Product|Offer)"/.test(JSON.stringify(data)), false);
});

test("/demo-interativa está no sitemap (sem hreflang) e no llms.txt", () => {
  const xml = read("sitemap.xml");
  const block = xml.split("<loc>https://guiaflow.pro/demo-interativa</loc>")[1]?.split("</url>")[0];
  assert.ok(block, "fora do sitemap");
  assert.match(block, /<lastmod>2026-11-17<\/lastmod>/);
  assert.equal(block.includes("hreflang"), false);
  assert.match(read("llms.txt"), /https:\/\/guiaflow\.pro\/demo-interativa/);
});
