import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ASSET_PREFIX_RE } from "./asset-version.mjs";

const root = new URL("../", import.meta.url);
const read = (name) => readFileSync(new URL(name, root), "utf8");

const TITLE = "Exemplos de guia, galeria e processo (grátis) | GuiaFlow";
const H1 = "Exemplos de guia, galeria e processo para começar no editor";
const CANONICAL = "https://guiaflow.pro/modelos";
const unesc = (s) => s.replaceAll("&quot;", '"').replaceAll("&#x27;", "'").replaceAll("&amp;", "&");

test("/modelos: só pt-BR, canonical próprio, assets versionados, exemplos reais e CTAs honestos", () => {
  const html = read("modelos.html");
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
  assert.match(html, /href="https:\/\/guiaflow\.pro\/exemplos\/processo"/);
  assert.match(html, /src="\/exemplos\/guia\?embed=1"/);
  assert.match(html, /src="\/exemplos\/galeria\?embed=1"/);
  assert.match(html, /src="\/exemplos\/processo\?embed=1"/);
  assert.match(html, /href="\/editor\?novo=guia"/);
  assert.match(html, /href="\/editor\?novo=galeria"/);
  assert.match(html, /Como usar o Guia/);
  assert.match(html, /Luminária Arco Liana/);
  assert.match(html, /Como solicitar um reembolso/);
  assert.match(html, /Portal Alva/);
  assert.match(html, /O exemplo não é copiado para o seu projeto/);
  assert.equal(/Usar este modelo/i.test(html), false);
  assert.equal(/empreendimento|Galeria: imóvel|galeria de imóvel/i.test(html), false);
  assert.equal(/href="\/(?:p|v)\//.test(html), false, "não cria links /p ou /v");
  assert.match(html, /href="\/demo-interativa"/);
  assert.match(html, /href="\/para-agencias"/);
  assert.match(html, /href="\/para-consultorias"/);
  assert.match(html, /href="\/ajuda"/);
  assert.match(read("demo-interativa.html"), /href="\/modelos"/);
  assert.match(read("para-agencias.html"), /href="\/modelos"/);
  assert.match(read("para-consultorias.html"), /href="\/modelos"/);
  assert.match(read("alternativa-getdemo.html"), /href="\/modelos"/);
  assert.equal(read("index.html").includes("/modelos"), false);
  assert.equal(read("en.html").includes("/modelos"), false);
  assert.equal(read("es.html").includes("/modelos"), false);
});

test("/modelos: copy sem vocabulário vetado, sem clientes nem números inventados de catálogo", () => {
  const html = read("modelos.html");
  assert.equal(/plataforma|intelig[eê]ncia|ecossistema|potencializ|platform|intelligence|ecosystem|empower/i.test(html), false);
  assert.equal(/nstech|Plano&amp;Plano|Plano&Plano/i.test(html), false);
  assert.equal(html.includes("área Clientes"), false);
  assert.match(html, /Não é white-label/);
  assert.match(html, /três exemplos públicos/);
  assert.equal(/dois exemplos/.test(html), false);
});

test("/modelos: JSON-LD CollectionPage + ItemList + BreadcrumbList + FAQPage, FAQ igual à visível", () => {
  const html = read("modelos.html");
  const data = JSON.parse(html.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/)[1]);
  assert.deepEqual(data["@graph"].map((n) => n["@type"]), ["CollectionPage", "ItemList", "BreadcrumbList", "FAQPage"]);
  assert.equal(data["@graph"][0].name, TITLE);
  assert.equal(data["@graph"][0].url, CANONICAL);
  const items = data["@graph"][1].itemListElement;
  assert.equal(items.length, 3);
  assert.equal(items[0].item.url, "https://guiaflow.pro/exemplos/guia");
  assert.equal(items[1].item.url, "https://guiaflow.pro/exemplos/processo");
  assert.equal(items[2].item.url, "https://guiaflow.pro/exemplos/galeria");
  const visible = unesc(html);
  const faq = data["@graph"][3].mainEntity;
  assert.equal(faq.length, 6);
  for (const q of faq) {
    assert.ok(visible.includes(`<h3>${q.name}</h3>`), q.name);
    assert.ok(visible.includes(`<p>${q.acceptedAnswer.text}</p>`), q.name);
  }
  assert.equal(/"@type":"(Review|AggregateRating|Product|Offer)"/.test(JSON.stringify(data)), false);
});

test("/modelos está no sitemap (sem hreflang) e no llms.txt", () => {
  const xml = read("sitemap.xml");
  const block = xml.split("<loc>https://guiaflow.pro/modelos</loc>")[1]?.split("</url>")[0];
  assert.ok(block, "fora do sitemap");
  assert.match(block, /<lastmod>2026-11-17<\/lastmod>/);
  assert.equal(block.includes("hreflang"), false);
  assert.match(read("llms.txt"), /https:\/\/guiaflow\.pro\/modelos/);
});
