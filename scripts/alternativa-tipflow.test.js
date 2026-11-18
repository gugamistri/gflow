import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ASSET_PREFIX_RE } from "./asset-version.mjs";

const root = new URL("../", import.meta.url);
const read = (name) => readFileSync(new URL(name, root), "utf8");

const TITLE = "Alternativa ao Tipflow: GuiaFlow para tour por link, sem script no app";
const H1 = "Alternativa ao Tipflow: tour por link no GuiaFlow, tour dentro do app no Tipflow";
const CANONICAL = "https://guiaflow.pro/alternativa-tipflow";
const unesc = (s) => s.replaceAll("&quot;", '"').replaceAll("&#x27;", "'").replaceAll("&amp;", "&");

test("/alternativa-tipflow: só pt-BR, canonical próprio, assets versionados, CTAs e exemplos", () => {
  const html = read("alternativa-tipflow.html");
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
  assert.match(html, /href="\/tour-de-produto"/);
  assert.match(html, /href="\/alternativa-getdemo"/);
  assert.match(html, /href="\/alternativa-fluidz-demos"/);
  assert.equal(/href="\/(?:p|v)\//.test(html), false, "não cria links /p ou /v");
  assert.match(html, /não faz onboarding dentro do app/);
  assert.match(read("alternativa-getdemo.html"), /href="\/alternativa-tipflow"/);
  assert.match(read("alternativa-fluidz-demos.html"), /href="\/alternativa-tipflow"/);
  assert.match(read("tour-de-produto.html"), /href="\/alternativa-tipflow"/);
  assert.equal(read("index.html").includes("/alternativa-tipflow"), false);
  assert.equal(read("en.html").includes("/alternativa-tipflow"), false);
  assert.equal(read("es.html").includes("/alternativa-tipflow"), false);
  assert.equal(read("cortesia.html").includes("/alternativa-tipflow"), false);
});

test("/alternativa-tipflow: copy sem vocabulário vetado, Clientes com ressalva, concorrentes com fonte e data", () => {
  const html = read("alternativa-tipflow.html");
  assert.equal(/plataforma|intelig[eê]ncia|ecossistema|potencializ|platform|intelligence|ecosystem|empower/i.test(html), false);
  assert.equal(/nstech|Plano&amp;Plano|Plano&Plano/i.test(html), false);
  const clientes = html.split("área Clientes").slice(1);
  assert.ok(clientes.length >= 1);
  for (const after of clientes) assert.match(after.slice(0, 220), /Não é white-label/);
  assert.match(html, /verificadas em \d{2}\/\d{2}\/2026/);
  for (const u of [
    "https://tipflow.com.br/pt-br",
    "https://tipflow.com.br/pt-br/precos",
    "https://tipflow.com.br/pt-br/produto/walkthroughs",
    "https://tipflow.com.br/pt-br/termos",
  ]) {
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
  assert.match(html, /R\$ 149\/mês/);
  assert.match(html, /R\$ 349\/mês/);
  assert.match(html, /14 dias grátis no Pro/);
  assert.match(html, /68\.146\.063\/0001-94/);
});

test("/alternativa-tipflow: JSON-LD WebPage + BreadcrumbList + FAQPage, FAQ igual à visível", () => {
  const html = read("alternativa-tipflow.html");
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

test("/alternativa-tipflow cabe na largura do mobile (CSS da página)", () => {
  const html = read("alternativa-tipflow.html");
  const match = html.match(/<style>([\s\S]*?)<\/style>/);
  assert.ok(match, "sem style da página");
  const style = match[1];
  assert.match(style, /\.page\s*\{[^}]*min-width:\s*0/);
  assert.match(style, /\.page\s*\{[^}]*width:\s*100%/);
  assert.match(style, /\.page\s*\{[^}]*overflow-wrap:\s*anywhere/);
  assert.match(style, /\.page\s+\.table-wrap\s*\{[^}]*overflow-x:\s*auto/);
  assert.match(style, /@media \(max-width:\s*640px\)/);
  assert.match(style, /\.page table, \.page tbody, \.page tr, \.page th, \.page td \{ display: block;/);
});

test("/alternativa-tipflow está no sitemap (sem hreflang) e no llms.txt", () => {
  const xml = read("sitemap.xml");
  const block = xml.split("<loc>https://guiaflow.pro/alternativa-tipflow</loc>")[1]?.split("</url>")[0];
  assert.ok(block, "fora do sitemap");
  assert.match(block, /<lastmod>2026-11-17<\/lastmod>/);
  assert.equal(block.includes("hreflang"), false);
  assert.match(read("llms.txt"), /https:\/\/guiaflow\.pro\/alternativa-tipflow/);
});
