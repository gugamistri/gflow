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
  assert.match(text, /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
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

test("editor em /editor: canônico próprio e fora do índice", () => {
  const editor = read("editor.html");
  assert.match(editor, /<link rel="canonical" href="https:\/\/guiaflow\.pro\/editor"/);
  assert.match(editor, /<meta name="robots" content="noindex, follow"/);
  assert.match(editor, /<meta property="og:url" content="https:\/\/guiaflow\.pro\/editor"/);
  const sitemap = read("sitemap.xml");
  assert.equal(sitemap.includes("/editor"), false);
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
    assert.match(html, /Última atualização: 1[123] de outubro de 2026/);
    assert.match(html, /href="\/privacidade"/);
    assert.match(html, /href="\/termos"/);
    assert.match(html, /a\/106\/css\/ajuda\.css/);
    assert.equal(/nuvem/i.test(html), false);
    assert.equal(html.includes("{{"), false);
    assert.match(html, /mailto:contato@guiaflow\.pro/);
  }
  const ajuda = read("ajuda.html");
  assert.match(ajuda, /href="\/privacidade"/);
  assert.match(ajuda, /href="\/termos"/);
  const editor = read("editor.html");
  assert.match(editor, /data-i18n-html="billing.legal"/);
});

test("/oembed é uma rota pública (rewrite para a função, fora de /api/ no robots)", () => {
  const config = JSON.parse(read("vercel.json"));
  const rule = (config.rewrites || []).find((entry) => entry.source === "/oembed");
  assert.equal(rule?.destination, "/api/oembed");
  const robots = read("robots.txt");
  assert.equal(/^Disallow:\s*\/oembed/m.test(robots), false);
  const shell = read("api/lib/view-shell.cjs");
  assert.match(shell, /application\/json\+oembed/);
  assert.match(shell, /rel="iframely app"/);
});

test("/ajuda/api e llms.txt documentam o MCP com caminhos absolutos", () => {
  const html = read("ajuda/api.html");
  assert.match(html, /<link rel="canonical" href="https:\/\/guiaflow\.pro\/ajuda\/api"/);
  assert.match(html, /<meta name="description" content="API REST e servidor MCP do GuiaFlow[^"]+"/);
  assert.equal(/(href|src)="a\//.test(html), false, "caminhos relativos quebram em /ajuda/api");
  // um idioma por URL: só o PT aqui (um H1); en/es vêm de locale-src/ nas páginas localizadas
  assert.equal((html.match(/<h1\b/g) || []).length, 1);
  assert.equal(/data-doc-locale="(es|en)"/.test(html), false);
  assert.match(html, /https:\/\/app\.guiaflow\.pro\/mcp/);
  assert.match(read("sitemap.xml"), /<loc>https:\/\/guiaflow\.pro\/ajuda\/api<\/loc>/);
  const llms = read("llms.txt");
  assert.match(llms, /^# GuiaFlow$/m);
  assert.match(llms, /https:\/\/app\.guiaflow\.pro\/mcp/);
  assert.match(llms, /https:\/\/app\.guiaflow\.pro\/v1\/openapi\.json/);
});

test("/integracoes tem deeplinks do Cursor e VS Code, três línguas e caminhos absolutos", () => {
  const html = read("integracoes.html");
  assert.match(html, /cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?name=guiaflow&amp;config=eyJ1cmwiOiJodHRwczovL2FwcC5ndWlhZmxvdy5wcm8vbWNwIn0=/);
  assert.match(html, /vscode:mcp\/install\?/);
  assert.match(html, /claude mcp add --transport http guiaflow https:\/\/app\.guiaflow\.pro\/mcp/);
  // um idioma por URL: só o PT aqui (um H1); en/es vêm de locale-src/ nas páginas localizadas
  assert.equal((html.match(/<h1\b/g) || []).length, 1);
  assert.equal(/data-doc-locale="(es|en)"/.test(html), false);
  assert.equal(/(href|src)="a\//.test(html), false);
  assert.match(html, /a\/106\/css\/ajuda\.css/);
  assert.match(read("sitemap.xml"), /guiaflow\.pro\/integracoes/);
  assert.match(read("index.html"), /href="\/integracoes"/);
});

test("slugs localizados: um H1 por página, links finais e 301 dos slugs antigos", async () => {
  const { PAGES, localeFile, localePath, legacyRedirects } = await import("./build-locale-pages.mjs");
  const vercel = JSON.parse(read("vercel.json"));
  for (const r of legacyRedirects()) {
    assert.ok(vercel.redirects.some((v) => v.source === r.source && v.destination === r.destination && v.permanent), r.source);
  }
  assert.equal(localePath(PAGES.find((p) => p.path === "/integracoes"), "es"), "/es/integraciones");
  for (const page of PAGES) for (const loc of ["pt", "en", "es"]) {
    const html = read(localeFile(page, loc));
    assert.equal((html.match(/<h1\b/g) || []).length, 1, localeFile(page, loc));
    assert.equal(/href="\/(en|es)\/(ajuda|integracoes|privacidade|termos)\b/.test(html), false, localeFile(page, loc));
  }
});

test("páginas de texto liberam a rolagem que o app.css trava (overflow do body)", () => {
  const css = read("css/ajuda.css");
  assert.match(css, /body \{\s*overflow: visible;/);
  assert.match(css, /height: auto;/);
});

test("páginas /en e /es: geradas, atualizadas e com canonical/hreflang recíprocos", async () => {
  const { buildAll, PAGES, LOCALES, localePath, localeFile, absUrl } = await import("./build-locale-pages.mjs");
  const files = buildAll();
  for (const [file, content] of Object.entries(files)) {
    assert.equal(read(file), content, `${file} desatualizado: rode npm run build:locales`);
  }
  const lang = { pt: "pt-BR", en: "en", es: "es" };
  for (const page of PAGES) {
    const expected = LOCALES.map((l) => `hreflang="${lang[l]}" href="${absUrl(localePath(page, l))}"`);
    for (const loc of LOCALES) {
      const html = files[localeFile(page, loc)];
      assert.match(html, new RegExp(`<html lang="${lang[loc]}"`));
      assert.ok(html.includes(`<link rel="canonical" href="${absUrl(localePath(page, loc))}" />`), `${loc} ${page.path} canonical`);
      for (const alt of expected) assert.ok(html.includes(alt), `${loc} ${page.path} ${alt}`);
      assert.ok(html.includes(`hreflang="x-default" href="${absUrl(localePath(page, "pt"))}"`));
      assert.ok(html.includes(`<meta property="og:url" content="${absUrl(localePath(page, loc))}" />`));
      // sem barra final (trailingSlash: false) e sem caminho relativo que quebre em /en/…
      assert.equal(/href="https:\/\/guiaflow\.pro\/[^"]+\/"/.test(html), false);
      if (loc !== "pt") assert.equal(/\b(href|src)="(?:\.\/)?a\//.test(html), false);
      assert.ok(read("sitemap.xml").includes(`<loc>${absUrl(localePath(page, loc))}</loc>`));
    }
  }
  const vercel = JSON.parse(read("vercel.json"));
  assert.equal(vercel.cleanUrls, true);
  assert.equal(vercel.trailingSlash, false);
});
