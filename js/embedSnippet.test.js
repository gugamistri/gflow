import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_EMBED_RATIO,
  buildEmbedSnippet,
  embedPlayerUrl,
  embedRatio,
  normalizeEmbedFlavor,
} from "./embedSnippet.js";

test("proporção vem da 1ª captura, com 16/9 de reserva", () => {
  assert.equal(embedRatio(1440, 900), "8/5");
  assert.equal(embedRatio(1920, 1080), "16/9");
  assert.equal(embedRatio(1280, 800), "8/5");
  assert.equal(embedRatio(1366, 768), "1.78/1");
  assert.equal(embedRatio(0, 900), DEFAULT_EMBED_RATIO);
  assert.equal(embedRatio(undefined, undefined), DEFAULT_EMBED_RATIO);
  assert.equal(embedRatio(4000, 100), DEFAULT_EMBED_RATIO);
  assert.equal(embedRatio(390, 844), "0.46/1");
});

test("a URL do embed liga embed=1 e autoplay só quando pedido", () => {
  assert.equal(embedPlayerUrl("https://guiaflow.pro/p/meu-tour"), "https://guiaflow.pro/p/meu-tour?embed=1");
  assert.equal(
    embedPlayerUrl("https://guiaflow.pro/p/meu-tour", { autoplay: true }),
    "https://guiaflow.pro/p/meu-tour?embed=1&autoplay=1"
  );
  assert.equal(
    embedPlayerUrl("https://guiaflow.pro/p/meu-tour?embed=0&autoplay=1#x"),
    "https://guiaflow.pro/p/meu-tour?embed=1"
  );
  assert.equal(embedPlayerUrl("javascript:alert(1)"), "");
  assert.equal(embedPlayerUrl(""), "");
});

test("snippet responsivo com iframe lazy, fullscreen e título acessível", () => {
  const html = buildEmbedSnippet({ url: "https://guiaflow.pro/p/abc", title: "Meu tour", ratio: "8/5" });
  assert.match(html, /aspect-ratio:8\/5/);
  assert.match(html, /src="https:\/\/guiaflow\.pro\/p\/abc\?embed=1"/);
  assert.match(html, /loading="lazy"/);
  assert.match(html, /allow="autoplay; fullscreen; clipboard-write" allowfullscreen/);
  assert.match(html, /title="Tour interativo: Meu tour"/);
  assert.match(html, /min-height:420px/);
  assert.doesNotMatch(html, /wp:html/);
});

test("o título é escapado e a proporção inválida cai no padrão", () => {
  const html = buildEmbedSnippet({
    url: "https://guiaflow.pro/p/abc",
    title: 'Tour "x" <script>alert(1)</script>',
    ratio: "1;background:url(x)",
  });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /title="Tour interativo: Tour &quot;x&quot; &lt;script&gt;alert\(1\)&lt;\/script&gt;"/);
  assert.match(html, /aspect-ratio:16\/9;/);
});

test("WordPress vem dentro de um bloco HTML; Webflow é o HTML puro", () => {
  const wp = buildEmbedSnippet({ url: "https://guiaflow.pro/p/abc", flavor: "wordpress" });
  assert.match(wp, /^<!-- wp:html -->\n<div/);
  assert.match(wp, /<\/div>\n<!-- \/wp:html -->$/);
  const wf = buildEmbedSnippet({ url: "https://guiaflow.pro/p/abc", flavor: "webflow" });
  assert.equal(wf, buildEmbedSnippet({ url: "https://guiaflow.pro/p/abc" }));
  assert.equal(normalizeEmbedFlavor("WordPress"), "wordpress");
  assert.equal(normalizeEmbedFlavor("x"), "html");
});

test("rótulo do título segue o idioma e URL inválida não gera código", () => {
  const html = buildEmbedSnippet({ url: "https://guiaflow.pro/p/abc", title: "Demo", label: "Interactive tour", autoplay: true });
  assert.match(html, /title="Interactive tour: Demo"/);
  assert.match(html, /\?embed=1&amp;autoplay=1"/);
  assert.equal(buildEmbedSnippet({ url: "nope" }), "");
});

import { readFileSync } from "node:fs";
import { catalogs, SUPPORTED_LOCALES } from "./i18n.js";
import { normalizePaywallFeature, paywallFeatureOrder, buildCheckoutBody } from "./paywall.js";
import { upgradeCopyKeys } from "./billing.js";

test("embed é Pro: alias do link permanente e texto próprio no paywall", () => {
  assert.equal(normalizePaywallFeature("embed"), "permanentShare");
  assert.equal(paywallFeatureOrder("embed")[0], "permanentShare");
  assert.equal(buildCheckoutBody({ interval: "month", currency: "brl", source: "embed" }).source, "permanentShare");
  assert.deepEqual(upgradeCopyKeys("embed"), { title: "billing.embedTitle", subtitle: "billing.embedSubtitle" });
});

test("textos do embed e do guia existem em pt, es e en, sem 'nuvem'", () => {
  const keys = Object.keys(catalogs.pt).filter((k) => k.startsWith("embed.") || k.startsWith("help.embed") || k.startsWith("billing.embed"));
  assert.ok(keys.length >= 25);
  for (const loc of SUPPORTED_LOCALES) {
    for (const key of keys) {
      assert.equal(typeof catalogs[loc][key], "string", `${loc} ${key}`);
      assert.ok(catalogs[loc][key].trim(), `${loc} ${key}`);
      assert.equal(/nuvem/i.test(catalogs[loc][key]), false, `${loc} ${key}`);
    }
  }
  assert.match(catalogs.pt["billing.embedTitle"], /GuiaFlow\u00a0Pro/);
  assert.equal(catalogs.pt["embed.button"], "Incorporar no site");
});

test("o editor tem a aba Incorporar; a ajuda tem a seção #incorporar", () => {
  const html = readFileSync(new URL("../editor.html", import.meta.url), "utf8");
  assert.match(html, /id="btn-share-embed"[^>]*hidden/);
  assert.match(html, /id="embed-pro-badge"/);
  assert.match(html, /id="pane-share-embed"/);
  assert.equal(html.includes('id="modal-embed"'), false);
  for (const flavor of ["html", "wordpress", "webflow"]) assert.match(html, new RegExp(`data-flavor="${flavor}"`));
  assert.match(html, /href="\/ajuda#incorporar"/);
  const help = readFileSync(new URL("../ajuda.html", import.meta.url), "utf8");
  assert.match(help, /id="incorporar"/);
  for (const key of ["help.embedTitle", "help.embedWp1", "help.embedWf1"]) {
    assert.ok(help.includes(`"${key}"`), key);
  }
});

test("Notion e Medium recebem o link /p puro (oEmbed), sem embed/autoplay", () => {
  for (const flavor of ["notion", "medium"]) {
    assert.equal(buildEmbedSnippet({ url: "https://guiaflow.pro/p/abc?x=1", flavor, autoplay: true }), "https://guiaflow.pro/p/abc");
  }
});

test("embed URL carries an optional initial language (PRD multi-idioma RF22)", async () => {
  const { embedPlayerUrl } = await import("./embedSnippet.js");
  assert.equal(embedPlayerUrl("https://app.guiaflow.pro/p/x", { autoplay: true, lang: "en" }), "https://app.guiaflow.pro/p/x?embed=1&autoplay=1&lang=en");
  assert.equal(embedPlayerUrl("https://app.guiaflow.pro/p/x?lang=es", { lang: "bad tag" }), "https://app.guiaflow.pro/p/x?embed=1");
});
