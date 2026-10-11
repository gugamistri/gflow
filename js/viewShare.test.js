import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import {
  decideEscape,
  embedShowsCover,
  parseEmbedOptions,
  parseViewRoute,
  permanentShareEndpoint,
  sameOriginReferrer,
  clickClosesSharedTour,
  sharePageTitle,
  shareStartIndex,
  sharedPreviewBackTarget,
  tourFromPermanentShare,
} from "./viewShare.js";

const require = createRequire(import.meta.url);
const { renderViewPage } = require("../api/lib/view-shell.cjs");
const { fetchPermanentShare, metaFromData } = require("../api/lib/permanent-share.cjs");
const permanentHandler = require("../api/p/[slug].js");

const tour = {
  name: "Tour fixo",
  steps: [{ label: "Um", hotspot: { x: 10, y: 10, w: 20, h: 12 } }],
  customImages: {},
};

test("parseViewRoute distingue /v e /p", () => {
  assert.deepEqual(parseViewRoute("/v/Ab3xY9kLm2Q", null), { kind: "temporary", id: "Ab3xY9kLm2Q" });
  assert.deepEqual(parseViewRoute("/p/slug-permanente", null), {
    kind: "permanent",
    id: "slug-permanente",
  });
  assert.deepEqual(parseViewRoute("/view.html", { id: "Ab3xY9kLm2Q", kind: "temporary" }), {
    kind: "temporary",
    id: "Ab3xY9kLm2Q",
  });
  assert.deepEqual(parseViewRoute("/", { id: "slug-permanente", kind: "permanent", missing: false }), {
    kind: "permanent",
    id: "slug-permanente",
  });
  assert.equal(parseViewRoute("/ajuda", null), null);
});

test("o payload permanente é o tour, e not_found não vira tour", () => {
  const parsed = tourFromPermanentShare({
    ok: true,
    slug: "slug-permanente",
    title: "Título",
    createdAt: "2026-01-01T00:00:00.000Z",
    payload: tour,
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.tour, tour);
  assert.equal(parsed.title, "Título");
  assert.deepEqual(tourFromPermanentShare({ ok: false, error: "not_found" }), {
    ok: false,
    error: "not_found",
  });
  assert.equal(tourFromPermanentShare({ ok: true }).ok, false);
});

function mockTarget(...selectors) {
  const set = new Set(selectors);
  const node = {
    nodeType: 1,
    closest(selector) {
      return selector.split(",").some((part) => set.has(part.trim())) ? node : null;
    },
  };
  return node;
}

test("clique fora do cartão fecha; clique no cartão ou num controlo não", () => {
  assert.equal(clickClosesSharedTour(mockTarget("path")), true);
  assert.equal(clickClosesSharedTour(mockTarget("div")), true);
  assert.equal(clickClosesSharedTour(mockTarget("#canvas-slide")), false);
  assert.equal(clickClosesSharedTour(mockTarget(".slide-card")), false);
  assert.equal(clickClosesSharedTour(mockTarget(".driver-popover:not(.is-slide-hidden)")), false);
  assert.equal(clickClosesSharedTour(mockTarget(".driver-popover.is-slide-hidden")), true);
  assert.equal(clickClosesSharedTour(mockTarget("#hotspot")), false);
  assert.equal(clickClosesSharedTour(mockTarget(".driver-active-element")), false);
  assert.equal(clickClosesSharedTour(mockTarget("button")), false);
  assert.equal(clickClosesSharedTour(mockTarget("a")), false);
  assert.equal(clickClosesSharedTour(null), false);
});

test("o link partilhado começa no passo 1, salvo pedido na URL", () => {
  assert.equal(shareStartIndex("", 2), 0);
  assert.equal(shareStartIndex("?outro=1", 2), 0);
  assert.equal(shareStartIndex("?step=2", 2), 1);
  assert.equal(shareStartIndex("?passo=1", 2), 0);
  assert.equal(shareStartIndex("?step=9", 2), 1);
  assert.equal(shareStartIndex("?step=0", 2), 0);
  assert.equal(shareStartIndex("?step=abc", 2), 0);
  const storage = { guiaflowStep: "1", selectedIndex: "1" };
  assert.equal(shareStartIndex("", 2, storage), 0);
  assert.equal(sharePageTitle("E2E Pro Test"), "E2E Pro Test — GuiaFlow");
  assert.equal(sharePageTitle("  "), "GuiaFlow — Tour");
  assert.equal(sharePageTitle(""), "GuiaFlow — Tour");
});

test("o endpoint do link permanente aponta para /api/shares", () => {
  assert.equal(
    permanentShareEndpoint("https://app.guiaflow.pro/", "slug-permanente"),
    "https://app.guiaflow.pro/api/shares/slug-permanente"
  );
});

test("Esc sai do ecrã cheio, fecha painel, volta, ou fecha o tour", () => {
  assert.equal(decideEscape({ fullscreen: true, overlay: true, back: true }), "fullscreen");
  assert.equal(decideEscape({ overlay: true, back: true }), "overlay");
  assert.equal(decideEscape({ back: true }), "back");
  assert.equal(decideEscape({}), "close");
  // embed: Esc só sai do fullscreen ou fecha overlays; nunca fecha o tour nem volta
  assert.equal(decideEscape({ embed: true, fullscreen: true }), "fullscreen");
  assert.equal(decideEscape({ embed: true, overlay: true }), "overlay");
  assert.equal(decideEscape({ embed: true, back: true }), "");
  assert.equal(decideEscape({ embed: true }), "");
  assert.equal(sameOriginReferrer("https://guiaflow.pro/editor", "https://guiaflow.pro"), true);
  assert.equal(sameOriginReferrer("https://example.com/", "https://guiaflow.pro"), false);
  assert.equal(
    sharedPreviewBackTarget({
      referrer: "https://guiaflow.pro/",
      origin: "https://guiaflow.pro",
      historyLength: 2,
    }),
    "back"
  );
  assert.equal(
    sharedPreviewBackTarget({
      referrer: "https://example.com/",
      origin: "https://guiaflow.pro",
      historyLength: 4,
    }),
    ""
  );
  assert.equal(sharedPreviewBackTarget({ hasOpener: true, historyLength: 1 }), "close");
});

test("o shell de /p usa o mesmo player, canonical e não fala em 7 dias", () => {
  const html = renderViewPage({
    id: "slug-permanente",
    name: "Tour fixo",
    origin: "https://guiaflow.pro",
    missing: false,
    kind: "permanent",
  });
  assert.match(html, /rel="canonical" href="https:\/\/guiaflow\.pro\/p\/slug-permanente"/);
  assert.match(html, /property="og:title" content="Tour fixo — GuiaFlow"/);
  assert.match(html, /property="og:url" content="https:\/\/guiaflow\.pro\/p\/slug-permanente"/);
  assert.match(html, /"kind":"permanent"/);
  assert.match(html, /a\/60\/js\/viewApp\.js/);
  assert.match(html, /data-i18n="present\.escHint"/);
  assert.match(html, /Clique fora ou Esc para sair/);
  assert.match(html, /id="view-share-replay"/);
  assert.match(html, /Ver tour novamente/);
  assert.equal(html.includes("7 dias"), false);
  assert.equal(html.includes("expiresNote"), false);
  assert.equal(html.includes("recomeçar"), false);
  assert.equal(html.includes("customImages"), false);

  const missing = renderViewPage({
    id: "sumiu",
    name: null,
    origin: "https://guiaflow.pro",
    missing: true,
    kind: "permanent",
  });
  assert.match(missing, /Este link não está mais disponível\./);
  assert.match(missing, /href="https:\/\/guiaflow\.pro\/p\/sumiu"/);
  assert.equal(missing.includes("7 dias"), false);

  const temporary = renderViewPage({
    id: "Ab3xY9kLm2Q",
    name: "Tour fixo",
    origin: "https://guiaflow.pro",
    missing: false,
  });
  assert.match(temporary, /href="https:\/\/guiaflow\.pro\/v\/Ab3xY9kLm2Q"/);
  assert.match(temporary, /"kind":"temporary"/);
});

function fakeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(key, value) {
      this.headers[key] = value;
    },
    end(body) {
      this.body = body || "";
    },
  };
}

test("GET /api/p/:slug publica a meta e o 404 usa a mesma página", async () => {
  const prev = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    if (/\/sumiu(\/meta)?$/.test(String(url))) {
      return { ok: false, status: 404, json: async () => ({ ok: false, error: "not_found" }) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        slug: "slug-permanente",
        title: "Tour fixo",
        createdAt: "2026-01-01T00:00:00.000Z",
        payload: tour,
      }),
    };
  };
  try {
    const ok = fakeRes();
    await permanentHandler(
      { method: "GET", query: { slug: "slug-permanente" }, headers: { host: "guiaflow.pro" } },
      ok
    );
    assert.equal(ok.statusCode, 200);
    assert.match(ok.body, /og:title" content="Tour fixo — GuiaFlow"/);
    assert.match(ok.body, /\/p\/slug-permanente/);
    assert.equal(ok.body.includes("customImages"), false);
    assert.equal(ok.body.includes("7 dias"), false);
    assert.equal(seen[0], "https://app.guiaflow.pro/api/shares/slug-permanente/meta");

    const missing = fakeRes();
    await permanentHandler(
      { method: "GET", query: { slug: "sumiu" }, headers: { host: "guiaflow.pro" } },
      missing
    );
    assert.equal(missing.statusCode, 404);
    assert.match(missing.body, /Este link não está mais disponível\./);
    assert.match(missing.body, /\/p\/sumiu/);

    const invalid = fakeRes();
    await permanentHandler(
      { method: "GET", query: { slug: "../x" }, headers: { host: "guiaflow.pro" } },
      invalid
    );
    assert.equal(invalid.statusCode, 404);
    // 404 do /meta tenta o endpoint antigo (Cloud sem a rota nova) antes de dar "sumiu"
    assert.deepEqual(seen.slice(1), [
      "https://app.guiaflow.pro/api/shares/sumiu/meta",
      "https://app.guiaflow.pro/api/shares/sumiu",
    ]);

    const loaded = await fetchPermanentShare("slug-permanente", globalThis.fetch);
    assert.equal(loaded.missing, false);
    assert.equal(loaded.name, "Tour fixo");
  } finally {
    if (prev === undefined) delete globalThis.fetch;
    else globalThis.fetch = prev;
  }
});

test("/p usa a capa do Cloud na og:image, com nº de passos na descrição", async () => {
  const prev = globalThis.fetch;
  const cover = "https://app.guiaflow.pro/api/shares/slug-capa/cover.jpg?v=2026-10-11T13%3A00%3A00.000Z";
  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    json: async () => ({
      ok: true,
      slug: "slug-capa",
      title: 'Tour "fixo" <b>',
      updatedAt: "2026-10-11T13:00:00.000Z",
      stepCount: 7,
      ratio: "16/10",
      coverUrl: cover,
      coverWidth: 1200,
      coverHeight: 630,
    }),
  });
  try {
    const meta = await fetchPermanentShare("slug-capa");
    assert.equal(meta.image, cover);
    assert.equal(meta.stepCount, 7);
    assert.equal(meta.ratio, "16/10");
    const res = fakeRes();
    await permanentHandler({ method: "GET", query: { slug: "slug-capa" }, headers: { host: "guiaflow.pro" } }, res);
    assert.equal(res.statusCode, 200);
    const esc = cover.replace(/[.?*+^$()[\]{}|\\]/g, "\\$&");
    assert.match(res.body, new RegExp(`property="og:image" content="${esc}"`));
    assert.match(res.body, new RegExp(`name="twitter:image" content="${esc}"`));
    assert.match(res.body, /property="og:image:alt" content="Tour &quot;fixo&quot; &lt;b&gt;"/);
    assert.match(res.body, /property="og:description" content="Tour interativo: Tour &quot;fixo&quot; &lt;b&gt; · 7 passos"/);
    assert.equal(res.body.includes("<b>"), false);
    // o título no JSON do <script> não fecha a tag
    const evil = renderViewPage({ id: "x", name: "</script><script>alert(1)</script>", origin: "https://guiaflow.pro", kind: "permanent" });
    assert.equal(evil.includes("</script><script>alert(1)"), false);
    assert.match(evil, /\\u003c\/script\\u003e/);
  } finally {
    if (prev === undefined) delete globalThis.fetch;
    else globalThis.fetch = prev;
  }
});

test("sem capa, a og:image segue a da marca; capa não-https é ignorada", () => {
  const plain = renderViewPage({ id: "s", name: "Tour", origin: "https://guiaflow.pro", kind: "permanent", stepCount: 1 });
  assert.match(plain, /og:image" content="https:\/\/guiaflow\.pro\/brand\/og-image\.png"/);
  assert.match(plain, /og:description" content="Tour interativo: Tour · 1 passo"/);
  assert.match(plain, /og:image:width" content="1200"/);
  const missing = renderViewPage({ id: "s", name: null, origin: "https://guiaflow.pro", kind: "permanent", missing: true, image: "https://x/c.jpg" });
  assert.match(missing, /og:image" content="https:\/\/guiaflow\.pro\/brand\/og-image\.png"/);
  assert.equal(metaFromData({ ok: true, coverUrl: "javascript:alert(1)" }).image, null);
  assert.equal(metaFromData({ ok: true, ratio: "1;2" }).ratio, null);
  // endpoint antigo (sem stepCount) conta pelo payload
  assert.equal(metaFromData({ ok: true, payload: { steps: [{}, {}] } }).stepCount, 2);
});

test("?embed=1 liga o modo incorporado; autoplay só vale no embed", () => {
  assert.deepEqual(parseEmbedOptions(""), { embed: false, autoplay: false });
  assert.deepEqual(parseEmbedOptions("?embed=1"), { embed: true, autoplay: false });
  assert.deepEqual(parseEmbedOptions("embed=true&autoplay=1"), { embed: true, autoplay: true });
  assert.deepEqual(parseEmbedOptions("?embed"), { embed: true, autoplay: false });
  assert.deepEqual(parseEmbedOptions("?embed=0&autoplay=1"), { embed: false, autoplay: false });
  assert.deepEqual(parseEmbedOptions("?autoplay=1"), { embed: false, autoplay: false });
  assert.deepEqual(parseEmbedOptions("?embed=1&autoplay=0&step=2"), { embed: true, autoplay: false });
  assert.equal(embedShowsCover({ embed: true, autoplay: false }), true);
  assert.equal(embedShowsCover({ embed: true, autoplay: true }), false);
  assert.equal(embedShowsCover({ embed: false, autoplay: false }), false);
  // passo inicial continua valendo junto com embed
  assert.equal(shareStartIndex("?embed=1&step=2", 3), 1);
});

test("no embed, clique fora do cartão não fecha o tour", () => {
  assert.equal(clickClosesSharedTour(mockTarget("path"), { embed: true }), false);
  assert.equal(clickClosesSharedTour(mockTarget("div"), { embed: true }), false);
  assert.equal(clickClosesSharedTour(mockTarget("path"), { embed: false }), true);
});

test("o shell do /p e do /v traz a capa do embed e liga a classe cedo", () => {
  for (const kind of ["permanent", "temporary"]) {
    const html = renderViewPage({ id: "slug-permanente", name: "Tour", origin: "https://guiaflow.pro", kind });
    assert.match(html, /id="view-share-cover"[^>]*hidden/);
    assert.match(html, /id="view-share-cover-play"/);
    assert.match(html, /data-i18n="view.coverPlay"/);
    assert.match(html, /classList\.add\("is-embed"\)/);
    assert.match(html, /id="present-progress"/);
  }
  const view = readFileSync(new URL("../view.html", import.meta.url), "utf8");
  assert.match(view, /id="view-share-cover"[^>]*hidden/);
  assert.match(view, /classList\.add\("is-embed"\)/);
});

test("nenhum header impede o /p e o /v de abrir em iframe", () => {
  // why: o embed depende disso. Se um dia houver CSP, usar frame-ancestors * em /p e /v.
  const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  for (const rule of vercel.headers || []) {
    for (const header of rule.headers || []) {
      const key = String(header.key || "").toLowerCase();
      assert.notEqual(key, "x-frame-options", rule.source);
      if (key === "content-security-policy") {
        assert.equal(/frame-ancestors\s+'(none|self)'/.test(header.value) && /\/(p|v)|\(\.\*\)/.test(rule.source), false, rule.source);
      }
    }
  }
});

test("o shell do /p, do /v e o view.html têm o palco do passo fixo, escondido", () => {
  for (const kind of ["permanent", "temporary"]) {
    const html = renderViewPage({ id: "slug-permanente", name: "Tour", origin: "https://guiaflow.pro", kind });
    assert.match(html, /id="view-share-fixed"[^>]*hidden/);
  }
  const view = readFileSync(new URL("../view.html", import.meta.url), "utf8");
  assert.match(view, /id="view-share-fixed"[^>]*hidden/);
});

test("tourFromPermanentShare repassa só os recursos que o servidor liga (leads/contato)", () => {
  const base = { ok: true, payload: { steps: [{}] } };
  assert.deepEqual(tourFromPermanentShare(base).features, { leadCapture: false, contactForm: false });
  assert.deepEqual(
    tourFromPermanentShare({ ...base, features: { leadCapture: true, contactForm: "yes" } }).features,
    { leadCapture: true, contactForm: false }
  );
});
