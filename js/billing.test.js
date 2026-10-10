import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { cloudFetch } from "./cloudConfig.js";
import {
  accountBillingDestination,
  billingMenuModel,
  cancelSubscription,
  classifyCloudGate,
  fetchBillingEntitlement,
  fetchSubscription,
  parseEntitlement,
  parseSubscription,
  readBillingReturn,
  resumeSubscription,
  startAdminHandoff,
  startBillingCheckout,
  startBillingPortal,
  stripBillingReturn,
  subscriptionConflictKey,
  subscriptionScreen,
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
  const success = "https://guiaflow.pro/?welcome=pro&code=handoff-1&tema=1#passo";
  assert.deepEqual(readBillingReturn(success), { kind: "welcome", sessionId: "", code: "handoff-1" });
  assert.equal(stripBillingReturn(success), "https://guiaflow.pro/?tema=1#passo");
  assert.deepEqual(readBillingReturn("https://guiaflow.pro/?checkout=cancel"), {
    kind: "cancel",
    sessionId: "",
    code: "",
  });
  assert.deepEqual(readBillingReturn("https://guiaflow.pro/?checkout=pending"), {
    kind: "pending",
    sessionId: "",
    code: "",
  });
  assert.equal(stripBillingReturn("https://guiaflow.pro/?checkout=pending"), "https://guiaflow.pro/");
  assert.deepEqual(readBillingReturn("https://guiaflow.pro/?billing=success&session_id=cs_test_abc123"), {
    kind: "welcome",
    sessionId: "cs_test_abc123",
    code: "",
  });
  assert.deepEqual(readBillingReturn("https://guiaflow.pro/?billing=portal&session_id=cs_should_not_stick"), {
    kind: "portal",
    sessionId: "",
    code: "",
  });
  assert.equal(stripBillingReturn("https://guiaflow.pro/?billing=portal&session_id=cs_should_not_stick"), "https://guiaflow.pro/");
  assert.deepEqual(readBillingReturn("https://guiaflow.pro/?billing=success&session_id=javascript:alert(1)"), {
    kind: "welcome",
    sessionId: "",
    code: "",
  });
  assert.deepEqual(readBillingReturn("https://guiaflow.pro/?outra=1"), { kind: "", sessionId: "", code: "" });
  assert.equal(readBillingReturn("https://guiaflow.pro/").kind, "");
});

test("entitlement lê plan e status, no corpo ou aninhado", () => {
  assert.deepEqual(parseEntitlement({ plan: "none", status: "none", active: false }), {
    plan: "none",
    status: "none",
    interval: "",
    active: false,
    planSource: null,
    isAdmin: false,
  });
  assert.deepEqual(parseEntitlement({ plan: "pro", status: "active", interval: "annual", active: true }), {
    plan: "pro",
    status: "active",
    interval: "annual",
    active: true,
    planSource: null,
    isAdmin: false,
  });
  assert.deepEqual(parseEntitlement({ entitlement: { plan: "pro", status: "trialing", interval: "month" } }), {
    plan: "pro",
    status: "trialing",
    interval: "monthly",
    active: true,
    planSource: null,
    isAdmin: false,
  });
  assert.equal(parseEntitlement({ plan: "cloud", status: "active" }).plan, "pro");
  assert.equal(parseEntitlement({ plan: "free", status: "none" }).plan, "none");
  assert.equal(parseEntitlement({ plan: "pro", status: "canceled" }).active, true);
  assert.equal(parseEntitlement({ plan: "pro", status: "comp", active: false }).active, true);
  const late = parseEntitlement({ plan: "pro", status: "past_due", interval: "year", active: true });
  assert.equal(late.active, false);
  assert.equal(late.plan, "none");
  assert.equal(late.status, "past_due");
  assert.deepEqual(
    billingMenuModel({ signedIn: true, status: "ready", entitlement: late }),
    { showPlan: true, showAction: true, planLabel: "past_due", action: "portal", showAdmin: false }
  );
});

test("cortesia e superadmin são Pro mesmo sem status do Stripe", () => {
  const comp = parseEntitlement({
    plan: "none",
    status: "none",
    active: false,
    planSource: "comp",
    isAdmin: false,
    user: { planSource: "comp", isAdmin: false },
  });
  assert.equal(comp.active, true);
  assert.equal(comp.plan, "pro");
  assert.equal(comp.planSource, "comp");
  const fromUser = parseEntitlement({ user: { plan: "pro", planSource: "superadmin", isAdmin: true } });
  assert.equal(fromUser.active, true);
  assert.equal(fromUser.planSource, "superadmin");
  assert.equal(fromUser.isAdmin, true);
  assert.equal(parseEntitlement({ user: { isAdmin: true }, plan: "none" }).isAdmin, true);
  assert.deepEqual(
    billingMenuModel({ signedIn: true, status: "ready", entitlement: comp }),
    { showPlan: true, showAction: true, planLabel: "comp", action: "portal", showAdmin: false }
  );
  assert.equal(
    billingMenuModel({ signedIn: true, status: "ready", entitlement: fromUser }).showAdmin,
    true
  );
});

test("o menu esconde o plano quando o billing não está disponível", () => {
  assert.deepEqual(billingMenuModel({ signedIn: true, status: "hidden", entitlement: null }), {
    showPlan: false,
    showAction: false,
    planLabel: "",
    action: "",
    showAdmin: false,
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
    assert.equal(new Headers(checkoutInit.headers).get("authorization"), "Bearer jwt-session");
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

test("o handoff da administração usa a sessão e só aceita https", async () => {
  const seen = [];
  await withFetch(async (url, init) => {
    seen.push({ url: String(url), init });
    const href = String(url);
    if (href.endsWith("/auth/handoff")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          code: "once",
          url: "https://app.guiaflow.pro/admin?code=once",
          expiresInSec: 120,
        }),
      };
    }
    return { ok: false, status: 403, json: async () => ({ ok: false, error: "forbidden" }) };
  }, async () => {
    const handoff = await startAdminHandoff(env);
    assert.equal(handoff.ok, true);
    assert.equal(handoff.url, "https://app.guiaflow.pro/admin?code=once");
    assert.equal(handoff.expiresInSec, 120);
    assert.equal(seen[0].init.method, "POST");
    assert.equal(new Headers(seen[0].init.headers).get("authorization"), "Bearer jwt-session");
  });
  const denied = await withFetch(async () => ({
    ok: false,
    status: 403,
    json: async () => ({ ok: false, error: "forbidden" }),
  }), () => startAdminHandoff(env));
  assert.equal(denied.ok, false);
  assert.equal(denied.status, 403);
  const blocked = await withFetch(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, url: "javascript:alert(1)", code: "x" }),
  }), () => startAdminHandoff(env));
  assert.equal(blocked.ok, false);
  assert.equal(blocked.url, "");
});

const MONTHLY = {
  ok: true,
  plan: "pro",
  planSource: "stripe",
  status: "active",
  interval: "month",
  currency: "brl",
  amount: 36,
  currentPeriodEnd: "2026-11-09T15:00:00.000Z",
  cancelAtPeriodEnd: false,
  compUntil: null,
  canCancel: true,
  canResume: false,
};

test("a tela da assinatura formata preço, data e os estados", () => {
  assert.equal(formatDateCheck(), "9 de novembro de 2026");
  const monthly = subscriptionScreen(MONTHLY, "pt");
  assert.equal(monthly.kind, "paid");
  assert.equal(monthly.planKey, "billing.subPlanMonthly");
  assert.equal(monthly.price, "R$36");
  assert.equal(monthly.priceKey, "billing.monthEquiv");
  assert.equal(monthly.statusKey, "billing.subStatusActive");
  assert.equal(monthly.whenKey, "billing.subRenews");
  assert.equal(monthly.whenDate, "9 de novembro de 2026");
  assert.equal(monthly.canCancel, true);
  assert.equal(monthly.canResume, false);
  assert.equal(monthly.showPortal, true);

  const annual = subscriptionScreen({ ...MONTHLY, interval: "year", amount: 360 }, "pt");
  assert.equal(annual.planKey, "billing.subPlanAnnual");
  assert.equal(annual.price, "R$360");
  assert.equal(annual.priceKey, "billing.yearAmount");

  const usd = subscriptionScreen({ ...MONTHLY, currency: "usd", amount: 7 }, "en");
  assert.equal(usd.price, "US$7");
  const usdYear = subscriptionScreen({ ...MONTHLY, currency: "usd", interval: "year", amount: 70 / 12 }, "en");
  assert.equal(usdYear.price, "US$5.83");
  const usdYearEs = subscriptionScreen({ ...MONTHLY, currency: "usd", interval: "year", amount: 70 / 12 }, "es");
  assert.equal(usdYearEs.price, "US$5,83");

  const scheduled = subscriptionScreen(
    { ...MONTHLY, cancelAtPeriodEnd: true, canCancel: false, canResume: true },
    "pt"
  );
  assert.equal(scheduled.statusKey, "billing.subStatusScheduled");
  assert.equal(scheduled.whenKey, "billing.subAccessUntil");
  assert.equal(scheduled.canCancel, false);
  assert.equal(scheduled.canResume, true);

  const late = subscriptionScreen({ ...MONTHLY, status: "past_due", canCancel: false }, "pt");
  assert.equal(late.statusKey, "billing.pastDue");

  const comp = subscriptionScreen(
    {
      ...MONTHLY,
      plan: "none",
      planSource: "comp",
      amount: null,
      interval: null,
      canCancel: true,
      compUntil: "2026-12-01T15:00:00.000Z",
    },
    "pt"
  );
  assert.equal(comp.kind, "courtesy");
  assert.equal(comp.planKey, "billing.planComp");
  assert.equal(comp.whenKey, "billing.subValidUntil");
  assert.equal(comp.whenDate, "1 de dezembro de 2026");
  assert.equal(comp.canCancel, false);
  assert.equal(comp.showPortal, false);
  assert.equal(comp.price, "");

  const forever = subscriptionScreen(
    { plan: "pro", planSource: "superadmin", status: "active", compUntil: null, canCancel: false },
    "pt"
  );
  assert.equal(forever.kind, "courtesy");
  assert.equal(forever.planKey, "billing.planComp");
  assert.equal(forever.whenKey, "billing.subNoEnd");
  assert.equal(forever.whenDate, "");
  assert.equal(forever.canCancel, false);
  assert.equal(forever.showPortal, false);

  assert.equal(subscriptionScreen({ plan: "none", planSource: null }, "pt").kind, "none");
  assert.equal(parseSubscription({ subscription: MONTHLY }).amount, 36);
  assert.equal(parseSubscription({ amount: "nope" }).amount, null);
});

function formatDateCheck() {
  const screen = subscriptionScreen(MONTHLY, "pt");
  return screen.whenDate;
}

test("o menu Gerenciar assinatura abre a tela, não o portal", () => {
  assert.equal(
    accountBillingDestination({ status: "ready", entitlement: { active: true, status: "active" } }),
    "subscription"
  );
  assert.equal(
    accountBillingDestination({ status: "ready", entitlement: { active: false, status: "past_due" } }),
    "subscription"
  );
  assert.equal(
    accountBillingDestination({ status: "ready", entitlement: { active: false, status: "none" } }),
    "upgrade"
  );
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const start = html.indexOf('id="modal-subscription"');
  const end = html.indexOf("</dialog>", start);
  const dialog = html.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.match(dialog, /Gerenciar assinatura/);
  assert.match(dialog, /Cancelar assinatura/);
  assert.match(dialog, /Manter assinatura/);
  assert.match(dialog, /Pagamento e faturas/);
  assert.match(dialog, /Você ainda não tem o GuiaFlow/);
  assert.equal(/nuvem/i.test(dialog), false);
});

test("cancelar e retomar a assinatura usam os caminhos novos", async () => {
  const seen = [];
  const scheduled = { ...MONTHLY, cancelAtPeriodEnd: true, canCancel: false, canResume: true };
  const resumed = { ...MONTHLY, cancelAtPeriodEnd: false, canCancel: true, canResume: false };
  await withFetch(async (url, init) => {
    seen.push({ url: String(url), method: init?.method, body: init?.body });
    const href = String(url);
    if (href.endsWith("/billing/subscription")) {
      return { ok: true, status: 200, json: async () => MONTHLY };
    }
    if (href.endsWith("/billing/cancel")) {
      return { ok: true, status: 200, json: async () => scheduled };
    }
    if (href.endsWith("/billing/resume")) {
      return { ok: true, status: 200, json: async () => resumed };
    }
    return { ok: false, status: 500, json: async () => ({}) };
  }, async () => {
    const loaded = await fetchSubscription(env);
    assert.equal(loaded.ok, true);
    assert.equal(loaded.subscription.interval, "month");
    assert.equal(loaded.subscription.amount, 36);
    assert.equal(seen[0].url, "https://app.guiaflow.pro/billing/subscription");
    assert.equal(seen[0].method, "GET");

    const canceled = await cancelSubscription(env);
    assert.equal(canceled.subscription.cancelAtPeriodEnd, true);
    assert.equal(seen[1].url, "https://app.guiaflow.pro/billing/cancel");
    assert.equal(seen[1].method, "POST");
    assert.equal(seen[1].body, undefined);

    const kept = await resumeSubscription(env);
    assert.equal(kept.subscription.canResume, false);
    assert.equal(kept.subscription.canCancel, true);
    assert.equal(seen[2].url, "https://app.guiaflow.pro/billing/resume");
    assert.equal(seen[2].method, "POST");
    assert.equal(seen[2].body, undefined);
  });

  await withFetch(async (url) => {
    const href = String(url);
    if (href.endsWith("/billing/cancel")) {
      return { ok: false, status: 409, json: async () => ({ ok: false, error: "cancel_unavailable" }) };
    }
    if (href.endsWith("/billing/resume")) {
      return { ok: false, status: 409, json: async () => ({ ok: false, code: "resume_unavailable" }) };
    }
    return { ok: false, status: 500, json: async () => ({}) };
  }, async () => {
    const denied = await cancelSubscription(env);
    assert.equal(denied.ok, false);
    assert.equal(denied.status, 409);
    assert.equal(denied.error, "cancel_unavailable");
    assert.equal(denied.subscription, null);
    assert.equal(subscriptionConflictKey(denied), "billing.subCancelUnavailable");

    const blocked = await resumeSubscription(env);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.error, "resume_unavailable");
    assert.equal(subscriptionConflictKey(blocked), "billing.subResumeUnavailable");
    assert.equal(subscriptionConflictKey({ status: 500, error: "http_500" }), "");
  });
});
