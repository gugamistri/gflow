/**
 * Preços e regras do diálogo Pro.
 * why: o editor mostra o valor; o pedido só manda intervalo, moeda e a origem do clique.
 */

export const PAYWALL_FEATURES = ["account", "permanentShare", "analytics", "hostedAi", "tts", "branding"];

export const PAYWALL_PRICES = {
  usd: { month: 7, year: 69 },
  brl: { month: 36, year: 359 },
};

/** Team (convidados e pool de IA/áudio do time) e o convidado extra, que é `quantity` na assinatura. */
export const PAYWALL_TEAM_PRICES = {
  usd: { month: 19, year: 190 },
  brl: { month: 99, year: 990 },
};
export const PAYWALL_SEAT_PRICES = {
  usd: { month: 3, year: 30 },
  brl: { month: 15, year: 150 },
};
export const MAX_EXTRA_GUESTS = 20;

export function normalizeTier(value) {
  return String(value || "").trim().toLowerCase() === "team" ? "team" : "pro";
}

export function normalizeExtraGuests(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, MAX_EXTRA_GUESTS);
}

const FEATURE_ALIASES = {
  account: "account",
  storage: "account",
  local: "account",
  header: "account",
  permanentshare: "permanentShare",
  share: "permanentShare",
  // why: embutir depende do link permanente; não precisa de flag nova no cloudConfig
  embed: "permanentShare",
  cover: "permanentShare",
  // why: passo inicial (leads) e formulário de contato vivem no link permanente
  leads: "permanentShare",
  contactform: "permanentShare",
  analytics: "analytics",
  stats: "analytics",
  hostedai: "hostedAi",
  ai: "hostedAi",
  copy: "hostedAi",
  tts: "tts",
  audio: "tts",
  branding: "branding",
  watermark: "branding",
};

export function normalizePaywallFeature(feature) {
  const key = String(feature || "").trim();
  if (!key) return "";
  return FEATURE_ALIASES[key] || FEATURE_ALIASES[key.toLowerCase()] || "";
}

/** pt do editor é pt-BR. Os outros idiomas veem dólar. */
export function paywallCurrency(locale) {
  return String(locale || "").toLowerCase() === "pt" ? "brl" : "usd";
}

export function paywallOffer(currency, tier = "pro") {
  const code = currency === "brl" ? "brl" : "usd";
  const prices = (normalizeTier(tier) === "team" ? PAYWALL_TEAM_PRICES : PAYWALL_PRICES)[code];
  const fullYear = prices.month * 12;
  const saved = fullYear - prices.year;
  const freeMonths = Math.round(12 - prices.year / prices.month);
  return {
    currency: code,
    tier: normalizeTier(tier),
    seat: PAYWALL_SEAT_PRICES[code],
    month: prices.month,
    year: prices.year,
    monthEquiv: prices.year / 12,
    saved,
    percent: Math.round((saved / fullYear) * 100),
    months: Math.floor(saved / prices.month),
    freeMonths,
    paidMonths: 12 - freeMonths,
  };
}

/** Vírgula em pt e es. Ponto em inglês. */
export function paywallDecimalSeparator(locale) {
  return String(locale || "").toLowerCase() === "en" ? "." : ",";
}

export function formatPaywallAmount(amount, currency, locale) {
  const symbol = currency === "brl" ? "R$" : "US$";
  const value = Number(amount);
  if (!Number.isFinite(value)) return "";
  const rounded = Math.round(value * 100) / 100;
  const whole = Math.round(rounded);
  const text =
    Math.abs(rounded - whole) < 0.001
      ? String(whole)
      : rounded.toFixed(2).replace(".", paywallDecimalSeparator(locale ?? (currency === "brl" ? "pt" : "en")));
  return `${symbol}${text}`;
}

/** O recurso que abriu o diálogo fica no topo. Os outros seguem a ordem fixa. */
export function paywallFeatureOrder(feature) {
  const highlight = normalizePaywallFeature(feature);
  if (!highlight) return [...PAYWALL_FEATURES];
  return [highlight, ...PAYWALL_FEATURES.filter((id) => id !== highlight)];
}

export function checkoutApiInterval(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "year" || raw === "annual" || raw === "yearly") return "year";
  if (raw === "month" || raw === "monthly") return "month";
  return "";
}

export function buildCheckoutBody({ interval, currency, email, source, tier, extraGuests } = {}) {
  const apiInterval = checkoutApiInterval(interval);
  const code = currency === "brl" ? "brl" : currency === "usd" ? "usd" : "";
  if (!apiInterval || !code) return null;
  const body = { interval: apiInterval, currency: code };
  // why: Pro continua com o pedido de sempre; Team manda tier e, se houver, os convidados extras
  if (normalizeTier(tier) === "team") {
    body.tier = "team";
    const extra = normalizeExtraGuests(extraGuests);
    if (extra > 0) body.extraGuests = extra;
  }
  const mail = String(email || "").trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) body.email = mail;
  const src = normalizePaywallFeature(source) || String(source || "").trim();
  if (src) body.source = src;
  return body;
}

export function isSubscriptionRequired(result) {
  const data = result?.data && typeof result.data === "object" ? result.data : {};
  const code = String(result?.error || data.error || data.code || "");
  return Number(result?.status) === 402 || code === "subscription_required";
}

function handoffCode(url) {
  const raw = String(url.searchParams.get("code") || "").trim();
  if (!raw || raw.length > 512) return "";
  return raw;
}

/**
 * Volta do Checkout.
 * Pago: /?welcome=pro&code= (troca em POST /auth/callback, uso único, 2 min).
 * Sem pagamento confirmado: /?checkout=pending. Cancelou: /?checkout=cancel.
 */
export function readBillingReturn(href) {
  const empty = { kind: "", sessionId: "", code: "" };
  let url;
  try {
    url = new URL(String(href || ""), "https://guiaflow.pro/");
  } catch {
    return empty;
  }
  const welcome = url.searchParams.get("welcome") || "";
  const checkout = url.searchParams.get("checkout") || "";
  if (welcome === "pro") return { kind: "welcome", sessionId: "", code: handoffCode(url) };
  if (checkout === "cancel") return { kind: "cancel", sessionId: "", code: "" };
  if (checkout === "pending") return { kind: "pending", sessionId: "", code: "" };
  const billing = url.searchParams.get("billing") || "";
  if (billing === "success") {
    const raw = String(url.searchParams.get("session_id") || "").trim();
    const sessionId = /^cs_[A-Za-z0-9_]+$/.test(raw) && raw.length <= 255 ? raw : "";
    return { kind: "welcome", sessionId, code: "" };
  }
  if (billing === "cancel") return { kind: "cancel", sessionId: "", code: "" };
  if (billing === "portal") return { kind: "portal", sessionId: "", code: "" };
  return empty;
}

export function stripBillingReturn(href) {
  let url;
  try {
    url = new URL(String(href || ""), "https://guiaflow.pro/");
  } catch {
    return String(href || "");
  }
  url.searchParams.delete("welcome");
  url.searchParams.delete("code");
  url.searchParams.delete("checkout");
  url.searchParams.delete("billing");
  url.searchParams.delete("session_id");
  return url.toString();
}

/** Some para quem assina e enquanto o plano ainda não chegou. */
export function shouldShowLocalSave({ signedIn = false, active = false, billingReady = true, dismissed = false } = {}) {
  if (dismissed) return false;
  if (signedIn && active) return false;
  if (signedIn && !billingReady) return false;
  return true;
}
