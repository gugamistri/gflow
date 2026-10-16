import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { PAGES, localeFile, localePath, absUrl } from "./build-locale-pages.mjs";

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const HL = { pt: "pt-BR", en: "en", es: "es" };

test("páginas públicas: seletor de idioma com <a href> reais para a URL equivalente, atual com aria-current", () => {
  for (const page of PAGES) {
    for (const loc of ["pt", "en", "es"]) {
      const html = read(loc === "pt" ? page.src : localeFile(page, loc));
      const nav = html.match(/<nav class="locale-links"[^>]*aria-label="[^"]+"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
      assert.ok(nav, `${page.src} ${loc}: sem nav.locale-links`);
      for (const l of ["pt", "en", "es"]) {
        assert.ok(nav.includes(`<a href="${localePath(page, l)}" hreflang="${HL[l]}" lang="${HL[l]}"`), `${page.src} ${loc}→${l}`);
      }
      assert.equal((nav.match(/aria-current="page"/g) || []).length, 1);
      assert.match(nav, new RegExp(`href="${localePath(page, loc)}"[^>]*aria-current="page"`));
      assert.equal(html.includes("<select id=\"locale-select\""), false, `${page.src} ${loc}: select antigo`);
      // hreflang do <head> continua
      assert.ok(html.includes(`<link rel="canonical" href="${absUrl(localePath(page, loc))}" />`));
      assert.ok(html.includes(`<link rel="alternate" hreflang="x-default" href="${absUrl(localePath(page, "pt"))}" />`));
    }
  }
});

test("nenhum link interno das páginas públicas usa ?landing=1 (só o clique no editor)", () => {
  for (const page of PAGES) {
    for (const loc of ["pt", "en", "es"]) {
      const html = read(loc === "pt" ? page.src : localeFile(page, loc));
      assert.equal(/href="[^"]*landing=1/.test(html), false, `${page.src} ${loc}`);
      assert.equal(/href="(?:\.\/)?index\.html"/.test(html), false, `${page.src} ${loc}: index.html`);
    }
  }
  assert.equal(/href="[^"]*landing=1/.test(read("editor.html")), false);
  assert.match(read("js/app.js"), /window\.open\("\/\?landing=1", "_blank", "noopener"\)/);
});

test("logo da landing aponta para a URL limpa de cada idioma", () => {
  assert.match(read("index.html"), /<a class="brand" href="\/" /);
  assert.match(read("en.html"), /<a class="brand" href="\/en" /);
  assert.match(read("es.html"), /<a class="brand" href="\/es" /);
});

test("sitemap só lista URLs finais (arquivo existe, sem redirect de slug antigo)", () => {
  const sm = read("sitemap.xml");
  const cfg = JSON.parse(read("vercel.json"));
  const sources = new Set(cfg.redirects.filter((r) => !r.has).map((r) => r.source));
  for (const [, u] of sm.matchAll(/<loc>https:\/\/guiaflow\.pro([^<]*)<\/loc>/g)) {
    assert.equal(sources.has(u || "/"), false, u);
    assert.equal(u.endsWith("/") && u !== "/", false, u);
  }
});
