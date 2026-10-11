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
  assert.match(landing, /<meta property="og:image" content="https:\/\/guiaflow\.pro\/brand\/og-landing\.png"/);
  assert.match(landing, /<meta name="twitter:card" content="summary_large_image"/);
  assert.equal(/noindex/.test(landing), false);
  const png = readFileSync(new URL("brand/og-landing.png", root));
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
