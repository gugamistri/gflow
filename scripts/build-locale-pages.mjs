#!/usr/bin/env node
/**
 * Páginas públicas em /en e /es, pré-renderizadas a partir dos catálogos de i18n.
 * why (SEO): cada idioma tem URL própria, 200 direto (sem redirect), <html lang>, title/meta/OG
 * no idioma, canonical para si mesma e hreflang recíproco (pt-BR, en, es, x-default = PT).
 * O português continua sendo a fonte (index.html, ajuda.html…); este script também grava nele
 * o bloco de alternates. Rode `npm run build:locales` depois de mexer nessas páginas ou nos textos;
 * scripts/seo.test.js falha se os arquivos gerados estiverem desatualizados.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { catalogs } from "../js/i18n.js";
import "../js/legal-i18n.js";
import { landingCatalogs } from "../js/landing-i18n.js";
import { formatPaywallAmount, paywallCurrency, paywallOffer } from "../js/paywall.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const ORIGIN = "https://guiaflow.pro";
export const LOCALES = ["pt", "en", "es"];
const HREFLANG = { pt: "pt-BR", en: "en", es: "es" };
const OG_LOCALE = { pt: "pt_BR", en: "en_US", es: "es_ES" };
const IMG_ALT = {
  en: "GuiaFlow — Create interactive guided tours",
  es: "GuiaFlow — Crea tours guiados interactivos",
};

for (const loc of ["es", "en"]) Object.assign(catalogs[loc], landingCatalogs[loc] || {});

/** Páginas públicas: caminho PT (sem barra final, exceto a raiz) e textos de <head> que não estão nos catálogos. */
export const PAGES = [
  {
    src: "index.html",
    path: "",
    lastmod: "2026-10-12",
    meta: {
      en: {
        description: "Turn screenshots of your product into an interactive, narrated demo in minutes. Send the link to a lead, put it on your site or in your pitch. Free in the browser.",
        ogDescription: "Turn screenshots of your product into an interactive, narrated demo in minutes. Send the link to a lead, put it on your site or in your pitch.",
      },
      es: {
        description: "Convierte capturas de tu producto en un demo interactivo y narrado en minutos. Envía el enlace al lead, ponlo en tu sitio o en tu pitch. Gratis en el navegador.",
        ogDescription: "Convierte capturas de tu producto en un demo interactivo y narrado en minutos. Envía el enlace al lead, ponlo en tu sitio o en tu pitch.",
      },
    },
    heroOg: true,
  },
  {
    src: "ajuda.html",
    path: "/ajuda",
    lastmod: "2026-10-12",
    meta: {
      en: { description: "How to record a demo in GuiaFlow: install the extension, capture the screens and build the tour with highlight, click and narration." },
      es: { description: "Cómo grabar un demo en GuiaFlow: instala la extensión, captura las pantallas y arma el tour con resaltado, clic y narración." },
    },
  },
  {
    src: "ajuda/api.html",
    path: "/ajuda/api",
    lastmod: "2026-10-12",
    meta: {
      en: { title: "API and MCP — GuiaFlow", description: "GuiaFlow REST API and MCP server: connect Cursor, Claude or ChatGPT to create and publish guided tours from screenshots." },
      es: { title: "API y MCP — GuiaFlow", description: "API REST y servidor MCP de GuiaFlow: conecta Cursor, Claude o ChatGPT para crear y publicar tours guiados a partir de capturas de pantalla." },
    },
  },
  {
    src: "integracoes.html",
    path: "/integracoes",
    lastmod: "2026-10-12",
    meta: {
      en: { title: "Integrations — GuiaFlow", description: "Connect GuiaFlow to Cursor, Claude Code, Claude.ai, ChatGPT and VS Code through the MCP server: one-click install and step-by-step guide." },
      es: { title: "Integraciones — GuiaFlow", description: "Conecta GuiaFlow a Cursor, Claude Code, Claude.ai, ChatGPT y VS Code mediante el servidor MCP: instalación en un clic y paso a paso." },
    },
  },
  {
    src: "privacidade.html",
    path: "/privacidade",
    lastmod: "2026-10-12",
    meta: {
      en: { description: "How GuiaFlow handles personal data: what stays in your browser, what we store in the Pro account, providers and your rights under the LGPD." },
      es: { description: "Cómo GuiaFlow trata los datos personales: lo que queda en tu navegador, lo que guardamos en la cuenta Pro, proveedores y tus derechos según la LGPD." },
    },
  },
  {
    src: "termos.html",
    path: "/termos",
    lastmod: "2026-10-12",
    meta: {
      en: { description: "Terms of use for GuiaFlow and the GuiaFlow Pro subscription: the service, prices, renewal, cancellation, your content and acceptable use." },
      es: { description: "Términos de uso de GuiaFlow y de la suscripción GuiaFlow Pro: el servicio, precios, renovación, cancelación, tu contenido y uso aceptable." },
    },
  },
];

/** Caminho público (forma canônica: sem barra final; a raiz PT é "/"). */
export function localePath(page, loc) {
  if (loc === "pt") return page.path || "/";
  return `/${loc}${page.path}`;
}

/** Arquivo que a Vercel serve nesse caminho (cleanUrls: /en → en.html, /en/ajuda → en/ajuda.html). */
export function localeFile(page, loc) {
  if (loc === "pt") return page.src;
  return page.path ? `${loc}${page.path}.html` : `${loc}.html`;
}

export const absUrl = (path) => `${ORIGIN}${path}`;

const escText = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (v) => escText(v).replace(/"/g, "&quot;");
const unesc = (v) => String(v).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

function lookup(loc, key) {
  return catalogs[loc]?.[key] ?? catalogs.en?.[key] ?? null;
}

/** Fecha da tag aberta em `from` (conta aninhamento da mesma tag). */
function closeIndex(html, tag, from) {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  re.lastIndex = from;
  let depth = 1;
  let m;
  while ((m = re.exec(html))) {
    if (m[1]) depth -= 1;
    else if (!m[0].endsWith("/>")) depth += 1;
    if (depth === 0) return { start: m.index, end: re.lastIndex };
  }
  return null;
}

function setAttr(openTag, name, value) {
  const re = new RegExp(`(\\s${name}=")[^"]*(")`);
  if (re.test(openTag)) return openTag.replace(re, `$1${escAttr(value)}$2`);
  return openTag.replace(/\s*(\/?)>$/, ` ${name}="${escAttr(value)}"$1>`);
}

/** Aplica um atributo data-i18n* como o applyI18n do navegador faz. */
function applyAttr(html, attr, mode, loc) {
  const re = new RegExp(`<([a-zA-Z][a-zA-Z0-9]*)\\b[^>]*\\s${attr}="([^"]+)"[^>]*>`, "g");
  let out = "";
  let last = 0;
  let m;
  while ((m = re.exec(html))) {
    const [open, tag, key] = m;
    const value = lookup(loc, key);
    if (value == null) continue;
    const openEnd = m.index + open.length;
    if (mode === "text" || mode === "html") {
      const close = closeIndex(html, tag, openEnd);
      if (!close) continue;
      out += html.slice(last, openEnd) + (mode === "html" ? value : escText(value));
      last = close.start;
      re.lastIndex = close.start;
    } else {
      out += html.slice(last, m.index) + setAttr(open, mode, value);
      last = openEnd;
    }
  }
  return out + html.slice(last);
}

const ATTRS = [
  ["data-i18n", "text"],
  ["data-i18n-html", "html"],
  ["data-i18n-title", "title"],
  ["data-i18n-aria", "aria-label"],
  ["data-i18n-placeholder", "placeholder"],
  ["data-i18n-alt", "alt"],
];

function replaceMeta(html, attrName, attrValue, content) {
  const re = new RegExp(`(<meta\\s+${attrName}="${attrValue.replace(/[:.]/g, "\\$&")}"\\s+content=")[^"]*(")`);
  return re.test(html) ? html.replace(re, `$1${escAttr(content)}$2`) : html;
}

function readMeta(html, attrName, attrValue) {
  const re = new RegExp(`<meta\\s+${attrName}="${attrValue.replace(/[:.]/g, "\\$&")}"\\s+content="([^"]*)"`);
  const m = html.match(re);
  return m ? unesc(m[1]) : null;
}

/** Bloco <head> com canonical e hreflang — o mesmo conjunto em todas as variantes. */
function alternatesBlock(page, loc) {
  const lines = [`<link rel="canonical" href="${absUrl(localePath(page, loc))}" />`];
  for (const l of LOCALES) lines.push(`<link rel="alternate" hreflang="${HREFLANG[l]}" href="${absUrl(localePath(page, l))}" />`);
  lines.push(`<link rel="alternate" hreflang="x-default" href="${absUrl(localePath(page, "pt"))}" />`);
  return `<!-- i18n-alternates -->\n  ${lines.join("\n  ")}\n  <!-- /i18n-alternates -->`;
}

function withAlternates(html, page, loc) {
  const block = alternatesBlock(page, loc);
  if (html.includes("<!-- i18n-alternates -->")) {
    return html.replace(/<!-- i18n-alternates -->[\s\S]*?<!-- \/i18n-alternates -->/, block);
  }
  const re = /<link rel="canonical" href="[^"]*" \/>/;
  if (!re.test(html)) throw new Error(`${page.src}: sem <link rel="canonical">`);
  return html.replace(re, block);
}

function withHtmlAttrs(html, page, loc) {
  return html.replace(/<html\b[^>]*>/, (open) => {
    let tag = open.replace(/\s(data-page-locale|data-alt-(pt|en|es))="[^"]*"/g, "");
    tag = setAttr(tag, "lang", HREFLANG[loc]);
    if (loc !== "pt") tag = setAttr(tag, "data-page-locale", loc);
    for (const l of LOCALES) tag = setAttr(tag, `data-alt-${l}`, localePath(page, l));
    return tag;
  });
}

const LOCALIZED_LINK = /href="\/(ajuda\/api|ajuda|termos|privacidade|integracoes)?(?=["?#])([^"]*)"/g;

/** Preços da landing na moeda do idioma (o landing.js pinta o mesmo no navegador). */
function withPrices(html, loc) {
  const currency = paywallCurrency(loc);
  const offer = paywallOffer(currency);
  const fill = (re, value) => html.replace(re, (_m, a, b) => `${a}${escText(value)}${b}`);
  html = fill(/(<[a-z]+[^>]*data-price="month"[^>]*>)[^<]*(<\/)/g, formatPaywallAmount(offer.month, currency, loc));
  html = fill(/(<[a-z]+[^>]*data-price="year"[^>]*>)[^<]*(<\/)/g, formatPaywallAmount(offer.year, currency, loc));
  html = fill(/(<[a-z]+[^>]*data-i18n="lp\.plan\.free\.price"[^>]*>)[^<]*(<\/)/g, formatPaywallAmount(0, currency, loc));
  const months = String(lookup(loc, "billing.freeMonths") || "").replace(/\{n\}/g, String(offer.freeMonths));
  if (months) html = fill(/(<[a-z]+[^>]*data-free-months="[^"]*"[^>]*>)[^<]*(<\/)/g, months);
  return html;
}

/** Página PT → variante en/es. */
export function renderLocale(srcHtml, page, loc) {
  let html = srcHtml;
  // caminhos relativos quebram em /en/…: tudo vira absoluto
  html = html.replace(/\b(href|src)="(?:\.\/)?index\.html"/g, '$1="/"');
  html = html.replace(/\b(href|src)="(?!\/|#|[a-z][a-z0-9+.-]*:)(?:\.\/)?([^"]+)"/gi, '$1="/$2"');
  html = html.replace(/from "\.\/a\//g, 'from "/a/');
  html = html.replace(LOCALIZED_LINK, (_m, seg, rest) => `href="/${loc}${seg ? `/${seg}` : ""}${rest}"`);

  for (const [attr, mode] of ATTRS) html = applyAttr(html, attr, mode, loc);

  if (page.heroOg) html = withPrices(html, loc);
  html = html.replace(/(<span data-int-title>)[^<]*(<\/span>)/, (_m, a, b) => `${a}${escText(String(page.meta[loc]?.title || "").replace(/ — GuiaFlow$/, ""))}${b}`);

  // seções já escritas em cada idioma (API, integrações)
  html = html.replace(/<([a-z]+)([^>]*)\sdata-doc-locale="(pt|es|en)"([^>]*)>/g, (_m, tag, a, l, b) => {
    const rest = `${a} data-doc-locale="${l}"${b}`.replace(/\shidden\b/g, "");
    return `<${tag}${rest}${l === loc ? "" : " hidden"}>`;
  });
  html = html.replace(/(<option value="(pt|es|en)")( selected)?>/g, (_m, open, l) => `${open}${l === loc ? " selected" : ""}>`);

  const meta = page.meta[loc] || {};
  const titleMatch = html.match(/<title\b[^>]*>([^<]*)<\/title>/);
  const title = meta.title || (titleMatch ? unesc(titleMatch[1]) : "GuiaFlow");
  html = html.replace(/(<title\b[^>]*>)[^<]*(<\/title>)/, `$1${escText(title)}$2`);
  html = replaceMeta(html, "name", "description", meta.description);
  let ogTitle = title;
  let ogAlt = IMG_ALT[loc];
  if (page.heroOg) {
    const hero = String(lookup(loc, "lp.hero.title") || "").replace(/<[^>]+>/g, "").trim().replace(/\.$/, "");
    if (hero) {
      ogTitle = `${hero} — GuiaFlow`;
      ogAlt = `GuiaFlow — ${hero}.`;
    }
  }
  html = replaceMeta(html, "property", "og:title", ogTitle);
  html = replaceMeta(html, "name", "twitter:title", ogTitle);
  const ogDesc = meta.ogDescription || meta.description;
  html = replaceMeta(html, "property", "og:description", ogDesc);
  html = replaceMeta(html, "name", "twitter:description", ogDesc);
  html = replaceMeta(html, "property", "og:image:alt", ogAlt);
  html = replaceMeta(html, "name", "twitter:image:alt", ogAlt);
  html = replaceMeta(html, "property", "og:url", absUrl(localePath(page, loc)));
  if (readMeta(html, "property", "og:locale") != null) html = replaceMeta(html, "property", "og:locale", OG_LOCALE[loc]);
  else html = html.replace(/(<meta property="og:site_name"[^>]*>)/, `$1\n  <meta property="og:locale" content="${OG_LOCALE[loc]}" />`);
  html = html.replace(/("url":\s*")https:\/\/guiaflow\.pro[^"]*(")/, `$1${absUrl(localePath(page, loc))}$2`);

  html = withHtmlAttrs(html, page, loc);
  html = withAlternates(html, page, loc);
  return html;
}

/** Página PT com o bloco de alternates e os data-alt-*. */
export function renderPortuguese(srcHtml, page) {
  let html = srcHtml;
  if (readMeta(html, "property", "og:locale") == null) {
    html = html.replace(/(<meta property="og:site_name"[^>]*>)/, `$1\n  <meta property="og:locale" content="pt_BR" />`);
  }
  return withAlternates(withHtmlAttrs(html, page, "pt"), page, "pt");
}

export function renderSitemap() {
  const urls = [];
  for (const page of PAGES) {
    for (const loc of LOCALES) {
      const alts = LOCALES.map((l) => `    <xhtml:link rel="alternate" hreflang="${HREFLANG[l]}" href="${absUrl(localePath(page, l))}" />`);
      alts.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${absUrl(localePath(page, "pt"))}" />`);
      urls.push(`  <url>\n    <loc>${absUrl(localePath(page, loc))}</loc>\n    <lastmod>${page.lastmod}</lastmod>\n${alts.join("\n")}\n  </url>`);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join("\n")}\n</urlset>\n`;
}

/** Tudo o que o build grava: { arquivo: conteúdo }. */
export function buildAll(read = (f) => readFileSync(join(ROOT, f), "utf8")) {
  const out = {};
  for (const page of PAGES) {
    const pt = renderPortuguese(read(page.src), page);
    out[page.src] = pt;
    for (const loc of ["en", "es"]) out[localeFile(page, loc)] = renderLocale(pt, page, loc);
  }
  out["sitemap.xml"] = renderSitemap();
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const files = buildAll();
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(ROOT, file)), { recursive: true });
    writeFileSync(join(ROOT, file), content);
  }
  console.log(`build-locale-pages: ${Object.keys(files).length} arquivos`);
}
