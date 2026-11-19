import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ASSET_PREFIX_RE } from "./asset-version.mjs";
import { EXTRA_PAGES } from "./build-locale-pages.mjs";

const root = new URL("../", import.meta.url);
const read = (name) => readFileSync(new URL(name, root), "utf8");

const TITLE = "Open-source interactive demo software (MIT, no sign-up) | GuiaFlow";
const H1 = "Open-source interactive demos, free in your browser";
const CANONICAL = "https://guiaflow.pro/en/open-source-interactive-demo";
const unesc = (s) => s.replaceAll("&quot;", '"').replaceAll("&#x27;", "'").replaceAll("&amp;", "&");

test("/en/open-source-interactive-demo: English only, own canonical, self-referencing hreflang, versioned assets, CTAs", () => {
  const html = read("en/open-source-interactive-demo.html");
  assert.match(html, /<html lang="en">/);
  assert.ok(html.includes(`<title>${TITLE}</title>`));
  assert.ok(html.includes(`<h1>${H1}</h1>`));
  assert.ok(html.includes(`<link rel="canonical" href="${CANONICAL}" />`));
  assert.ok(html.includes(`<link rel="alternate" hreflang="en" href="${CANONICAL}" />`));
  assert.equal(/hreflang="(pt-BR|es)"/.test(html), false, "no PT/ES alternate yet");
  assert.equal(/hreflang="x-default"/.test(html), false, "no x-default until a PT pair exists");
  for (const css of ["theme", "shell", "ajuda"]) assert.match(html, new RegExp(`${ASSET_PREFIX_RE}css\\/${css}\\.css`));
  assert.match(html, new RegExp(`<script type="module" src="\\/${ASSET_PREFIX_RE}js\\/landingAnalytics\\.js"><\\/script>`));
  assert.match(html, /href="\/editor">Open the editor</);
  assert.match(html, /href="https:\/\/guiaflow\.pro\/editor\?pro=1">Subscribe to Pro — US\$ 7\/month or US\$ 69\/year</);
  assert.match(html, /href="https:\/\/github.com\/gugamistri\/gflow"/);
  assert.match(html, /Star on GitHub/);
  assert.match(html, /href="https:\/\/guiaflow\.pro\/exemplos\/guia\?lang=en"/);
  assert.match(html, /href="https:\/\/guiaflow\.pro\/exemplos\/galeria\?lang=en"/);
  assert.match(html, /src="\/exemplos\/guia\?lang=en&amp;embed=1"/);
  assert.match(html, /href="\/en\/help\/api"/);
  assert.match(html, /href="\/en\/integrations"/);
  assert.match(html, /npm start/);
  assert.match(html, /export a single HTML file and host it/);
  assert.equal(/self-hosted|self-hostable/i.test(html), false);
  assert.equal(/desktop app|Electron/i.test(html), false);
});

test("/en/open-source-interactive-demo: copy avoids banned words; competitor sources dated 19/11/2026", () => {
  const html = read("en/open-source-interactive-demo.html");
  assert.equal(/plataforma|intelig[eê]ncia|ecossistema|potencializ|platform|intelligence|ecosystem|empower|leverage/i.test(html), false);
  assert.equal(/nstech|Plano&amp;Plano|Plano&Plano/i.test(html), false);
  assert.match(html, /checked on 19\/11\/2026/);
  for (const u of [
    "https://www.arcade.software/pricing-interactive-demos",
    "https://supademo.com/pricing",
    "https://www.storylane.io/pricing",
    "https://demo-maker.dplooy.com/",
  ]) {
    assert.ok(html.includes(`<a href="${u}" rel="nofollow noopener" target="_blank">`), u);
  }
  const fontes = html.match(/<p class="sources" id="sources">[\s\S]*?<\/p>/)[0];
  assert.ok(fontes);
  assert.equal(/guiaflow\.pro|github\.com\/gugamistri/i.test(fontes), false);
  for (const m of fontes.matchAll(/<a\b[^>]*>/g)) {
    assert.match(m[0], /\brel="nofollow noopener"/);
  }
  assert.match(html, /MIT/);
  assert.match(read("LICENSE"), /^MIT License/m);
});

test("/en/open-source-interactive-demo: JSON-LD WebPage + BreadcrumbList + FAQPage + SoftwareSourceCode, FAQ matches visible copy", () => {
  const html = read("en/open-source-interactive-demo.html");
  const data = JSON.parse(html.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/)[1]);
  assert.deepEqual(data["@graph"].map((n) => n["@type"]), ["WebPage", "BreadcrumbList", "FAQPage", "SoftwareSourceCode"]);
  assert.equal(data["@graph"][0].name, TITLE);
  assert.equal(data["@graph"][0].url, CANONICAL);
  assert.equal(data["@graph"][0].inLanguage, "en");
  const visible = unesc(html);
  const faq = data["@graph"][2].mainEntity;
  assert.equal(faq.length, 6);
  for (const q of faq) {
    assert.ok(visible.includes(`<h3>${q.name}</h3>`), q.name);
    assert.ok(visible.includes(`<p>${q.acceptedAnswer.text}</p>`), q.name);
  }
  const source = data["@graph"][3];
  assert.equal(source.codeRepository, "https://github.com/gugamistri/gflow");
  assert.equal(source.license, "https://opensource.org/licenses/MIT");
  assert.equal(source.programmingLanguage, "JavaScript");
  assert.equal(/"@type":"(Review|AggregateRating|Product|Offer)"/.test(JSON.stringify(data)), false);
});

test("/en/open-source-interactive-demo is in the sitemap (EXTRA_PAGES, no hreflang pair) and in /en footers", () => {
  assert.ok(EXTRA_PAGES.some((p) => p.path === "/en/open-source-interactive-demo" && p.lastmod === "2026-11-19"));
  const xml = read("sitemap.xml");
  const block = xml.split("<loc>https://guiaflow.pro/en/open-source-interactive-demo</loc>")[1]?.split("</url>")[0];
  assert.ok(block, "missing from sitemap");
  assert.match(block, /<lastmod>2026-11-19<\/lastmod>/);
  assert.equal(block.includes("hreflang"), false, "EN-only EXTRA_PAGES entry has no hreflang pair");
  for (const file of ["en.html", "en/help.html", "en/integrations.html", "en/privacy.html", "en/terms.html"]) {
    assert.match(read(file), /href="\/en\/open-source-interactive-demo">Open source \(MIT\)</, file);
  }
  assert.equal(read("index.html").includes("/en/open-source-interactive-demo"), false, "not on PT home footer");
  assert.equal(read("es.html").includes("/en/open-source-interactive-demo"), false, "not on ES home footer");
});
