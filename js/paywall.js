/**
 * Preços e regras do diálogo Pro.
 * why: o editor mostra o valor; o pedido só manda intervalo, moeda e a origem do clique.
 */

export const PAYWALL_FEATURES = ["account", "permanentShare", "hostedAi", "tts", "branding"];

export const PAYWALL_PRICES = {
  usd: { month: 9, year: 72 },
  brl: { month: 45, year: 348 },
};

const FEATURE_ALIASES = {
  account: "account",
  storage: "account",
  local: "account",
  header: "account",
  permanentshare: "permanentShare",
  share: "permanentShare",
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

export function paywallOffer(currency) {
  const code = currency === "brl" ? "brl" : "usd";
  const prices = PAYWALL_PRICES[code];
  const fullYear = prices.month * 12;
  const saved = fullYear - prices.year;
  return {
    currency: code,
    month: prices.month,
    year: prices.year,
    monthEquiv: prices.year / 12,
    saved,
    percent: Math.round((saved / fullYear) * 100),
    months: Math.floor(saved / prices.month),
  };
}

export function formatPaywallAmount(amount, currency) {
  const symbol = currency === "brl" ? "R$" : "US$";
  const value = Number(amount);
  const text = Number.isInteger(value) ? String(value) : String(Math.round(value));
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

export function buildCheckoutBody({ interval, currency, email, source } = {}) {
  const apiInterval = checkoutApiInterval(interval);
  const code = currency === "brl" ? "brl" : currency === "usd" ? "usd" : "";
  if (!apiInterval || !code) return null;
  const body = { interval: apiInterval, currency: code };
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
