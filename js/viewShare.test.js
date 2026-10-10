import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import {
  decideEscape,
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
const { fetchPermanentShare } = require("../api/lib/permanent-share.cjs");
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
  assert.match(html, /a\/39\/js\/viewApp\.js/);
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
    if (String(url).endsWith("/sumiu")) {
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
    assert.equal(seen[0], "https://app.guiaflow.pro/api/shares/slug-permanente");

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
    assert.equal(seen.length, 2);

    const loaded = await fetchPermanentShare("slug-permanente", globalThis.fetch);
    assert.equal(loaded.missing, false);
    assert.equal(loaded.name, "Tour fixo");
  } finally {
    if (prev === undefined) delete globalThis.fetch;
    else globalThis.fetch = prev;
  }
});
