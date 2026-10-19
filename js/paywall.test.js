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
  const html = readFileSync(new URL("../editor.html", import.meta.url), "utf8");
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
  const html = readFileSync(new URL("../editor.html", import.meta.url), "utf8");
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
    "analytics",
    "hostedAi",
    "tts",
    "branding",
  ]);
  assert.equal(paywallFeatureOrder("tts")[0], "tts");
  assert.equal(paywallFeatureOrder("audio")[0], "tts");
  assert.equal(paywallFeatureOrder("hostedAi")[0], "hostedAi");
  assert.equal(paywallFeatureOrder("branding")[0], "branding");
  assert.equal(paywallFeatureOrder("analytics")[0], "analytics");
  assert.equal(paywallFeatureOrder("stats")[0], "analytics");
  assert.equal(paywallFeatureOrder("permanentShare")[0], "permanentShare");
  assert.equal(paywallFeatureOrder("tts").includes("account"), true);
  assert.equal(new Set(paywallFeatureOrder("tts")).size, 6);
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
  // convidado sem plano num projeto colaborativo: as edições vão para a nuvem do dono
  assert.equal(shouldShowLocalSave({ signedIn: true, active: false, billingReady: true, collab: true }), false);
  assert.equal(shouldShowLocalSave({ signedIn: false, active: false, billingReady: true, collab: true }), false);
  assert.equal(shouldShowLocalSave({ signedIn: true, active: false, billingReady: false }), false);
  assert.equal(shouldShowLocalSave({ signedIn: false, dismissed: true }), false);
  assert.equal(shouldShowLocalSave({ signedIn: true, active: false, billingReady: true }), true);
});

test("leads e formulário de contato abrem o paywall do link permanente", async () => {
  const { normalizePaywallFeature } = await import("./paywall.js");
  assert.equal(normalizePaywallFeature("leads"), "permanentShare");
  assert.equal(normalizePaywallFeature("contactForm"), "permanentShare");
});

test("Team: preços, convidado extra e corpo do checkout (Pro não muda)", async () => {
  const { PAYWALL_TEAM_PRICES, PAYWALL_SEAT_PRICES, normalizeExtraGuests, normalizeTier } = await import("./paywall.js");
  assert.deepEqual(PAYWALL_TEAM_PRICES, { usd: { month: 19, year: 190 }, brl: { month: 99, year: 990 } });
  assert.deepEqual(PAYWALL_SEAT_PRICES, { usd: { month: 3, year: 30 }, brl: { month: 15, year: 150 } });
  const team = paywallOffer("usd", "team");
  assert.equal(team.tier, "team");
  assert.equal(team.month, 19);
  assert.equal(team.freeMonths, 2);
  assert.equal(paywallOffer("brl", "team").seat.month, 15);
  assert.equal(paywallOffer("usd").month, 7);
  assert.equal(normalizeTier("TEAM"), "team");
  assert.equal(normalizeTier("x"), "pro");
  assert.equal(normalizeExtraGuests("3"), 3);
  assert.equal(normalizeExtraGuests("99"), 20);
  assert.equal(normalizeExtraGuests("-1"), 0);
  assert.deepEqual(buildCheckoutBody({ interval: "month", currency: "usd" }), { interval: "month", currency: "usd" });
  assert.deepEqual(buildCheckoutBody({ interval: "year", currency: "brl", tier: "team", extraGuests: 2 }), { interval: "year", currency: "brl", tier: "team", extraGuests: 2 });
  assert.deepEqual(buildCheckoutBody({ interval: "month", currency: "usd", tier: "team", extraGuests: 0 }), { interval: "month", currency: "usd", tier: "team" });
  assert.equal("tier" in buildCheckoutBody({ interval: "month", currency: "usd", tier: "pro", extraGuests: 4 }), false);
});

test("diálogo de assinatura: seletor Pro/Team em pt/en/es, coroa só no Pro", () => {
  const html = readFileSync(new URL("../editor.html", import.meta.url), "utf8");
  assert.match(html, /name="billing-tier" value="team"/);
  assert.match(html, /id="paywall-hero-crown"/);
  const i18n = readFileSync(new URL("./i18n.js", import.meta.url), "utf8");
  for (const key of ["billing.teamTitle", "billing.subscribeTeamMonthly", "billing.subscribeTeamAnnual", "billing.tier.team"]) {
    assert.equal(i18n.split(`"${key}"`).length - 1, 3, key);
  }
});

test("diálogo de assinatura: plano e preços antes da lista, e 'Já é assinante' é botão ao lado do CTA", () => {
  const html = readFileSync(new URL("../editor.html", import.meta.url), "utf8");
  const start = html.indexOf('id="modal-upgrade"');
  const dialog = html.slice(start, html.indexOf("</dialog>", start));
  const at = (s) => dialog.indexOf(s);
  assert.ok(at('id="upgrade-tiers"') > 0);
  assert.ok(at('id="upgrade-tiers"') < at('class="upgrade-intervals"'));
  assert.ok(at('class="upgrade-intervals"') < at('id="paywall-benefits"'));
  const footer = dialog.slice(at('class="upgrade-footer"'));
  assert.match(footer, /class="upgrade-actions"[\s\S]*id="btn-upgrade-subscribe"[\s\S]*class="btn paywall-login" id="btn-upgrade-login"/);
  assert.equal(dialog.slice(0, at('class="upgrade-footer"')).includes("btn-upgrade-login"), false);
});

test("diálogo de assinatura não tem mais o campo de convidados extras; o checkout Team omite extraGuests", async () => {
  const html = readFileSync(new URL("../editor.html", import.meta.url), "utf8");
  const start = html.indexOf('id="modal-upgrade"');
  const dialog = html.slice(start, html.indexOf("</dialog>", start));
  assert.equal(/upgrade-extra/.test(dialog), false);
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  assert.equal(/upgrade-extra-input/.test(app), false);
  const { buildCheckoutBody } = await import("./paywall.js");
  const body = buildCheckoutBody({ interval: "monthly", currency: "brl", tier: "team" });
  assert.equal(body.tier, "team");
  assert.equal("extraGuests" in body, false);
  // suporte do corpo continua para quem chamar com número
  assert.equal(buildCheckoutBody({ interval: "monthly", currency: "brl", tier: "team", extraGuests: 2 }).extraGuests, 2);
});

test("assinatura Team: tela mostra convidados extras e setTeamSeats valida o pedido", async () => {
  const { subscriptionScreen, setTeamSeats, teamSeatsErrorKey, parseSubscription } = await import("./billing.js");
  const team = { plan: "pro", tier: "team", status: "active", interval: "month", currency: "brl", amount: 99, extraGuests: 3, canCancel: true };
  const screen = subscriptionScreen(team, "pt");
  assert.equal(screen.team, true);
  assert.equal(screen.extraGuests, 3);
  assert.equal(subscriptionScreen({ ...team, tier: "pro" }, "pt").team, false);
  assert.equal(subscriptionScreen({ ...team, cancelAtPeriodEnd: true }, "pt").team, false);
  assert.equal(parseSubscription({ ...team, extraGuests: 99 }).extraGuests, 20);
  assert.equal((await setTeamSeats(21)).ok, false);
  assert.equal((await setTeamSeats(-1)).error, "invalid_extra_guests");
  assert.equal(teamSeatsErrorKey({ error: "seats_in_use" }), "billing.seats.inUse");
  assert.equal(teamSeatsErrorKey({ error: "stripe_error" }), "billing.seats.fail");
  const html = readFileSync(new URL("../editor.html", import.meta.url), "utf8");
  assert.match(html, /id="subscription-seats"[\s\S]*id="subscription-seats-input"[\s\S]*id="btn-subscription-seats"/);
});
