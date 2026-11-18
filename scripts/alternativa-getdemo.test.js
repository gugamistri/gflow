import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ASSET_PREFIX, ASSET_PREFIX_RE } from "./asset-version.mjs";

const root = new URL("../", import.meta.url);
const read = (name) => readFileSync(new URL(name, root), "utf8");

const TITLE = "Alternativa à Getdemo: GuiaFlow, grátis e com preço público";
const META =
  "A Getdemo não tem plano grátis nem preço público. O GuiaFlow tem editor gratuito, sem conta e sem cartão, e Pro a R$ 36/mês. Veja onde cada uma vai além.";
const H1 = "Alternativa à Getdemo: GuiaFlow vs Getdemo, lado a lado";
const CANONICAL = "https://guiaflow.pro/alternativa-getdemo";

test("/alternativa-getdemo existe, com canonical, hreflang só pt-BR e assets versionados", () => {
  const html = read("alternativa-getdemo.html");
  assert.equal(html.includes(`<title>${TITLE}</title>`), true);
  assert.equal(html.includes(`<meta name="description" content="${META}" />`), true);
  assert.equal(html.includes(`<h1>${H1}</h1>`), true);
  assert.equal(html.includes(`<link rel="canonical" href="${CANONICAL}" />`), true);
  assert.equal(html.includes(`<link rel="alternate" hreflang="pt-BR" href="${CANONICAL}" />`), true);
  assert.equal(html.includes(`<link rel="alternate" hreflang="x-default" href="${CANONICAL}" />`), true);
  assert.equal(/<link rel="alternate" hreflang="en"/.test(html), false);
  assert.equal(/<link rel="alternate" hreflang="es"/.test(html), false);
  assert.match(html, /<html lang="pt-BR">/);
  assert.match(html, new RegExp(`${ASSET_PREFIX_RE}css\\/theme\\.css`));
  assert.match(html, new RegExp(`${ASSET_PREFIX_RE}css\\/shell\\.css`));
  assert.match(html, new RegExp(`${ASSET_PREFIX_RE}css\\/ajuda\\.css`));
  assert.equal(ASSET_PREFIX, "a/221/");
  assert.match(html, /href="\/editor"/);
  assert.match(html, /href="https:\/\/guiaflow\.pro\/editor\?pro=1"/);
  assert.match(html, /href="https:\/\/guiaflow\.pro\/exemplos\/guia"/);
  assert.match(html, /href="https:\/\/guiaflow\.pro\/exemplos\/galeria"/);
  assert.match(html, /src="\/exemplos\/guia\?embed=1"/);
  assert.match(html, /href="\/#precos"/);
  assert.match(html, /href="\/ajuda"/);
  assert.match(html, /href="\/integracoes"/);
});

test("/alternativa-getdemo está no sitemap, só em pt-BR", () => {
  const text = read("sitemap.xml");
  assert.match(text, /<loc>https:\/\/guiaflow\.pro\/alternativa-getdemo<\/loc>/);
  const after = text.split("<loc>https://guiaflow.pro/alternativa-getdemo</loc>")[1].split("</url>")[0];
  assert.match(after, /<lastmod>2026-11-15<\/lastmod>/);
  assert.equal(after.includes("hreflang"), false);
});

test("/alternativa-getdemo: JSON-LD WebPage, BreadcrumbList e FAQPage válido, com 9 perguntas", () => {
  const html = read("alternativa-getdemo.html");
  const match = html.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/);
  assert.ok(match, "sem JSON-LD");
  const data = JSON.parse(match[1]);
  assert.equal(data["@context"], "https://schema.org");
  const graph = data["@graph"];
  assert.ok(Array.isArray(graph));
  assert.deepEqual(graph.map((n) => n["@type"]), ["WebPage", "BreadcrumbList", "FAQPage"]);
  const page = graph[0];
  assert.equal(page.name, TITLE);
  assert.equal(page.description, META);
  assert.equal(page.inLanguage, "pt-BR");
  assert.equal(page.datePublished, "2026-11-15");
  assert.equal(page.dateModified, "2026-11-15");
  const faq = graph[2];
  assert.equal(faq.mainEntity.length, 9);
  for (const item of faq.mainEntity) {
    assert.equal(item["@type"], "Question");
    assert.equal(item.acceptedAnswer["@type"], "Answer");
    assert.ok(html.includes(item.name), `pergunta visível ausente: ${item.name}`);
    const visible = html.includes(item.acceptedAnswer.text) || html.includes(item.acceptedAnswer.text.replaceAll('"', "&quot;"));
    assert.ok(visible, `resposta visível ausente: ${item.name}`);
  }
  const dump = JSON.stringify(data);
  assert.equal(/"@type":"Product"/.test(dump), false);
  assert.equal(/"@type":"Offer"/.test(dump), false);
  assert.equal(/"@type":"SoftwareApplication"/.test(dump), false);
  assert.equal(/"@type":"AggregateRating"/.test(dump), false);
  assert.equal(/"@type":"Review"/.test(dump), false);
});

test("/alternativa-getdemo: fontes discretas só de concorrentes, com data e nofollow", () => {
  const html = read("alternativa-getdemo.html");
  assert.match(html, /Dados de concorrentes conferidos em 15\/11\/2026/);
  assert.equal(/<h2>Fontes<\/h2>|GuiaFlow, consultado na mesma data/.test(html), false);
  const fontes = html.match(/<p class="sources" id="fontes">[\s\S]*?<\/p>/)[0];
  assert.ok(fontes);
  assert.equal(/guiaflow\.pro|github\.com\/gugamistri/i.test(fontes), false);
  for (const u of [
    "https://www.getdemo.com.br/planos",
    "https://www.getdemo.com.br/solucoes/demos-interativas",
    "https://www.getdemo.com.br/solucoes/onboarding-guiado",
    "https://www.getdemo.com.br/solucoes/saas-copilot",
    "https://www.getdemo.com.br/solucoes/demoagent",
    "https://www.getdemo.com.br/integracoes",
    "https://www.getdemo.com.br/terms-of-service",
    "https://pt.linkedin.com/posts/getdemo_blacknovember-blackfriday-saas-activity-7524569218781130752-5zQk",
  ]) {
    assert.ok(html.includes(`<a href="${u}" rel="nofollow noopener" target="_blank">`), u);
  }
  for (const m of fontes.matchAll(/<a\b[^>]*>/g)) {
    assert.match(m[0], /\brel="nofollow noopener"/);
  }
});

test("promo Black November está marcada para remoção depois de 30/11/2026", () => {
  const html = read("alternativa-getdemo.html");
  const start = html.split("<!-- promo-black-november:start -->");
  assert.equal(start.length, 3, "dois blocos start (parágrafo + fonte)");
  assert.equal((html.match(/<!-- promo-black-november:end -->/g) || []).length, 2);
  assert.match(start[1], /mensalidade grátis e setup isento/);
  assert.match(start[2], /linkedin\.com\/posts\/getdemo_blacknovember/);
});

test("/alternativa-getdemo cabe na largura do mobile (CSS da página)", () => {
  const html = read("alternativa-getdemo.html");
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
  assert.equal((html.match(/<!-- promo-black-november:start -->/g) || []).length, 2);
});

test("rodapé PT da home aponta para /alternativa-getdemo no bloco Comparações", () => {
  const html = read("index.html");
  assert.match(html, /<nav aria-label="Comparações"[^>]*>/);
  assert.match(html, /href="\/alternativa-getdemo">Alternativa à Getdemo</);
  assert.equal(read("en.html").includes("/alternativa-getdemo"), false);
  assert.equal(read("es.html").includes("/alternativa-getdemo"), false);
});
