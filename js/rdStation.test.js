import assert from "node:assert/strict";
import test from "node:test";
import { catalogs, SUPPORTED_LOCALES } from "./i18n.js";
import {
  normalizeRdStation,
  normalizeTestResult,
  planRdSave,
  rdKeyError,
  rdProblem,
  rdSaveBody,
} from "./rdStation.js";

test("chave: vazio pede a chave; espaço no meio não entra no PUT", () => {
  assert.equal(rdKeyError(""), "required");
  assert.equal(rdKeyError("   "), "required");
  assert.equal(rdKeyError("abc def"), "key");
  assert.equal(rdKeyError("a".repeat(501)), "key");
  assert.equal(rdKeyError("  chave-curta  "), "");
});

test("PUT só manda apiKey e enabled, e omite a chave quando ela não mudou", () => {
  const first = planRdSave({ apiKey: "  publica123  ", enabled: true, connected: false });
  assert.deepEqual(first.body, { apiKey: "publica123", enabled: true });
  assert.equal(first.body.remove, undefined);
  assert.equal(first.body.sendTest, undefined);
  const toggle = planRdSave({ apiKey: "", enabled: false, connected: true });
  assert.deepEqual(toggle.body, { enabled: false });
  assert.equal(planRdSave({ apiKey: "", enabled: true, connected: false }).error, "required");
  assert.equal(planRdSave({ apiKey: "com espaço", enabled: true, connected: false }).error, "key");
  assert.deepEqual(rdSaveBody({ enabled: true }), { enabled: true });
});

test("GET devolve keyLast4 e nunca a chave; sem conector é null", () => {
  assert.equal(normalizeRdStation(null), null);
  assert.equal(normalizeRdStation({ ok: true }), null);
  assert.equal(normalizeRdStation({ rdStation: null }), null);
  const leaked = "super-secreta-nao-mostrar";
  const conn = normalizeRdStation({
    ok: true,
    rdStation: {
      apiKey: leaked,
      keyLast4: "trar",
      enabled: true,
      consecutiveFailures: 2,
      lastDelivery: { delivered: false, status: 422, error: "invalid", at: "2026-10-25T12:00:00Z" },
    },
  });
  assert.equal(conn.keyLast4, "trar");
  assert.equal(conn.hasKey, true);
  assert.equal(conn.enabled, true);
  assert.equal(JSON.stringify(conn).includes(leaked), false);
  assert.equal(conn.lastDelivery.ok, false);
  assert.equal(conn.lastDelivery.httpStatus, 422);
  assert.equal(conn.consecutiveFailures, 2);
  const off = normalizeRdStation({ key_last4: "99zz", enabled: false, status: "auto_disabled" });
  assert.equal(off.keyLast4, "99zz");
  assert.equal(off.enabled, false);
  assert.equal(off.autoDisabled, true);
});

test("teste segue o objeto test do webhook", () => {
  const failed = normalizeTestResult({ ok: true, test: { delivered: false, status: 401, error: "owner_not_pro" } });
  assert.equal(failed.ok, false);
  assert.equal(failed.httpStatus, 401);
  assert.equal(failed.error, "owner_not_pro");
  const sent = normalizeTestResult({ ok: true, test: { delivered: true, status: 200, error: null } });
  assert.equal(sent.ok, true);
  assert.equal(sent.httpStatus, 200);
});

test("erros: 402 e owner_not_pro abrem o Pro, 401 pede sessão, chave inválida é a chave", () => {
  assert.equal(rdProblem({ ok: true }), "");
  assert.equal(rdProblem({ ok: false, status: 402, error: "subscription_required" }), "paywall");
  assert.equal(rdProblem({ ok: false, status: 403, error: "owner_not_pro" }), "paywall");
  assert.equal(rdProblem({ ok: false, status: 401, error: "unauthorized" }), "auth");
  assert.equal(rdProblem({ ok: false, status: 400, error: "invalid_api_key" }), "key");
  assert.equal(rdProblem({ ok: false, status: 500, error: "http_500" }), "generic");
});

test("textos do RD Station existem em pt, en e es", () => {
  const keys = Object.keys(catalogs.pt).filter((key) => key.startsWith("leads.rd."));
  assert.ok(keys.length >= 20, `poucas chaves: ${keys.length}`);
  for (const loc of SUPPORTED_LOCALES) {
    for (const key of keys) {
      const value = catalogs[loc][key];
      assert.equal(typeof value, "string", `${loc} ${key}`);
      assert.ok(value.trim(), `${loc} ${key}`);
      assert.equal(/nuvem|nube|\bcloud\b/i.test(value), false, `${loc} ${key}`);
    }
  }
});
