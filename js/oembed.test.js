import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { buildEmbedSnippet, embedPlayerUrl } from "./embedSnippet.js";

const require = createRequire(import.meta.url);
const handler = require("../api/oembed.js");
const cjs = require("../api/lib/embed-snippet.cjs");
const { renderViewPage } = require("../api/lib/view-shell.cjs");

function fakeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value;
    },
    end(body) {
      this.body = body || "";
    },
  };
}

async function call(query, { method = "GET", fetchImpl } = {}) {
  const prev = globalThis.fetch;
  const seen = [];
  globalThis.fetch =
    fetchImpl ||
    (async (url) => {
      seen.push(String(url));
      if (/\/sumiu(\/meta)?$/.test(String(url))) {
        return { ok: false, status: 404, json: async () => ({ ok: false, error: "not_found" }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          slug: "demo-tour",
          title: 'Onboarding "CRM"',
          updatedAt: "2026-10-11T13:00:00.000Z",
          stepCount: 5,
          ratio: "16/10",
          coverUrl: "https://app.guiaflow.pro/api/shares/demo-tour/cover.jpg?v=1",
          coverWidth: 1200,
          coverHeight: 630,
        }),
      };
    });
  try {
    const res = fakeRes();
    await handler({ method, query, headers: { host: "guiaflow.pro" } }, res);
    let json = null;
    try {
      json = JSON.parse(res.body);
    } catch {
      json = null;
    }
    return { res, json, seen };
  } finally {
    if (prev === undefined) delete globalThis.fetch;
    else globalThis.fetch = prev;
  }
}

test("oEmbed rich com o mesmo snippet do diálogo Incorporar", async () => {
  const { res, json, seen } = await call({ url: "https://guiaflow.pro/p/demo-tour" });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"], /application\/json/);
  assert.match(res.headers["cache-control"], /s-maxage=300/);
  assert.equal(res.headers["access-control-allow-origin"], "*");
  assert.equal(json.version, "1.0");
  assert.equal(json.type, "rich");
  assert.equal(json.provider_name, "GuiaFlow");
  assert.equal(json.provider_url, "https://guiaflow.pro/");
  assert.equal(json.title, 'Onboarding "CRM"');
  assert.equal(
    json.html,
    buildEmbedSnippet({ url: "https://guiaflow.pro/p/demo-tour", title: 'Onboarding "CRM"', ratio: "16/10" })
  );
  assert.match(json.html, /src="https:\/\/guiaflow\.pro\/p\/demo-tour\?embed=1"/);
  assert.equal(json.thumbnail_url, "https://app.guiaflow.pro/api/shares/demo-tour/cover.jpg?v=1");
  assert.equal(json.thumbnail_width, 1200);
  assert.equal(json.thumbnail_height, 630);
  assert.equal(json.width, 800);
  assert.equal(json.height, 500);
  assert.equal(seen[0], "https://app.guiaflow.pro/api/shares/demo-tour/meta");
});

test("oEmbed: maxwidth/maxheight, slug com maiúsculas e barra final", async () => {
  const small = await call({ url: "https://www.guiaflow.pro/p/Demo-Tour/?utm=x", maxwidth: "600", maxheight: "300" });
  assert.equal(small.res.statusCode, 200);
  assert.equal(small.seen[0], "https://app.guiaflow.pro/api/shares/demo-tour/meta");
  assert.ok(small.json.width <= 600);
  assert.equal(small.json.height, 300);
  const wide = await call({ url: "https://guiaflow.pro/p/demo-tour", maxwidth: "5000" });
  assert.equal(wide.json.width, 1200);
  assert.equal(wide.json.height, 750);
});

test("oEmbed: xml → 501; não-/p, /v, outro domínio e slug inválido → 404", async () => {
  assert.equal((await call({ url: "https://guiaflow.pro/p/demo-tour", format: "xml" })).res.statusCode, 501);
  for (const url of [
    "https://guiaflow.pro/v/Ab3xY9kLm2Q",
    "https://guiaflow.pro/",
    "https://evil.example/p/demo-tour",
    "https://guiaflow.pro/p/demo_tour",
    "https://guiaflow.pro/p/demo-tour/extra",
    "javascript:alert(1)",
    "",
  ]) {
    const { res, seen } = await call({ url });
    assert.equal(res.statusCode, 404, url);
    assert.equal(seen.length, 0, url);
  }
  const gone = await call({ url: "https://guiaflow.pro/p/sumiu" });
  assert.equal(gone.res.statusCode, 404);
  const down = await call(
    { url: "https://guiaflow.pro/p/demo-tour" },
    {
      fetchImpl: async () => {
        throw new Error("offline");
      },
    }
  );
  assert.equal(down.res.statusCode, 502);
  assert.equal(down.res.headers["cache-control"], "no-store");
  assert.equal((await call({ url: "https://guiaflow.pro/p/demo-tour" }, { method: "POST" })).res.statusCode, 405);
});

test("sem capa, a miniatura do oEmbed é a imagem da marca", async () => {
  const { json } = await call(
    { url: "https://guiaflow.pro/p/demo-tour" },
    {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, slug: "demo-tour", title: "Tour", stepCount: 2, ratio: null, coverUrl: null }),
      }),
    }
  );
  assert.equal(json.thumbnail_url, "https://guiaflow.pro/brand/og-image.png");
  assert.match(json.html, /aspect-ratio:16\/9/);
});

test("snippet CJS (oEmbed) e ESM (editor) geram o mesmo HTML", () => {
  const cases = [
    { url: "https://guiaflow.pro/p/a", title: "Tour", ratio: "16/10" },
    { url: "https://guiaflow.pro/p/a?step=2#x", title: 'A "B" <c> & d', ratio: "1.83/1", autoplay: true },
    { url: "https://guiaflow.pro/p/a", title: "", ratio: "bad", flavor: "wordpress", label: "Interactive tour" },
    { url: "https://guiaflow.pro/p/a", flavor: "webflow" },
    { url: "ftp://x/p/a" },
    {},
  ];
  for (const c of cases) {
    assert.equal(cjs.buildEmbedSnippet(c), buildEmbedSnippet(c));
    assert.equal(cjs.embedPlayerUrl(c.url, c), embedPlayerUrl(c.url, c));
  }
});

test("/p anuncia oEmbed e Iframely; /v e link sumido não", () => {
  const html = renderViewPage({ id: "demo-tour", name: "Tour", origin: "https://guiaflow.pro", kind: "permanent", ratio: "16/10" });
  assert.match(
    html,
    /<link rel="alternate" type="application\/json\+oembed" href="https:\/\/guiaflow\.pro\/oembed\?url=https%3A%2F%2Fguiaflow\.pro%2Fp%2Fdemo-tour&amp;format=json"/
  );
  assert.match(html, /<link rel="iframely app" href="https:\/\/guiaflow\.pro\/p\/demo-tour\?embed=1" media="aspect-ratio: 16\/10" \/>/);
  const noRatio = renderViewPage({ id: "demo-tour", name: "Tour", origin: "https://guiaflow.pro", kind: "permanent" });
  assert.match(noRatio, /media="aspect-ratio: 16\/9"/);
  const temp = renderViewPage({ id: "Ab3xY9kLm2Q", name: "Tour", origin: "https://guiaflow.pro" });
  assert.equal(temp.includes("json+oembed"), false);
  assert.equal(temp.includes("iframely"), false);
  const gone = renderViewPage({ id: "sumiu", name: null, origin: "https://guiaflow.pro", kind: "permanent", missing: true });
  assert.equal(gone.includes("json+oembed"), false);
});
