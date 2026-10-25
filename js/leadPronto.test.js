import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { catalogs, SUPPORTED_LOCALES } from "./i18n.js";
import {
  LP_HELP,
  isTourSlug,
  leadProntoProblem,
  leadProntoReturnKey,
  normalizeLeadPronto,
  normalizeShareList,
  planLeadProntoSave,
  readAuthorizeUrl,
  readLeadProntoReturn,
  stripLeadProntoReturn,
  toursOf,
} from "./leadPronto.js";

test("status do GET: config_missing, disconnected, connected e disabled", () => {
  assert.equal(normalizeLeadPronto({ ok: true, status: "config_missing" }).status, "config_missing");
  assert.equal(normalizeLeadPronto({ ok: true, status: "disconnected" }).enabled, false);
  const on = normalizeLeadPronto({
    ok: true,
    status: "connected",
    tenant: "Acme",
    enabled: true,
    tours: null,
  });
  assert.equal(on.tenant, "Acme");
  assert.equal(on.enabled, true);
  assert.equal(on.tours, null);
  const off = normalizeLeadPronto({ ok: true, status: "disabled", tenantName: "Beta", enabled: false, tours: ["tour-a1"] });
  assert.equal(off.enabled, false);
  assert.equal(off.tenant, "Beta");
  assert.deepEqual(off.tours, ["tour-a1"]);
  assert.equal(normalizeLeadPronto({ ok: true }), null);
  assert.equal(normalizeLeadPronto({ status: "nope" }), null);
});

test("tours null é todos; a lista fica só com slugs", () => {
  assert.equal(toursOf({ tours: null }), null);
  assert.equal(toursOf({}), null);
  assert.deepEqual(toursOf({ tours: ["Tour-A1", "tour-a1", "ruim slug", "../x"] }), ["tour-a1"]);
  assert.equal(isTourSlug("tem-projeto"), true);
  assert.equal(isTourSlug("-no"), false);
});

test("PUT: null envia todos, lista envia slugs, vazio não", () => {
  assert.deepEqual(planLeadProntoSave({ enabled: true, allTours: true }), { body: { enabled: true, tours: null } });
  assert.deepEqual(planLeadProntoSave({ enabled: false, allTours: false, tours: ["Tour-A1", "outro"] }), {
    body: { enabled: false, tours: ["tour-a1", "outro"] },
  });
  assert.deepEqual(planLeadProntoSave({ enabled: true, allTours: false, tours: [] }), { error: "tours" });
});

test("falhas e últimas entregas, se a API devolver", () => {
  const state = normalizeLeadPronto({
    ok: true,
    status: "connected",
    tenant: "Acme",
    consecutiveFailures: 2,
    autoDisabled: false,
    deliveries: [
      { status: "pending", createdAt: "2026-10-25T12:00:00Z" },
      { status: "failed", lastStatus: 500, lastError: "http_500", createdAt: "2026-10-25T11:00:00Z" },
      { status: "delivered", lastStatus: 200, deliveredAt: "2026-10-25T10:00:00Z" },
    ],
  });
  assert.equal(state.consecutiveFailures, 2);
  assert.equal(state.deliveries.length, 2);
  assert.equal(state.deliveries[0].ok, false);
  assert.equal(state.deliveries[0].httpStatus, 500);
  assert.equal(state.deliveries[1].ok, true);
  const one = normalizeLeadPronto({
    status: "disabled",
    disabledReason: "failures",
    lastDelivery: { ok: false, httpStatus: 401, at: "2026-10-25T09:00:00Z", error: "no" },
  });
  assert.equal(one.autoDisabled, true);
  assert.equal(one.deliveries[0].httpStatus, 401);
});

test("authorizeUrl só https, ou http em localhost", () => {
  assert.equal(
    readAuthorizeUrl({ authorizeUrl: "https://app.leadpronto.ai/oauth/authorize?client_id=guiaflow" }),
    "https://app.leadpronto.ai/oauth/authorize?client_id=guiaflow",
  );
  assert.equal(readAuthorizeUrl({ authorizeUrl: "javascript:alert(1)" }), "");
  assert.equal(readAuthorizeUrl({ authorizeUrl: "http://evil.example/oauth" }), "");
  assert.match(readAuthorizeUrl({ authorizeUrl: "http://127.0.0.1:4000/oauth" }), /^http:\/\/127\.0\.0\.1:4000\/oauth$/);
  assert.equal(readAuthorizeUrl({}), "");
});

test("volta do OAuth: connected ou error com reason, e sai da barra", () => {
  assert.deepEqual(readLeadProntoReturn("https://guiaflow.pro/editor?leadpronto=connected"), { kind: "connected", reason: "" });
  assert.deepEqual(readLeadProntoReturn("https://guiaflow.pro/editor?leadpronto=error&reason=state"), { kind: "error", reason: "state" });
  assert.equal(readLeadProntoReturn("https://guiaflow.pro/editor?billing=success"), null);
  assert.equal(
    stripLeadProntoReturn("https://guiaflow.pro/editor?leadpronto=error&reason=state&pro=1"),
    "https://guiaflow.pro/editor?pro=1",
  );
  assert.equal(stripLeadProntoReturn("https://guiaflow.pro/editor?leadpronto=connected"), "https://guiaflow.pro/editor");
  assert.equal(leadProntoReturnKey("state"), "leads.lp.errReturnState");
  assert.equal(leadProntoReturnKey("access_denied"), "leads.lp.errReturnDenied");
  assert.equal(leadProntoReturnKey("outra"), "leads.lp.errReturn");
});

test("erros: 402 abre o Pro, 401 pede sessão, 503 é indisponível", () => {
  assert.equal(leadProntoProblem({ ok: true }), "");
  assert.equal(leadProntoProblem({ ok: false, status: 402, error: "subscription_required" }), "paywall");
  assert.equal(leadProntoProblem({ ok: false, status: 401, error: "unauthorized" }), "auth");
  assert.equal(leadProntoProblem({ ok: false, status: 503, error: "config_missing" }), "config");
  assert.equal(leadProntoProblem({ ok: false, status: 400, error: "invalid_tours" }), "tours");
  assert.equal(leadProntoProblem({ ok: false, status: 500, error: "http_500" }), "generic");
});

test("lista de tours da conta usa slug e título", () => {
  assert.deepEqual(normalizeShareList({
    shares: [
      { slug: "tour-a1", title: "Tour A" },
      { slug: "TOUR-A1", title: "dup" },
      { slug: "../x", title: "não" },
    ],
  }), [{ slug: "tour-a1", title: "Tour A" }]);
});

test("textos do LeadPronto existem em pt, en e es, com ajuda em /integracoes", () => {
  const keys = Object.keys(catalogs.pt).filter((key) => key.startsWith("leads.lp."));
  assert.ok(keys.length >= 20, `poucas chaves: ${keys.length}`);
  for (const loc of SUPPORTED_LOCALES) {
    for (const key of keys) {
      const value = catalogs[loc][key];
      assert.equal(typeof value, "string", `${loc} ${key}`);
      assert.ok(value.trim(), `${loc} ${key}`);
      assert.equal(/nuvem|nube|\bcloud\b/i.test(value), false, `${loc} ${key}`);
    }
    assert.match(LP_HELP[loc], /#leadpronto$/);
  }
  assert.equal(catalogs.pt["leads.lp.connect"], "Conectar ao LeadPronto");
  assert.equal(catalogs.pt["leads.lp.connected"], "Conectado a {tenant}");
  const html = readFileSync(new URL("../editor.html", import.meta.url), "utf8");
  const start = html.indexOf('id="leads-lp"');
  const end = html.indexOf('id="btn-leads-refresh"', start);
  const section = html.slice(start, end);
  assert.ok(start > 0);
  assert.match(section, /pro-badge/);
  assert.match(section, /id="btn-leads-lp-connect"/);
  assert.match(section, /href="\/integracoes#leadpronto"/);
  assert.match(readFileSync(new URL("../integracoes.html", import.meta.url), "utf8"), /id="leadpronto"/);
});
