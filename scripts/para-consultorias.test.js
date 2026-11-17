import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ASSET_PREFIX_RE } from "./asset-version.mjs";

const root = new URL("../", import.meta.url);
const read = (name) => readFileSync(new URL(name, root), "utf8");

const TITLE = "Treinamento de implantação com guias interativos | GuiaFlow";
const H1 = "Guias interativos para treinar o time do cliente na implantação";
const CANONICAL = "https://guiaflow.pro/para-consultorias";
const unesc = (s) => s.replaceAll("&quot;", '"').replaceAll("&#x27;", "'").replaceAll("&amp;", "&");

test("/para-consultorias: só pt-BR, canonical próprio, assets versionados, CTAs e exemplos", () => {
  const html = read("para-consultorias.html");
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
  assert.match(html, /href="\/para-agencias"/);
  assert.match(html, /href="\/ajuda"/);
  assert.match(html, /href="\/modelos"/);
  assert.match(read("para-agencias.html"), /href="\/para-consultorias"/);
  assert.match(read("demo-interativa.html"), /href="\/para-consultorias"/);
  assert.match(read("alternativa-getdemo.html"), /href="\/para-consultorias"/);
  assert.equal(read("index.html").includes("/para-consultorias"), false);
  assert.equal(read("en.html").includes("/para-consultorias"), false);
  assert.equal(read("es.html").includes("/para-consultorias"), false);
});

test("/para-consultorias: copy sem vocabulário vetado, Clientes com ressalva, sem desktop nativo prometido", () => {
  const html = read("para-consultorias.html");
  assert.equal(/plataforma|intelig[eê]ncia|ecossistema|potencializ|platform|intelligence|ecosystem|empower/i.test(html), false);
  assert.equal(/nstech|Plano&amp;Plano|Plano&Plano/i.test(html), false);
  const clientes = html.split("área Clientes").slice(1);
  assert.ok(clientes.length >= 2);
  for (const after of clientes) assert.match(after.slice(0, 220), /Não é white-label/);
  assert.equal(/ERP desktop nativo|sistema nativo|captura nativa/i.test(html), false);
  assert.match(html, /abre uma janela com a página do produto/);
  assert.match(html, /verificados em \d{2}\/\d{2}\/2026/);
  for (const u of ["https://trails.so/free", "https://supademo.com/pricing", "https://userguiding.com/pricing"]) {
    assert.ok(html.includes(`<a href="${u}" rel="nofollow noopener" target="_blank">`), u);
  }
});

test("/para-consultorias: JSON-LD WebPage + BreadcrumbList + FAQPage, FAQ igual à visível", () => {
  const html = read("para-consultorias.html");
  const data = JSON.parse(html.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/)[1]);
  assert.deepEqual(data["@graph"].map((n) => n["@type"]), ["WebPage", "BreadcrumbList", "FAQPage"]);
  assert.equal(data["@graph"][0].name, TITLE);
  assert.equal(data["@graph"][0].url, CANONICAL);
  const visible = unesc(html);
  const faq = data["@graph"][2].mainEntity;
  assert.equal(faq.length, 8);
  for (const q of faq) {
    assert.ok(visible.includes(`<h3>${q.name}</h3>`), q.name);
    assert.ok(visible.includes(`<p>${q.acceptedAnswer.text}</p>`), q.name);
  }
  assert.equal(/"@type":"(Review|AggregateRating|Product|Offer)"/.test(JSON.stringify(data)), false);
});

test("/para-consultorias está no sitemap (sem hreflang) e no llms.txt", () => {
  const xml = read("sitemap.xml");
  const block = xml.split("<loc>https://guiaflow.pro/para-consultorias</loc>")[1]?.split("</url>")[0];
  assert.ok(block, "fora do sitemap");
  assert.match(block, /<lastmod>2026-11-17<\/lastmod>/);
  assert.equal(block.includes("hreflang"), false);
  assert.match(read("llms.txt"), /https:\/\/guiaflow\.pro\/para-consultorias/);
});
