import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ASSET_PREFIX_RE } from "./asset-version.mjs";

const root = new URL("../", import.meta.url);
const read = (name) => readFileSync(new URL(name, root), "utf8");

const TITLE = "Alternativa à Fluidz Demos: GuiaFlow, grátis e com preço público";
const H1 = "Alternativa à Fluidz Demos: GuiaFlow vs Fluidz Demos, lado a lado";
const CANONICAL = "https://guiaflow.pro/alternativa-fluidz-demos";
const unesc = (s) => s.replaceAll("&quot;", '"').replaceAll("&#x27;", "'").replaceAll("&amp;", "&");

test("/alternativa-fluidz-demos: só pt-BR, canonical próprio, assets versionados, CTAs e exemplos", () => {
  const html = read("alternativa-fluidz-demos.html");
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
  assert.match(html, /href="\/alternativa-getdemo"/);
  assert.match(html, /href="\/demo-interativa"/);
  assert.match(html, /href="\/modelos"/);
  assert.equal(/href="\/(?:p|v)\//.test(html), false, "não cria links /p ou /v");
  assert.match(read("alternativa-getdemo.html"), /href="\/alternativa-fluidz-demos"/);
  assert.match(read("demo-interativa.html"), /href="\/alternativa-fluidz-demos"/);
  assert.match(read("para-agencias.html"), /href="\/alternativa-fluidz-demos"/);
  assert.equal(read("index.html").includes("/alternativa-fluidz-demos"), false);
  assert.equal(read("en.html").includes("/alternativa-fluidz-demos"), false);
  assert.equal(read("es.html").includes("/alternativa-fluidz-demos"), false);
  assert.equal(read("cortesia.html").includes("/alternativa-fluidz-demos"), false);
});

test("/alternativa-fluidz-demos: copy sem vocabulário vetado, Clientes com ressalva, concorrentes com fonte e data", () => {
  const html = read("alternativa-fluidz-demos.html");
  assert.equal(/plataforma|intelig[eê]ncia|ecossistema|potencializ|platform|intelligence|ecosystem|empower/i.test(html), false);
  assert.equal(/nstech|Plano&amp;Plano|Plano&Plano/i.test(html), false);
  const clientes = html.split("área Clientes").slice(1);
  assert.ok(clientes.length >= 1);
  for (const after of clientes) assert.match(after.slice(0, 220), /Não é white-label/);
  assert.match(html, /verificadas em \d{2}\/\d{2}\/2026/);
  for (const u of [
    "https://demos.fluidz.com.br/",
    "https://demos.fluidz.com.br/pricing",
    "https://demos.fluidz.com.br/terms",
  ]) {
    assert.ok(html.includes(`<a href="${u}" rel="nofollow noopener" target="_blank">`), u);
  }
  assert.match(html, /R\$ 1\.264/);
  assert.match(html, /R\$ 3\.950/);
  assert.match(html, /trial de 7 dias/);
});

test("/alternativa-fluidz-demos: JSON-LD WebPage + BreadcrumbList + FAQPage, FAQ igual à visível", () => {
  const html = read("alternativa-fluidz-demos.html");
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
  const dump = JSON.stringify(data);
  assert.equal(/"@type":"SoftwareApplication"/.test(dump), false);
  assert.equal(/"@type":"AggregateRating"/.test(dump), false);
  assert.equal(/"@type":"Review"/.test(dump), false);
});

test("/alternativa-fluidz-demos cabe na largura do mobile (CSS da página)", () => {
  const html = read("alternativa-fluidz-demos.html");
  const match = html.match(/<style>([\s\S]*?)<\/style>/);
  assert.ok(match, "sem style da página");
  const style = match[1];
  assert.match(style, /\.page\s*\{[^}]*min-width:\s*0/);
  assert.match(style, /\.page\s*\{[^}]*width:\s*100%/);
  assert.match(style, /\.page\s*\{[^}]*overflow-wrap:\s*anywhere/);
  assert.match(style, /\.page\s+\.table-wrap\s*\{[^}]*overflow-x:\s*auto/);
  assert.match(style, /\.page\s+\.table-wrap\s*\{[^}]*min-width:\s*0/);
  assert.match(style, /@media \(max-width:\s*640px\)/);
  assert.match(style, /\.page table, \.page tbody, \.page tr, \.page th, \.page td \{ display: block;/);
});

test("/alternativa-fluidz-demos está no sitemap (sem hreflang) e no llms.txt", () => {
  const xml = read("sitemap.xml");
  const block = xml.split("<loc>https://guiaflow.pro/alternativa-fluidz-demos</loc>")[1]?.split("</url>")[0];
  assert.ok(block, "fora do sitemap");
  assert.match(block, /<lastmod>2026-11-17<\/lastmod>/);
  assert.equal(block.includes("hreflang"), false);
  assert.match(read("llms.txt"), /https:\/\/guiaflow\.pro\/alternativa-fluidz-demos/);
});
