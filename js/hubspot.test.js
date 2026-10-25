import assert from "node:assert/strict";
import test from "node:test";
import { catalogs, SUPPORTED_LOCALES } from "./i18n.js";
import {
  HUBSPOT_FIELDS,
  authorizeUrlOf,
  hubspotProblem,
  hubspotReturnNotice,
  normalizeHubspot,
  normalizeTestResult,
  planHubspotSave,
  readHubspotReturn,
  stripHubspotReturn,
} from "./hubspot.js";

test("authorizeUrl só abre http(s)", () => {
  assert.equal(authorizeUrlOf({ authorizeUrl: "https://app.hubspot.com/oauth/authorize?client_id=1" }), "https://app.hubspot.com/oauth/authorize?client_id=1");
  assert.equal(authorizeUrlOf({ hubspot: { authorizeUrl: "https://app.hubspot.com/oauth/authorize" } }), "https://app.hubspot.com/oauth/authorize");
  assert.equal(authorizeUrlOf({ authorizeUrl: "javascript:alert(1)" }), "");
  assert.equal(authorizeUrlOf({ authorizeUrl: "" }), "");
  assert.equal(authorizeUrlOf(null), "");
});

test("GET: conta, tokenLast4, escopos e entregas; o token inteiro não volta", () => {
  assert.equal(normalizeHubspot(null), null);
  assert.equal(normalizeHubspot({ ok: true, hubspot: null }), null);
  assert.equal(normalizeHubspot({ ok: true }), null);
  const leaked = "pat-na1-super-secreto-nao-mostrar";
  const conn = normalizeHubspot({
    ok: true,
    hubspot: {
      connected: true,
      enabled: true,
      hubDomain: "demo.hubspot.com",
      hubId: 42,
      tokenLast4: "ab12",
      accessToken: leaked,
      refreshToken: leaked,
      scopes: ["crm.objects.contacts.write", "crm.schemas.contacts.write"],
      mapping: { email: "email", tour: "", extra: "nao" },
      consecutiveFailures: 2,
      deliveries: [
        { delivered: false, status: 500, error: "http_500", at: "2026-10-25T12:00:00Z" },
        { delivered: true, status: 200, at: "2026-10-25T11:00:00Z" },
      ],
    },
  });
  assert.equal(conn.connected, true);
  assert.equal(conn.account, "demo.hubspot.com");
  assert.equal(conn.tokenLast4, "ab12");
  assert.deepEqual(conn.scopes, ["crm.objects.contacts.write", "crm.schemas.contacts.write"]);
  assert.equal(conn.mapping.email, "email");
  assert.equal(conn.mapping.tour, "");
  assert.equal(conn.mapping.extra, undefined);
  assert.equal(conn.consecutiveFailures, 2);
  assert.equal(conn.deliveries.length, 2);
  assert.equal(conn.deliveries[0].ok, false);
  assert.equal(conn.lastDelivery.httpStatus, 500);
  assert.equal(JSON.stringify(conn).includes(leaked), false);
  const off = normalizeHubspot({
    token_last4: "99zz",
    connected: false,
    status: "auto_disabled",
    last_delivery: { http_status: 401, created_at: "2026-10-25T12:00:00Z", error: "expired" },
  });
  assert.equal(off.connected, false);
  assert.equal(off.tokenLast4, "99zz");
  assert.equal(off.enabled, false);
  assert.equal(off.autoDisabled, true);
  assert.equal(off.deliveries[0].httpStatus, 401);
});

test("PUT manda enabled e mapping; string vazia desliga; campo intocado fica de fora", () => {
  const saved = planHubspotSave({
    enabled: true,
    values: { email: " email ", tour: "  ", phone: "mobilephone" },
    baseMapping: { email: "email", tour: "guiaflow_tour" },
    dirtyKeys: new Set(["phone", "tour"]),
  });
  assert.deepEqual(saved.body, {
    enabled: true,
    mapping: { email: "email", tour: "", phone: "mobilephone" },
  });
  assert.equal(saved.body.mapping.firstname, undefined);
  assert.equal(saved.body.code, undefined);
  assert.equal(saved.body.authorize, undefined);
  assert.equal(saved.body.remove, undefined);
  assert.equal(saved.body.sendTest, undefined);
  const toggle = planHubspotSave({ enabled: false, values: {}, baseMapping: null, dirtyKeys: [] });
  assert.deepEqual(toggle.body, { enabled: false });
  for (const key of Object.keys(saved.body.mapping)) assert.equal(HUBSPOT_FIELDS.includes(key), true);
});

test("erros: 503 config_missing, 402 abre o Pro, 401 pede sessão", () => {
  assert.equal(hubspotProblem({ ok: true }), "");
  assert.equal(hubspotProblem({ ok: false, status: 503, error: "config_missing" }), "config");
  assert.equal(hubspotProblem({ ok: false, status: 503, error: "http_503" }), "config");
  assert.equal(hubspotProblem({ ok: false, status: 402, error: "subscription_required" }), "paywall");
  assert.equal(hubspotProblem({ ok: false, status: 403, error: "owner_not_pro" }), "paywall");
  assert.equal(hubspotProblem({ ok: false, status: 401, error: "unauthorized" }), "auth");
  assert.equal(hubspotProblem({ ok: false, status: 500, error: "http_500" }), "generic");
});

test("volta do OAuth lê hubspot=connected|error e tira da URL", () => {
  assert.equal(readHubspotReturn("https://guiaflow.pro/editor"), null);
  const ok = readHubspotReturn("https://guiaflow.pro/editor?hubspot=connected&slug=meu-tour");
  assert.deepEqual(ok, { status: "connected", slug: "meu-tour", reason: "" });
  assert.equal(stripHubspotReturn("https://guiaflow.pro/editor?hubspot=connected&slug=meu-tour&pro=1"), "https://guiaflow.pro/editor?pro=1");
  const fail = readHubspotReturn("https://guiaflow.pro/editor?hubspot=error&reason=config_missing&slug=meu-tour");
  assert.equal(fail.status, "error");
  assert.equal(fail.reason, "config_missing");
  assert.equal(hubspotReturnNotice(fail).key, "leads.hubspot.errConfig");
  assert.equal(hubspotReturnNotice(readHubspotReturn("https://guiaflow.pro/editor?hubspot=error&reason=state")).key, "leads.hubspot.errState");
  assert.equal(hubspotReturnNotice(readHubspotReturn("https://guiaflow.pro/editor?hubspot=error&reason=<script>")).key, "leads.hubspot.errReturn");
  assert.equal(hubspotReturnNotice(ok).key, "leads.hubspot.returnOkSlug");
});

test("teste segue o objeto test da fila", () => {
  const failed = normalizeTestResult({ ok: true, test: { delivered: false, status: 401, error: "expired" } });
  assert.equal(failed.ok, false);
  assert.equal(failed.httpStatus, 401);
  const sent = normalizeTestResult({ ok: true, test: { delivered: true, status: 200, error: null } });
  assert.equal(sent.ok, true);
});

test("textos do HubSpot existem em pt, en e es", () => {
  const keys = Object.keys(catalogs.pt).filter((key) => key.startsWith("leads.hubspot."));
  assert.ok(keys.length >= 30, `poucas chaves: ${keys.length}`);
  for (const loc of SUPPORTED_LOCALES) {
    for (const key of keys) {
      const value = catalogs[loc][key];
      assert.equal(typeof value, "string", `${loc} ${key}`);
      assert.ok(value.trim(), `${loc} ${key}`);
      assert.equal(/nuvem|nube|\bcloud\b/i.test(value), false, `${loc} ${key}`);
    }
  }
});
