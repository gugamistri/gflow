/**
 * Ganchos de assinatura do GuiaFlow Cloud.
 * why: o editor só fala com /billing. Preço, Stripe e segredo ficam no companheiro.
 * hazard: o URL de checkout/portal vem da resposta; só seguimos http(s).
 */

import { cloudFetch } from "./cloudConfig.js";
import { buildCheckoutBody, readBillingReturn, stripBillingReturn } from "./paywall.js";

export const BILLING_CHECKOUT_PATH = "/billing/checkout";
export const BILLING_PORTAL_PATH = "/billing/portal";
export const BILLING_ENTITLEMENT_PATH = "/billing/entitlement";

const SESSION_ID_RE = /^cs_[A-Za-z0-9_]+$/;
const SUBSCRIBED_STATUSES = new Set(["active", "trialing"]);

export function emptyEntitlement() {
  return { plan: "none", status: "none", interval: "", active: false };
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

export { readBillingReturn, stripBillingReturn };

function planRank(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "pro" || raw === "cloud" || raw === "paid") return "pro";
  return "none";
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
  if (status === "past_due") {
    return { plan: "none", status: "past_due", interval, active: false };
  }
  let active;
  if (typeof src.active === "boolean") active = src.active;
  else if (typeof src.entitled === "boolean") active = src.entitled;
  else active = plan === "pro" && (status === "" || SUBSCRIBED_STATUSES.has(status));
  if (!active) return { plan: "none", status: status || "none", interval, active: false };
  return { plan: "pro", status: status || "active", interval, active: true };
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
  if (entitlement.status === "past_due") {
    return { showPlan: true, showAction: true, planLabel: "past_due", action: "portal" };
  }
  const active = Boolean(entitlement.active);
  return {
    showPlan: active,
    showAction: true,
    planLabel: active ? "pro" : "none",
    action: active ? "portal" : "checkout",
  };
}

export const HOSTED_TEXT_LIMIT = 100;
export const HOSTED_AUDIO_MINUTES = 30;

/**
 * Caminho da geração. Pro ativo usa a API hospedada mesmo com chave salva.
 * @returns {"byok"|"unavailable"|"login"|"upgrade"|"proceed"}
 */
export function hostedAccess({ cloudEnabled = false, signedIn = false, status = "idle", active = false, hasByok = false } = {}) {
  if (signedIn && status === "ready" && active) return "proceed";
  if (hasByok) return "byok";
  if (!cloudEnabled) return "unavailable";
  if (signedIn && status === "ready" && !active) return "upgrade";
  if (!signedIn) return "upgrade";
  return "proceed";
}

/** Inteligência e Cartesia só aparecem quando o plano não é Pro ativo. */
export function shouldShowByokSettings({ signedIn = false, status = "idle", active = false } = {}) {
  return !(signedIn && status === "ready" && active);
}

/** Selo Pro só quando o clique usaria o plano pago. */
export function shouldShowProBadge({ cloudEnabled = false, signedIn = false, status = "idle", active = false, hasByok = false } = {}) {
  if (!cloudEnabled) return false;
  if (signedIn && status === "ready" && active) return false;
  if (hasByok) return false;
  if (signedIn && status !== "ready") return false;
  return true;
}

function firstFinite(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Limite mensal. Se a resposta trouxer uso, os números entram na frase. */
export function hostedQuotaCopy(feature, usage) {
  const src = usage && typeof usage === "object" ? usage : null;
  if (feature === "tts") {
    const seconds = src ? firstFinite(src.audioSeconds, src.seconds, src.usedSeconds, src.audio?.seconds) : null;
    if (seconds == null) return { key: "billing.quotaTts", vars: {} };
    const limitSec = firstFinite(src.audioLimitSeconds, src.limitSeconds, src.audio?.limitSeconds) ?? HOSTED_AUDIO_MINUTES * 60;
    return {
      key: "billing.quotaTtsUsed",
      vars: {
        used: Math.max(0, Math.round(seconds / 60)),
        limit: Math.max(1, Math.round(limitSec / 60)),
      },
    };
  }
  const used = src ? firstFinite(src.texts, src.textCount, src.textsUsed, src.used, src.count) : null;
  if (used == null) return { key: "billing.quotaAi", vars: {} };
  const limit = firstFinite(src.textLimit, src.limit, src.textsLimit) ?? HOSTED_TEXT_LIMIT;
  return { key: "billing.quotaAiUsed", vars: { used, limit } };
}

/** Números para o menu da conta. Null se a resposta não trouxe uso. */
export function hostedUsageMeters(usage) {
  const src = usage && typeof usage === "object" ? usage : null;
  if (!src) return null;
  const texts = firstFinite(src.texts, src.textCount, src.textsUsed);
  const seconds = firstFinite(src.audioSeconds, src.seconds, src.usedSeconds, src.audio?.seconds);
  if (texts == null && seconds == null) return null;
  const textLimit = firstFinite(src.textLimit, src.textsLimit, src.limit) ?? HOSTED_TEXT_LIMIT;
  const audioLimitSec = firstFinite(src.audioLimitSeconds, src.limitSeconds, src.audio?.limitSeconds) ?? HOSTED_AUDIO_MINUTES * 60;
  return {
    texts,
    textLimit: texts == null ? null : textLimit,
    audioMinutes: seconds == null ? null : Math.max(0, Math.round(seconds / 60)),
    audioLimit: seconds == null ? null : Math.max(1, Math.round(audioLimitSec / 60)),
  };
}

/** Marca no vídeo: quem não assina. Assinante ativo exporta limpo. */
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

export async function startBillingCheckout(input, env) {
  const opts = typeof input === "string" ? { interval: input, currency: "usd" } : { currency: "usd", ...(input || {}) };
  const body = buildCheckoutBody(opts);
  if (!body) return { ok: false, error: "invalid_interval", message: "", unavailable: false };
  const result = await cloudFetch(
    BILLING_CHECKOUT_PATH,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    env
  );
  if (!result.ok) return { ...result, unavailable: unavailableResult(result), url: "" };
  const url = redirectUrl(result.data?.url || result.data?.checkout?.url);
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
