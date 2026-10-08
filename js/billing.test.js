import assert from "node:assert/strict";
import test from "node:test";
import { cloudFetch } from "./cloudConfig.js";
import {
  billingMenuModel,
  classifyCloudGate,
  fetchBillingEntitlement,
  parseEntitlement,
  readBillingReturn,
  startBillingCheckout,
  startBillingPortal,
  stripBillingReturn,
} from "./billing.js";

const env = { baseUrl: "https://app.guiaflow.pro", accessToken: "jwt-session" };
const GATE_MESSAGE =
  "Disponível no GuiaFlow Cloud. Assine para gerar links permanentes e textos/áudios com IA.";

function withFetch(handler, run) {
  const prev = globalThis.fetch;
  globalThis.fetch = handler;
  return Promise.resolve()
    .then(run)
    .finally(() => {
      if (prev === undefined) delete globalThis.fetch;
      else globalThis.fetch = prev;
    });
}

test("o regresso de billing lê o tipo e limpa a query", () => {
  const success = "https://guiaflow.pro/?welcome=pro&tema=1#passo";
  assert.deepEqual(readBillingReturn(success), { kind: "welcome", sessionId: "" });
  assert.equal(stripBillingReturn(success), "https://guiaflow.pro/?tema=1#passo");
  assert.deepEqual(readBillingReturn("https://guiaflow.pro/?checkout=cancel"), {
    kind: "cancel",
    sessionId: "",
  });
  assert.deepEqual(readBillingReturn("https://guiaflow.pro/?checkout=pending"), {
    kind: "pending",
    sessionId: "",
  });
  assert.equal(stripBillingReturn("https://guiaflow.pro/?checkout=pending"), "https://guiaflow.pro/");
  assert.deepEqual(readBillingReturn("https://guiaflow.pro/?billing=success&session_id=cs_test_abc123"), {
    kind: "welcome",
    sessionId: "cs_test_abc123",
  });
  assert.deepEqual(readBillingReturn("https://guiaflow.pro/?billing=portal&session_id=cs_should_not_stick"), {
    kind: "portal",
    sessionId: "",
  });
  assert.equal(stripBillingReturn("https://guiaflow.pro/?billing=portal&session_id=cs_should_not_stick"), "https://guiaflow.pro/");
  assert.deepEqual(readBillingReturn("https://guiaflow.pro/?billing=success&session_id=javascript:alert(1)"), {
    kind: "welcome",
    sessionId: "",
  });
  assert.deepEqual(readBillingReturn("https://guiaflow.pro/?outra=1"), { kind: "", sessionId: "" });
  assert.equal(readBillingReturn("https://guiaflow.pro/").kind, "");
});

test("entitlement lê plan e status, no corpo ou aninhado", () => {
  assert.deepEqual(parseEntitlement({ plan: "none", status: "none", active: false }), {
    plan: "none",
    status: "none",
    interval: "",
    active: false,
  });
  assert.deepEqual(parseEntitlement({ plan: "pro", status: "active", interval: "annual", active: true }), {
    plan: "pro",
    status: "active",
    interval: "annual",
    active: true,
  });
  assert.deepEqual(parseEntitlement({ entitlement: { plan: "pro", status: "trialing", interval: "month" } }), {
    plan: "pro",
    status: "trialing",
    interval: "monthly",
    active: true,
  });
  assert.equal(parseEntitlement({ plan: "cloud", status: "active" }).plan, "pro");
  assert.equal(parseEntitlement({ plan: "free", status: "none" }).plan, "none");
  assert.equal(parseEntitlement({ plan: "pro", status: "canceled" }).active, false);
  assert.equal(parseEntitlement({ plan: "pro", status: "active", active: false }).active, false);
  assert.equal(parseEntitlement({ subscription: { plan: "pro", status: "past_due", interval: "year" } }).active, true);
});

test("o menu esconde o plano quando o billing não está disponível", () => {
  assert.deepEqual(billingMenuModel({ signedIn: true, status: "hidden", entitlement: null }), {
    showPlan: false,
    showAction: false,
    planLabel: "",
    action: "",
  });
  const guestPlan = billingMenuModel({
    signedIn: true,
    status: "ready",
    entitlement: { plan: "none", active: false },
  });
  assert.equal(guestPlan.action, "checkout");
  assert.equal(guestPlan.showPlan, false);
  assert.equal(guestPlan.planLabel, "none");
  const proPlan = billingMenuModel({
    signedIn: true,
    status: "ready",
    entitlement: { plan: "pro", active: true },
  });
  assert.equal(proPlan.action, "portal");
  assert.equal(proPlan.planLabel, "pro");
  assert.equal(billingMenuModel({ signedIn: false, status: "ready", entitlement: { active: true } }).showPlan, false);
});

test("402 preserva subscription_required e 404 esconde o entitlement", async () => {
  await withFetch(async (url, init) => {
    const href = String(url);
    if (href.endsWith("/shares")) {
      return {
        ok: false,
        status: 402,
        json: async () => ({
          ok: false,
          code: "subscription_required",
          feature: "permanentShare",
          plan: "free",
          message: GATE_MESSAGE,
        }),
      };
    }
    if (href.includes("/billing/entitlement")) {
      return { ok: false, status: 404, json: async () => ({ ok: false }) };
    }
    throw new Error(`unexpected ${href} ${init?.method}`);
  }, async () => {
    const denied = await cloudFetch("/shares", { method: "POST", body: "{}" }, env);
    assert.equal(denied.ok, false);
    assert.equal(denied.status, 402);
    assert.equal(denied.error, "subscription_required");
    assert.equal(denied.message, GATE_MESSAGE);
    const gate = classifyCloudGate(denied);
    assert.deepEqual(gate, {
      kind: "subscription_required",
      feature: "permanentShare",
      plan: "free",
      message: GATE_MESSAGE,
    });
    assert.equal(/nuvem/i.test(gate.message), false);

    const missing = await fetchBillingEntitlement("cs_test_abc", env);
    assert.equal(missing.ok, false);
    assert.equal(missing.status, 404);
    assert.equal(missing.unavailable, true);
    assert.equal(missing.entitlement, null);
    assert.equal(classifyCloudGate({ status: 429, error: "quota_exceeded" }).kind, "quota_exceeded");
    assert.equal(classifyCloudGate({ status: 503 }).kind, "unavailable");
    assert.equal(classifyCloudGate({ status: 401, error: "unauthorized" }).kind, "unauthorized");
  });
});

test("checkout e portal seguem o URL devolvido e mandam o intervalo", async () => {
  const seen = [];
  await withFetch(async (url, init) => {
    seen.push({ url: String(url), init });
    const href = String(url);
    if (href.endsWith("/billing/checkout")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, url: "https://checkout.stripe.com/c/pay/cs_test_page" }),
      };
    }
    if (href.endsWith("/billing/portal")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ portal: { url: "https://billing.stripe.com/p/session/test" } }),
      };
    }
    if (href.includes("/billing/entitlement?session_id=")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, plan: "cloud", status: "active", interval: "annual", active: true }),
      };
    }
    return { ok: false, status: 500, json: async () => ({}) };
  }, async () => {
    const checkout = await startBillingCheckout(
      { interval: "annual", currency: "brl", email: "ana@exemplo.com", source: "tts" },
      env
    );
    assert.equal(checkout.ok, true);
    assert.equal(checkout.url, "https://checkout.stripe.com/c/pay/cs_test_page");
    const checkoutInit = seen[0].init;
    assert.equal(checkoutInit.method, "POST");
    assert.equal(
      checkoutInit.body,
      JSON.stringify({ interval: "year", currency: "brl", email: "ana@exemplo.com", source: "tts" })
    );
    assert.equal(new Headers(checkoutInit.headers).get("authorization"), null);
    assert.equal(checkoutInit.body.includes("price"), false);
    assert.equal(seen[0].url, "https://app.guiaflow.pro/billing/checkout");

    const portal = await startBillingPortal(env);
    assert.equal(portal.url, "https://billing.stripe.com/p/session/test");
    assert.equal(seen[1].init.body, undefined);

    const entitled = await fetchBillingEntitlement("cs_test_abc123", env);
    assert.equal(entitled.entitlement.active, true);
    assert.equal(entitled.entitlement.plan, "pro");
    assert.equal(
      seen[2].url,
      "https://app.guiaflow.pro/billing/entitlement?session_id=cs_test_abc123"
    );

    const blocked = await startBillingCheckout("weekly", env);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error, "invalid_interval");
    assert.equal(seen.length, 3);

    const javascriptUrl = await withFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, url: "javascript:alert(1)" }),
    }), () => startBillingCheckout("monthly", env));
    assert.equal(javascriptUrl.ok, false);
    assert.equal(javascriptUrl.url, "");
  });
});
