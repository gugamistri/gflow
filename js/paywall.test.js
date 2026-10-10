import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PAYWALL_PRICES,
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
  assert.equal(formatPaywallAmount(usd.month, "usd", "en"), "US$7");
  assert.equal(formatPaywallAmount(usd.year, "usd", "en"), "US$69");
  assert.equal(formatPaywallAmount(usd.monthEquiv, "usd", "en"), "US$5.75");
  assert.equal(formatPaywallAmount(usd.monthEquiv, "usd", "es"), "US$5,75");
  assert.equal(formatPaywallAmount(usd.monthEquiv, "usd", "pt"), "US$5,75");
  assert.equal(usd.percent, 18);
  assert.equal(usd.months, 2);
  assert.equal(usd.freeMonths, 2);
  assert.equal(usd.paidMonths, 10);

  const brl = paywallOffer("brl");
  assert.equal(formatPaywallAmount(brl.month, "brl", "pt"), "R$36");
  assert.equal(formatPaywallAmount(brl.year, "brl", "pt"), "R$359");
  assert.equal(formatPaywallAmount(brl.monthEquiv, "brl", "pt"), "R$29,92");
  assert.equal(brl.percent, 17);
  assert.equal(brl.months, 2);
  assert.equal(brl.freeMonths, 2);
  assert.equal(brl.paidMonths, 10);
});

test("meses grátis saem do preço anual dividido pelo mensal", () => {
  for (const code of ["brl", "usd"]) {
    const offer = paywallOffer(code);
    const prices = PAYWALL_PRICES[code];
    const freeMonths = Math.round(12 - prices.year / prices.month);
    assert.equal(offer.freeMonths, freeMonths);
    assert.equal(offer.paidMonths, 12 - freeMonths);
  }
  assert.equal(paywallOffer("brl").freeMonths, 2);
  assert.equal(paywallOffer("brl").paidMonths, 10);
  assert.equal(paywallOffer("usd").freeMonths, 2);
  assert.equal(paywallOffer("usd").paidMonths, 10);
});

function cssRules(source) {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("{", i);
    if (open < 0) break;
    let depth = 1;
    let j = open + 1;
    while (j < text.length && depth > 0) {
      if (text[j] === "{") depth += 1;
      else if (text[j] === "}") depth -= 1;
      j += 1;
    }
    const selector = text.slice(i, open).trim();
    const body = text.slice(open + 1, j - 1);
    if (selector.startsWith("@")) {
      rules.push(...cssRules(body));
    } else if (selector) {
      rules.push({ selector, body });
    }
    i = j;
  }
  return rules;
}

test("o diálogo Pro fica oculto até abrir, e os outros modais também", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../css/app.css", import.meta.url), "utf8");
  for (const id of ["modal-upgrade", "modal-subscription", "modal-account"]) {
    const at = html.indexOf(`id="${id}"`);
    const tagStart = html.lastIndexOf("<dialog", at);
    const tag = html.slice(tagStart, html.indexOf(">", tagStart));
    assert.equal(/\sopen(\s|=|$)/.test(tag), false, id);
  }
  const shareAt = html.indexOf('class="export-panel"');
  const shareTag = html.slice(html.lastIndexOf("<details", shareAt), html.indexOf(">", shareAt));
  assert.equal(/\sopen(\s|=|$)/.test(shareTag), false);

  const rules = cssRules(css);
  const closed = rules.find((rule) => rule.selector.replace(/\s/g, "") === "dialog:not([open])");
  assert.ok(closed, "falta a regra que esconde o diálogo fechado");
  assert.match(closed.body, /display:\s*none\s*!important/);

  const openUpgrade = rules.find((rule) => rule.selector.replace(/\s/g, "") === "dialog.upgrade-modal[open]");
  assert.ok(openUpgrade);
  assert.match(openUpgrade.body, /display:\s*flex/);

  for (const rule of rules) {
    const selector = rule.selector.replace(/\s/g, "");
    if (!/(^|,)dialog(?![-\w])/.test(selector)) continue;
    if (selector.includes("[open]") && !selector.includes(":not([open])")) continue;
    assert.equal(/display\s*:\s*(flex|block|grid|inline)/.test(rule.body), false, rule.selector);
  }
});

test("o diálogo começa em Mensal", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const start = html.indexOf('id="modal-upgrade"');
  const end = html.indexOf("</dialog>", start);
  const dialog = html.slice(start, end);
  assert.match(dialog, /name="billing-interval" value="month" checked/);
  assert.equal(/name="billing-interval" value="year" checked/.test(dialog), false);
  assert.match(dialog, /Já é assinante\? Entrar/);
  assert.equal(/Já assino/.test(dialog), false);
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
