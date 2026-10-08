/**
 * Ganchos de assinatura do GuiaFlow Cloud.
 * why: o editor só fala com /billing. Preço, Stripe e segredo ficam no companheiro.
 * hazard: o URL de checkout/portal vem da resposta; só seguimos http(s).
 */

import { cloudFetch } from "./cloudConfig.js";

export const BILLING_CHECKOUT_PATH = "/billing/checkout";
export const BILLING_PORTAL_PATH = "/billing/portal";
export const BILLING_ENTITLEMENT_PATH = "/billing/entitlement";

const SESSION_ID_RE = /^cs_[A-Za-z0-9_]+$/;
const SUBSCRIBED_STATUSES = new Set(["active", "trialing", "past_due"]);

export function emptyEntitlement() {
  return { plan: "free", status: "none", interval: "", active: false };
}

/** Intervalo que o checkout aceita. month/year da resposta não voltam no pedido. */
export function checkoutInterval(value) {
  return value === "monthly" || value === "annual" ? value : "";
}

export function normalizeBillingInterval(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "monthly" || raw === "month") return "monthly";
  if (raw === "annual" || raw === "year" || raw === "yearly") return "annual";
  return "";
}

/** session_id do Checkout. Outro valor não segue para o entitlement. */
export function safeCheckoutSessionId(value) {
  const raw = String(value || "").trim();
  if (!SESSION_ID_RE.test(raw) || raw.length > 255) return "";
  return raw;
}

/**
 * Regresso do Checkout e do Portal em guiaflow.pro.
 * @returns {{ kind: "" | "success" | "cancel" | "portal", sessionId: string }}
 */
export function readBillingReturn(href) {
  let url;
  try {
    url = new URL(String(href || ""), "https://guiaflow.pro/");
  } catch {
    return { kind: "", sessionId: "" };
  }
  const billing = url.searchParams.get("billing") || "";
  const kind = billing === "success" || billing === "cancel" || billing === "portal" ? billing : "";
  const sessionId = kind === "success" ? safeCheckoutSessionId(url.searchParams.get("session_id")) : "";
  return { kind, sessionId };
}

/** Tira billing e session_id da barra. O resto da query fica. */
export function stripBillingReturn(href) {
  let url;
  try {
    url = new URL(String(href || ""), "https://guiaflow.pro/");
  } catch {
    return String(href || "");
  }
  url.searchParams.delete("billing");
  url.searchParams.delete("session_id");
  return url.toString();
}

function planRank(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "cloud" || raw === "pro" || raw === "paid") return "cloud";
  return "free";
}

/**
 * Plano atual. Aceita o corpo direto ou aninhado em entitlement/subscription.
 * why: o PR de billing devolve plan e status; o aninhamento não pode esconder isso.
 */
export function parseEntitlement(data) {
  const body = data && typeof data === "object" ? data : {};
  const nested = [body.entitlement, body.subscription].find(
    (value) => value && typeof value === "object" && !Array.isArray(value)
  );
  const src = nested ? { ...body, ...nested } : body;
  const plan = planRank(src.plan ?? src.tier ?? src.product);
  const status = String(src.status ?? "").trim().toLowerCase();
  const interval = normalizeBillingInterval(src.interval);
  let active;
  if (typeof src.active === "boolean") active = src.active;
  else if (typeof src.entitled === "boolean") active = src.entitled;
  else active = plan === "cloud" && (status === "" || SUBSCRIBED_STATUSES.has(status));
  if (!active) return { plan: "free", status: status || "none", interval, active: false };
  return { plan: "cloud", status: status || "active", interval, active: true };
}

/**
 * O que a interface faz com 401, 402, 429 e 503.
 * @returns {{ kind: string, feature: string, plan: string, message: string }}
 */
export function classifyCloudGate(result) {
  const data = result?.data && typeof result.data === "object" ? result.data : {};
  const code = String(result?.error || result?.code || data.code || data.error || "");
  const status = Number(result?.status) || 0;
  const feature = String(data.feature || result?.feature || "");
  const plan = String(data.plan || result?.plan || "");
  const message =
    typeof result?.message === "string" && result.message.trim()
      ? result.message.trim()
      : typeof data.message === "string"
        ? data.message.trim()
        : "";
  let kind = "other";
  if (status === 401 || code === "unauthorized") kind = "unauthorized";
  else if (status === 402 || code === "subscription_required") kind = "subscription_required";
  else if (status === 429 || code === "quota_exceeded") kind = "quota_exceeded";
  else if (status === 503) kind = "unavailable";
  else if (status === 404) kind = "not_found";
  return { kind, feature, plan, message };
}

/** Menu da conta: sem entitlement conhecido, a linha do plano some. */
export function billingMenuModel({ signedIn = false, status = "idle", entitlement = null } = {}) {
  const ready = Boolean(signedIn && status === "ready" && entitlement);
  if (!ready) return { showPlan: false, showAction: false, planLabel: "", action: "" };
  const active = Boolean(entitlement.active);
  return {
    showPlan: true,
    showAction: true,
    planLabel: active ? "cloud" : "free",
    action: active ? "portal" : "checkout",
  };
}

/**
 * Caminho da geração hospedada. BYOK devolve "byok" e fica livre.
 * @returns {"byok"|"unavailable"|"login"|"upgrade"|"proceed"}
 */
export function hostedAccess({ cloudEnabled = false, signedIn = false, status = "idle", active = false, hasByok = false } = {}) {
  if (hasByok) return "byok";
  if (!cloudEnabled) return "unavailable";
  if (!signedIn) return "login";
  if (status === "ready" && active) return "proceed";
  if (status === "ready" && !active) return "upgrade";
  return "proceed";
}

/** Selo Pro só quando o clique usaria o plano pago. */
export function shouldShowProBadge({ cloudEnabled = false, signedIn = false, status = "idle", active = false, hasByok = false } = {}) {
  if (hasByok || !cloudEnabled) return false;
  if (signedIn && status === "ready" && active) return false;
  if (signedIn && status !== "ready") return false;
  return true;
}

/** Marca no vídeo: anônimo e plano grátis. Assinante ativo exporta limpo. */
export function exportShowsWatermark({ cloudEnabled = false, signedIn = false, status = "idle", active = false } = {}) {
  if (!cloudEnabled) return false;
  if (!signedIn) return true;
  if (status === "ready") return !active;
  return false;
}

export function upgradeCopyKeys(feature) {
  if (feature === "hostedAi") return { title: "billing.hostedAiTitle", subtitle: "billing.hostedAiSubtitle" };
  if (feature === "tts") return { title: "billing.ttsTitle", subtitle: "billing.ttsSubtitle" };
  if (feature === "branding") return { title: "billing.brandTitle", subtitle: "billing.brandSubtitle" };
  return { title: "billing.title", subtitle: "billing.message" };
}

export function quotaMessageKey(feature) {
  if (feature === "hostedAi") return "billing.quotaAi";
  if (feature === "tts") return "billing.quotaTts";
  return "billing.quota";
}

function redirectUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

function unavailableResult(result) {
  return Boolean(result && (result.status === 404 || result.status === 503));
}

export async function fetchBillingEntitlement(sessionId, env) {
  const id = safeCheckoutSessionId(sessionId);
  const path = id
    ? `${BILLING_ENTITLEMENT_PATH}?session_id=${encodeURIComponent(id)}`
    : BILLING_ENTITLEMENT_PATH;
  const result = await cloudFetch(path, { method: "GET" }, env);
  if (!result.ok) {
    return { ...result, unavailable: unavailableResult(result), entitlement: null };
  }
  return {
    ok: true,
    status: result.status,
    unavailable: false,
    entitlement: parseEntitlement(result.data),
  };
}

export async function startBillingCheckout(interval, env) {
  const normalized = checkoutInterval(interval);
  if (!normalized) return { ok: false, error: "invalid_interval", message: "", unavailable: false };
  const result = await cloudFetch(
    BILLING_CHECKOUT_PATH,
    {
      method: "POST",
      body: JSON.stringify({ interval: normalized }),
    },
    env
  );
  if (!result.ok) return { ...result, unavailable: unavailableResult(result), url: "" };
  const url = redirectUrl(result.data?.checkout?.url);
  if (!url) return { ok: false, error: "invalid_response", message: "", unavailable: false, url: "" };
  return { ok: true, status: result.status, url, unavailable: false };
}

export async function startBillingPortal(env) {
  const result = await cloudFetch(BILLING_PORTAL_PATH, { method: "POST" }, env);
  if (!result.ok) return { ...result, unavailable: unavailableResult(result), url: "" };
  const url = redirectUrl(result.data?.portal?.url);
  if (!url) return { ok: false, error: "invalid_response", message: "", unavailable: false, url: "" };
  return { ok: true, status: result.status, url, unavailable: false };
}
