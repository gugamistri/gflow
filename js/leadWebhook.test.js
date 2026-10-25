import assert from "node:assert/strict";
import test from "node:test";
import { catalogs, SUPPORTED_LOCALES } from "./i18n.js";
import {
  generateWebhookSecret,
  isWebhookSecret,
  normalizeTestResult,
  normalizeWebhook,
  planWebhookSave,
  webhookProblem,
  webhookUrlError,
} from "./leadWebhook.js";

test("URL do webhook: só https público na porta 443", () => {
  assert.equal(webhookUrlError(""), "required");
  assert.equal(webhookUrlError("http://example.com/hook"), "https");
  assert.equal(webhookUrlError("https://user:pw@example.com/hook"), "https");
  assert.equal(webhookUrlError("https://example.com:8443/hook"), "https");
  assert.equal(webhookUrlError("nota-url"), "https");
  assert.equal(webhookUrlError("https://127.0.0.1/hook"), "private");
  assert.equal(webhookUrlError("https://10.1.2.3/hook"), "private");
  assert.equal(webhookUrlError("https://192.168.0.8/hook"), "private");
  assert.equal(webhookUrlError("https://localhost/hook"), "private");
  assert.equal(webhookUrlError("https://facebook.com/hook"), "");
  assert.equal(webhookUrlError("https://example.com/hooks/guiaflow"), "");
});

test("segredo whsec_ gerado ou colado", () => {
  const fake = { getRandomValues(bytes) { bytes.fill(7); return bytes; } };
  const secret = generateWebhookSecret(fake);
  assert.equal(secret, generateWebhookSecret(fake));
  assert.equal(isWebhookSecret(secret), true);
  assert.equal(isWebhookSecret("whsec_curto"), false);
  assert.equal(isWebhookSecret("secreto"), false);
  assert.equal(isWebhookSecret(`  ${secret}  `), true);
});

test("normaliza o GET com ou sem envelope e o teste", () => {
  assert.equal(normalizeWebhook(null), null);
  assert.equal(normalizeWebhook({ webhook: null }), null);
  const hook = normalizeWebhook({
    webhook: {
      url: "https://example.com/hook",
      enabled: true,
      events: ["lead.created", "lead.session_completed"],
      secret_last4: "ab12",
      consecutive_failures: 2,
      last_delivery: { http_status: 500, created_at: "2026-10-25T12:00:00Z", error: "timeout" },
    },
  });
  assert.equal(hook.url, "https://example.com/hook");
  assert.equal(hook.secretLast4, "ab12");
  assert.equal(hook.hasSecret, true);
  assert.deepEqual(hook.events, ["lead.created", "lead.session_completed"]);
  assert.equal(hook.lastDelivery.ok, false);
  assert.equal(hook.lastDelivery.httpStatus, 500);
  assert.equal(normalizeWebhook({ url: "https://example.com/h", enabled: false, secret: "whsec_" + "a".repeat(20) }).enabled, false);
  const sent = normalizeTestResult({ ok: true, delivery: { status: 204, at: "2026-10-25T12:00:00Z" } });
  assert.equal(sent.ok, true);
  assert.equal(sent.httpStatus, 204);
});

test("PUT: cola o segredo, gira sem reenviar o rascunho, recusa URL e segredo ruins", () => {
  const saved = planWebhookSave({
    url: " https://example.com/hook ",
    enabled: true,
    secret: "whsec_" + "b".repeat(20),
    secretDirty: true,
    events: ["lead.created"],
  });
  assert.equal(saved.body.secret.startsWith("whsec_"), true);
  assert.equal(saved.body.rotateSecret, undefined);
  const rotated = planWebhookSave({
    url: "https://example.com/hook",
    enabled: false,
    secret: "whsec_" + "b".repeat(20),
    secretDirty: true,
    rotateSecret: true,
  });
  assert.equal(rotated.body.rotateSecret, true);
  assert.equal(rotated.body.secret, undefined);
  assert.equal(rotated.body.enabled, false);
  assert.equal(planWebhookSave({ url: "http://example.com", secretDirty: false }).error, "https");
  assert.equal(planWebhookSave({ url: "https://example.com/h", secret: "nope", secretDirty: true }).error, "secret");
});

test("erros da API: 402 abre o Pro, 401 pede sessão, SSRF é endereço bloqueado", () => {
  assert.equal(webhookProblem({ ok: true }), "");
  assert.equal(webhookProblem({ ok: false, status: 402, error: "subscription_required" }), "paywall");
  assert.equal(webhookProblem({ ok: false, status: 401, error: "unauthorized" }), "auth");
  assert.equal(webhookProblem({ ok: false, status: 400, error: "ssrf_blocked" }), "private");
  assert.equal(webhookProblem({ ok: false, status: 400, error: "invalid_url" }), "url");
  assert.equal(webhookProblem({ ok: false, status: 500, error: "http_500" }), "generic");
});

test("textos do webhook existem em pt, en e es", () => {
  const keys = Object.keys(catalogs.pt).filter((key) => key.startsWith("leads.webhook."));
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
