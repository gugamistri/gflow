import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PAYWALL_PRICES, paywallOffer } from "../js/paywall.js";
import { landingCatalogs } from "../js/landing-i18n.js";

const root = new URL("../", import.meta.url);
const read = (name) => readFileSync(new URL(name, root), "utf8");
const landing = read("index.html");

function lpKeys(html) {
  return [...html.matchAll(/data-i18n(?:-html|-aria|-placeholder|-title)?="(lp\.[^"]+)"/g)].map((m) => m[1]);
}

test("landing: redirecionamento para /editor roda antes de qualquer CSS", () => {
  const head = landing.slice(0, landing.indexOf("</head>"));
  const script = head.indexOf('l.replace("/editor" + l.search + l.hash)');
  assert.ok(script > 0, "script de redirecionamento no <head>");
  assert.ok(script < head.indexOf("<link rel=\"stylesheet\""), "antes da folha de estilo");
  assert.match(head, /q\.get\("landing"\) === "1"/);
  assert.match(head, /demo-studio-index-v2/);
  assert.match(head, /data-guia-extension/);
});

test("landing: SEO, canônico na raiz e og:image própria", () => {
  assert.match(landing, /<link rel="canonical" href="https:\/\/guiaflow\.pro\/"/);
  assert.match(landing, /<meta property="og:image" content="https:\/\/guiaflow\.pro\/brand\/og-landing-v2\.png"/);
  assert.match(landing, /<meta name="twitter:card" content="summary_large_image"/);
  assert.equal(/noindex/.test(landing), false);
  const png = readFileSync(new URL("brand/og-landing-v2.png", root));
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
});

test("landing: preço no HTML é o mesmo de paywall.js", () => {
  const brl = PAYWALL_PRICES.brl;
  assert.match(landing, new RegExp(`data-price="month">R\\$${brl.month}<`));
  assert.match(landing, new RegExp(`data-price="year">R\\$${brl.year}<`));
  const offer = paywallOffer("brl");
  assert.match(landing, new RegExp(`data-free-months="1">${offer.freeMonths} meses grátis<`));
  assert.match(landing, new RegExp(`"price": "${brl.month}"`));
  assert.match(landing, new RegExp(`"price": "${brl.year}"`));
});

test("landing: sem 'nuvem', sem trial nem cupom, Pro com coroa", () => {
  assert.equal(/nuvem/i.test(landing), false);
  assert.equal(/trial|cupom|coupon/i.test(landing), false);
  assert.match(landing, /GuiaFlow Pro/);
  assert.match(landing, /Pro 👑/);
  assert.match(landing, /href="\/editor"[^>]*>Abrir editor</);
  for (const href of ["/ajuda", "/privacidade", "/termos", "https://github.com/gugamistri/gflow", "mailto:contato@guiaflow.pro"]) {
    assert.ok(landing.includes(`href="${href}"`), href);
  }
});

test("landing: es e en cobrem todas as chaves do HTML", () => {
  const keys = new Set(lpKeys(landing));
  for (const loc of ["es", "en"]) {
    for (const key of keys) assert.equal(typeof landingCatalogs[loc][key], "string", `${loc} ${key}`);
    for (const key of Object.keys(landingCatalogs.pt)) assert.equal(typeof landingCatalogs[loc][key], "string", `${loc} ${key}`);
  }
  for (const value of Object.values(landingCatalogs.pt)) assert.equal(/nuvem/i.test(value), false);
});

test("deep links seguem: /v, /p, /oembed, auth e os rodapés apontam para /editor", () => {
  const config = JSON.parse(read("vercel.json"));
  const rewrites = Object.fromEntries((config.rewrites || []).map((r) => [r.source, r.destination]));
  assert.equal(rewrites["/v/:id"], "/api/v/:id");
  assert.equal(rewrites["/p/:slug"], "/api/p/:slug");
  assert.equal(rewrites["/oembed"], "/api/oembed");
  for (const file of ["ajuda.html", "privacidade.html", "termos.html"]) {
    assert.match(read(file), /<a href="\/editor">Editor<\/a>/, file);
  }
  assert.match(read("electron/main.js"), /loadFile\(path\.join\(ROOT, "editor\.html"\)\)/);
  assert.ok(JSON.parse(read("package.json")).build.files.includes("editor.html"));
});

test("demo de exemplo: slug numa constante só (LeadPronto), sem o Demo RCV, placeholder quando vazio", async () => {
  const fs = await import("node:fs");
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const js = fs.readFileSync(new URL("../js/landing.js", import.meta.url), "utf8");
  assert.equal(/rcv/i.test(html) || /rcv/i.test(js), false, "landing sem Demo RCV");
  assert.equal(/<iframe/i.test(html), false, "o iframe nasce do LANDING_DEMO_SLUG em landing.js");
  assert.match(html, /id="demo-placeholder"/);
  assert.equal((js.match(/export const LANDING_DEMO_SLUG = /g) || []).length, 1);
  const { landingDemoUrl } = await import("../js/landing.js");
  assert.match(js, /export const LANDING_DEMO_SLUG = "leadpronto-9e0052";/);
  assert.match(html, /\/a\/\d+\/brand\/hero-galeria\.webp" width="1200" height="787"/);
  assert.match(html, /\/a\/\d+\/brand\/hero-guia\.webp" width="800" height="500"/);
  assert.equal(/hero-leadpronto|lp\.mock\.toast/.test(html), false, "hero sem a captura do LeadPronto nem o aviso de lead");
  assert.equal(landingDemoUrl(""), "");
  assert.equal(landingDemoUrl("../x"), "");
  assert.equal(landingDemoUrl("javascript:alert(1)"), "");
  assert.equal(landingDemoUrl("leadpronto-abc123"), "https://guiaflow.pro/p/leadpronto-abc123?embed=1");
});

test("landing: posicionamento galeria + guia e o assistente nas três línguas", () => {
  const pages = { pt: landing, en: read("en.html"), es: read("es.html") };
  const hero = {
    pt: /Uma demo vale mais que mil reuniões\./,
    en: /One demo is worth a thousand meetings\./,
    es: /Una demo vale más que mil reuniones\./,
  };
  const sub = {
    pt: /Seu cliente não quer mais uma reunião\. Ele quer ver o produto\./,
    en: /Your customer doesn't want another meeting\. They want to see the product\./,
    es: /Tu cliente no quiere otra reunión\. Quiere ver el producto\./,
  };
  for (const [loc, html] of Object.entries(pages)) {
    const h1 = html.match(/<h1[^>]*>([^<]*)<\/h1>/)?.[1] || "";
    assert.match(h1, hero[loc], `${loc}: H1`);
    const heroSub = html.match(/class="hero-sub"[^>]*>([^<]*)</)?.[1] || "";
    assert.match(heroSub, sub[loc], `${loc}: subtítulo`);
    assert.match(html, /id="dois-caminhos"/, `${loc}: seção dois caminhos`);
    assert.match(html, /id="usos"/, `${loc}: seção usos`);
    assert.match(html, /href="https:\/\/guiaflow\.pro\/p\/[a-z0-9-]+(?:\?lang=(?:en|es))?" data-gallery-example/, `${loc}: CTA da galeria de exemplo`);
    for (const n of [10, 11, 12]) assert.match(html, new RegExp(`data-i18n="lp\\.faq\\.q${n}"`), `${loc}: FAQ ${n}`);
    assert.match(html, /id="criar-com-ajuda"/, `${loc}: card do assistente`);
    assert.match(html, /href="\/editor\?novo=ajuda"/, `${loc}: CTA do assistente`);
    assert.match(html, /data-i18n="lp\.faq\.q13"/, `${loc}: FAQ do assistente`);
    assert.equal(/do-demo-ao-lead/.test(html), false, `${loc}: seção antiga removida`);
  }
});

test("landing: assistente grátis; IA com a chave do usuário ou a IA do GuiaFlow no Pro, nas três línguas", () => {
  const body = { pt: /grátis[^<]*própria chave[^<]*Pro/i, en: /free[^<]*own key[^<]*Pro/i, es: /gratis[^<]*propia clave[^<]*Pro/i };
  const pages = { pt: landing, en: read("en.html"), es: read("es.html") };
  for (const [loc, html] of Object.entries(pages)) {
    const card = html.match(/data-i18n="lp\.assist\.body">([^<]*)</)?.[1] || "";
    assert.match(card, body[loc], `${loc}: texto do card`);
  }
  const help = { pt: read("ajuda.html"), en: read("en/help.html"), es: read("es/ayuda.html") };
  for (const [loc, html] of Object.entries(help)) assert.match(html, /id="criar-com-ajuda"/, `${loc}: ajuda`);
});

test("landing: og:image por idioma em 1200x630", () => {
  for (const [file, png] of [["en.html", "og-landing-en.png"], ["es.html", "og-landing-es.png"]]) {
    assert.match(read(file), new RegExp(`<meta property="og:image" content="https://guiaflow\\.pro/brand/${png.replace(".", "\\.")}"`));
    const buf = readFileSync(new URL(`brand/${png}`, root));
    assert.equal(buf.readUInt32BE(16), 1200);
    assert.equal(buf.readUInt32BE(20), 630);
  }
});

test("landing: card Galeria abre a galeria de exemplo publicada", async () => {
  const { landingGalleryHref, LANDING_GALLERY_SLUG } = await import("../js/landing.js");
  assert.equal(LANDING_GALLERY_SLUG, "exemplo-colchao-galeria-de-produto-844901", "galeria de exemplo publicada");
  assert.equal(landingGalleryHref(""), "");
  assert.equal(landingGalleryHref("colchoes-exemplo-1a2b"), "https://guiaflow.pro/p/colchoes-exemplo-1a2b");
  assert.equal(landingGalleryHref("colchoes-exemplo-1a2b", "https://guiaflow.pro", "pt"), "https://guiaflow.pro/p/colchoes-exemplo-1a2b");
  assert.equal(landingGalleryHref("colchoes-exemplo-1a2b", "https://guiaflow.pro", "en"), "https://guiaflow.pro/p/colchoes-exemplo-1a2b?lang=en");
  assert.equal(landingGalleryHref("colchoes-exemplo-1a2b", "https://guiaflow.pro", "es"), "https://guiaflow.pro/p/colchoes-exemplo-1a2b?lang=es");
  assert.equal(landingGalleryHref("colchoes-exemplo-1a2b", "https://guiaflow.pro", "en-US"), "https://guiaflow.pro/p/colchoes-exemplo-1a2b?lang=en");
  assert.equal(landingGalleryHref("colchoes-exemplo-1a2b", "https://guiaflow.pro", "fr"), "https://guiaflow.pro/p/colchoes-exemplo-1a2b");
  assert.equal(landingGalleryHref("../x"), "");
  for (const [loc, html, label, query] of [
    ["pt", landing, "Ver galeria", ""],
    ["en", read("en.html"), "See a gallery", "\\?lang=en"],
    ["es", read("es.html"), "Ver una galería", "\\?lang=es"],
  ]) {
    assert.match(html, new RegExp(`href="https://guiaflow\\.pro/p/${LANDING_GALLERY_SLUG}${query}" data-gallery-example data-i18n="lp\\.paths\\.gallery\\.view">${label}</a>`), `${loc}: botão Ver galeria`);
  }
});

test("landing: sem selo do Product Hunt no hero (pt/en/es)", () => {
  for (const [loc, html] of [["pt", landing], ["en", read("en.html")], ["es", read("es.html")]]) {
    assert.equal(/class="hero-ph"|api\.producthunt\.com\/widgets/.test(html), false, `${loc}: selo removido`);
  }
});
