import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);

function read(name) {
  return readFileSync(new URL(name, root), "utf8");
}

test("robots permite o site, bloqueia rotas internas e aponta o sitemap", () => {
  const text = read("robots.txt");
  assert.match(text, /^User-agent: \*$/m);
  assert.match(text, /^Allow: \/$/m);
  assert.match(text, /^Disallow: \/api\/$/m);
  assert.match(text, /^Disallow: \/auth\/$/m);
  assert.match(text, /^Disallow: \/view$/m);
  assert.match(text, /^Sitemap: https:\/\/guiaflow\.pro\/sitemap\.xml$/m);
  assert.equal(/Disallow:\s*\/v(\/|$)/m.test(text), false);
  assert.equal(/nuvem/i.test(text), false);
});

test("sitemap lista só as páginas públicas estáticas", () => {
  const text = read("sitemap.xml");
  assert.match(text, /<loc>https:\/\/guiaflow\.pro\/<\/loc>/);
  assert.match(text, /<loc>https:\/\/guiaflow\.pro\/ajuda<\/loc>/);
  assert.match(text, /<loc>https:\/\/guiaflow\.pro\/privacidade<\/loc>/);
  assert.match(text, /<loc>https:\/\/guiaflow\.pro\/termos<\/loc>/);
  assert.match(text, /<lastmod>2026-10-09<\/lastmod>/);
  assert.equal(text.includes(".html"), false);
  assert.equal(text.includes("/view"), false);
  assert.equal(text.includes("/api/"), false);
  assert.equal(/nuvem/i.test(text), false);
});

test("a Vercel entrega robots e sitemap com o tipo certo e sem rewrite", () => {
  const config = JSON.parse(read("vercel.json"));
  const headers = config.headers || [];
  const robots = headers.find((entry) => entry.source === "/robots.txt");
  const sitemap = headers.find((entry) => entry.source === "/sitemap.xml");
  assert.equal(
    robots?.headers?.find((item) => item.key === "Content-Type")?.value,
    "text/plain; charset=utf-8"
  );
  assert.equal(
    sitemap?.headers?.find((item) => item.key === "Content-Type")?.value,
    "application/xml; charset=utf-8"
  );
  for (const rule of config.rewrites || []) {
    assert.notEqual(rule.source, "/robots.txt");
    assert.notEqual(rule.source, "/sitemap.xml");
    assert.equal(rule.source === "/:path*" || rule.source === "/(.*)", false);
  }
});

test("home e ajuda têm título, descrição, canônico e Open Graph", () => {
  const home = read("index.html");
  assert.match(home, /<title[^>]*>[^<]*GuiaFlow[^<]*<\/title>/);
  assert.match(home, /<meta name="description" content="[^"]+"/);
  assert.match(home, /<link rel="canonical" href="https:\/\/guiaflow\.pro\/"/);
  assert.match(home, /<meta property="og:title" content="[^"]+"/);
  assert.match(home, /<meta property="og:description" content="[^"]+"/);
  assert.match(home, /<meta property="og:url" content="https:\/\/guiaflow\.pro\/"/);
  assert.equal(/nuvem/i.test(home.slice(0, home.indexOf("</head>"))), false);

  const ajuda = read("ajuda.html");
  assert.match(ajuda, /<title[^>]*>[^<]*GuiaFlow[^<]*<\/title>/);
  assert.match(ajuda, /<meta name="description" content="Como gravar um demo no GuiaFlow:[^"]+"/);
  assert.match(ajuda, /<link rel="canonical" href="https:\/\/guiaflow\.pro\/ajuda"/);
  assert.match(ajuda, /<meta property="og:title" content="Como usar — GuiaFlow"/);
  assert.match(ajuda, /<meta property="og:description" content="Como gravar um demo no GuiaFlow:[^"]+"/);
  assert.match(ajuda, /<meta property="og:url" content="https:\/\/guiaflow\.pro\/ajuda"/);
  assert.equal(/nuvem/i.test(ajuda.slice(0, ajuda.indexOf("</head>"))), false);
  assert.equal(ajuda.includes("ajuda.html"), false);
});

test("privacidade e termos têm metadados, data, rodapé e não falam em nuvem", () => {
  for (const [file, slug, title, key] of [
    ["privacidade.html", "privacidade", "Política de Privacidade", "privacy"],
    ["termos.html", "termos", "Termos de Uso", "terms"],
  ]) {
    const html = read(file);
    assert.match(html, new RegExp(`<title data-i18n="doc\\.title\\.${key}">${title} — GuiaFlow</title>`));
    assert.match(html, /<meta name="description" content="[^"]+"/);
    assert.match(html, new RegExp(`<link rel="canonical" href="https://guiaflow\\.pro/${slug}"`));
    assert.match(html, new RegExp(`<meta property="og:url" content="https://guiaflow\\.pro/${slug}"`));
    assert.match(html, /data-appearance="social"/);
    assert.match(html, /Última atualização: 10 de outubro de 2026/);
    assert.match(html, /href="\/privacidade"/);
    assert.match(html, /href="\/termos"/);
    assert.match(html, /a\/41\/css\/ajuda\.css/);
    assert.equal(/nuvem/i.test(html), false);
    assert.equal(html.includes("{{"), false);
    assert.match(html, /mailto:contato@guiaflow\.pro/);
  }
  const ajuda = read("ajuda.html");
  assert.match(ajuda, /href="\/privacidade"/);
  assert.match(ajuda, /href="\/termos"/);
  const home = read("index.html");
  assert.match(home, /data-i18n-html="billing.legal"/);
});
