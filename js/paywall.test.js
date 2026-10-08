import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCheckoutBody,
  formatPaywallAmount,
  isSubscriptionRequired,
  paywallCurrency,
  paywallFeatureOrder,
  paywallOffer,
  readBillingReturn,
  shouldShowLocalSave,
  stripBillingReturn,
} from "./paywall.js";

test("pt-BR vê real e os outros idiomas veem dólar", () => {
  assert.equal(paywallCurrency("pt"), "brl");
  assert.equal(paywallCurrency("en"), "usd");
  assert.equal(paywallCurrency("es"), "usd");
  assert.equal(paywallCurrency(""), "usd");
});

test("preços e a economia do anual", () => {
  const usd = paywallOffer("usd");
  assert.equal(formatPaywallAmount(usd.month, "usd"), "US$9");
  assert.equal(formatPaywallAmount(usd.year, "usd"), "US$72");
  assert.equal(formatPaywallAmount(usd.monthEquiv, "usd"), "US$6");
  assert.equal(usd.percent, 33);
  assert.equal(usd.months, 4);

  const brl = paywallOffer("brl");
  assert.equal(formatPaywallAmount(brl.month, "brl"), "R$45");
  assert.equal(formatPaywallAmount(brl.year, "brl"), "R$348");
  assert.equal(formatPaywallAmount(brl.monthEquiv, "brl"), "R$29");
  assert.equal(brl.percent, 36);
  assert.equal(brl.months, 4);
});

test("o recurso que abriu o diálogo fica no topo", () => {
  assert.deepEqual(paywallFeatureOrder(""), [
    "account",
    "permanentShare",
    "hostedAi",
    "tts",
    "branding",
  ]);
  assert.equal(paywallFeatureOrder("tts")[0], "tts");
  assert.equal(paywallFeatureOrder("audio")[0], "tts");
  assert.equal(paywallFeatureOrder("hostedAi")[0], "hostedAi");
  assert.equal(paywallFeatureOrder("branding")[0], "branding");
  assert.equal(paywallFeatureOrder("permanentShare")[0], "permanentShare");
  assert.equal(paywallFeatureOrder("tts").includes("account"), true);
  assert.equal(new Set(paywallFeatureOrder("tts")).size, 5);
});

test("o checkout manda mês ou ano, a moeda e a origem", () => {
  assert.deepEqual(
    buildCheckoutBody({ interval: "annual", currency: "brl", email: "ana@exemplo.com", source: "tts" }),
    { interval: "year", currency: "brl", email: "ana@exemplo.com", source: "tts" }
  );
  assert.deepEqual(buildCheckoutBody({ interval: "month", currency: "usd", source: "hostedAi" }), {
    interval: "month",
    currency: "usd",
    source: "hostedAi",
  });
  assert.equal(buildCheckoutBody({ interval: "weekly", currency: "usd" }), null);
  assert.equal(buildCheckoutBody({ interval: "month", currency: "eur" }), null);
  assert.equal(buildCheckoutBody({ interval: "year", currency: "usd", email: "não é email" }).email, undefined);
});

test("402 de quem não assina abre o caminho do diálogo", () => {
  assert.equal(isSubscriptionRequired({ status: 402, error: "subscription_required" }), true);
  assert.equal(isSubscriptionRequired({ status: 402, data: { error: "subscription_required" } }), true);
  assert.equal(isSubscriptionRequired({ status: 401, error: "invalid_credentials" }), false);
  assert.equal(isSubscriptionRequired({ ok: false, error: "network" }), false);
});

test("welcome troca o code e tira welcome e code do endereço", () => {
  const welcome = "https://guiaflow.pro/?welcome=pro&code=handoff-1&tema=1#passo";
  assert.deepEqual(readBillingReturn(welcome), { kind: "welcome", sessionId: "", code: "handoff-1" });
  assert.equal(stripBillingReturn(welcome), "https://guiaflow.pro/?tema=1#passo");
  assert.equal(readBillingReturn("https://guiaflow.pro/?welcome=pro").code, "");

  const cancel = "https://guiaflow.pro/?checkout=cancel";
  assert.deepEqual(readBillingReturn(cancel), { kind: "cancel", sessionId: "", code: "" });
  assert.equal(stripBillingReturn(cancel), "https://guiaflow.pro/");

  const pending = "https://guiaflow.pro/?checkout=pending";
  assert.deepEqual(readBillingReturn(pending), { kind: "pending", sessionId: "", code: "" });
  assert.equal(pending.includes("code="), false);
  assert.equal(stripBillingReturn(pending), "https://guiaflow.pro/");

  assert.deepEqual(readBillingReturn("https://guiaflow.pro/?billing=success&session_id=cs_test_abc123"), {
    kind: "welcome",
    sessionId: "cs_test_abc123",
    code: "",
  });
  assert.equal(readBillingReturn("https://guiaflow.pro/?checkout=nope").kind, "");
});

test("o aviso de salvar no navegador some para quem assina e para quem dispensou", () => {
  assert.equal(shouldShowLocalSave({ signedIn: false, active: false, billingReady: true, dismissed: false }), true);
  assert.equal(shouldShowLocalSave({ signedIn: true, active: true, billingReady: true }), false);
  assert.equal(shouldShowLocalSave({ signedIn: true, active: false, billingReady: false }), false);
  assert.equal(shouldShowLocalSave({ signedIn: false, dismissed: true }), false);
  assert.equal(shouldShowLocalSave({ signedIn: true, active: false, billingReady: true }), true);
});
