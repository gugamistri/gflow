/**
 * Ganchos de assinatura do GuiaFlow Cloud.
 * why: o editor só fala com /billing. Preço, Stripe e segredo ficam no companheiro.
 * hazard: o URL de checkout/portal vem da resposta; só seguimos http(s).
 */

import { cloudFetch } from "./cloudConfig.js";
import { buildCheckoutBody, formatPaywallAmount, paywallCurrency, readBillingReturn, stripBillingReturn } from "./paywall.js";

export const BILLING_CHECKOUT_PATH = "/billing/checkout";
export const BILLING_PORTAL_PATH = "/billing/portal";
export const BILLING_SUBSCRIPTION_PATH = "/billing/subscription";
export const BILLING_CANCEL_PATH = "/billing/cancel";
export const BILLING_RESUME_PATH = "/billing/resume";
export const BILLING_ENTITLEMENT_PATH = "/billing/entitlement";
export const AUTH_ME_PATH = "/auth/me";
export const AUTH_HANDOFF_PATH = "/auth/handoff";

const SESSION_ID_RE = /^cs_[A-Za-z0-9_]+$/;

export function emptyEntitlement() {
  return { plan: "none", status: "none", interval: "", active: false, planSource: null, isAdmin: false };
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

function planSourceOf(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "stripe" || raw === "comp" || raw === "superadmin") return raw;
  return null;
}

function isCourtesySource(source) {
  return source === "comp" || source === "superadmin";
}

/**
 * Plano atual. Aceita o corpo direto ou aninhado em entitlement/subscription.
 * why: o PR de billing devolve plan e status; o aninhamento não pode esconder isso.
 */
export function parseEntitlement(data) {
  const body = data && typeof data === "object" ? data : {};
  const user = body.user && typeof body.user === "object" && !Array.isArray(body.user) ? body.user : {};
  const nested = [body.entitlement, body.subscription].find(
    (value) => value && typeof value === "object" && !Array.isArray(value)
  );
  const src = { ...user, ...body, ...(nested || {}) };
  const planSource = planSourceOf(src.planSource);
  const isAdmin = src.isAdmin === true || user.isAdmin === true;
  const plan = planRank(src.plan ?? src.tier ?? src.product);
  const status = String(src.status ?? "").trim().toLowerCase();
  const interval = normalizeBillingInterval(src.interval);
  const base = { interval, planSource, isAdmin };
  if (isCourtesySource(planSource)) {
    return { ...base, plan: "pro", status: status || "active", active: true };
  }
  if (status === "past_due") {
    return { ...base, plan: "none", status: "past_due", active: false };
  }
  if (plan === "pro") {
    return { ...base, plan: "pro", status: status || "active", active: true };
  }
  let active = false;
  if (typeof src.active === "boolean") active = src.active;
  else if (typeof src.entitled === "boolean") active = src.entitled;
  else active = false;
  if (!active) return { ...base, plan: "none", status: status || "none", active: false };
  return { ...base, plan: "pro", status: status || "active", active: true };
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
  if (!ready) return { showPlan: false, showAction: false, planLabel: "", action: "", showAdmin: false };
  const showAdmin = entitlement.isAdmin === true;
  if (entitlement.status === "past_due" && !entitlement.active) {
    return { showPlan: true, showAction: true, planLabel: "past_due", action: "portal", showAdmin };
  }
  if (entitlement.active && entitlement.planSource === "comp") {
    return { showPlan: true, showAction: true, planLabel: "comp", action: "portal", showAdmin };
  }
  const active = Boolean(entitlement.active);
  return {
    showPlan: active,
    showAction: true,
    planLabel: active ? "pro" : "none",
    action: active ? "portal" : "checkout",
    showAdmin,
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

export async function fetchAccountProfile(env) {
  const result = await cloudFetch(AUTH_ME_PATH, { method: "GET" }, env);
  if (!result.ok) return { ...result, profile: null };
  return { ok: true, status: result.status, profile: parseEntitlement(result.data) };
}

export function mergeAccountAccess(entitlement, profile) {
  const billing = entitlement || emptyEntitlement();
  const me = profile || emptyEntitlement();
  return parseEntitlement({
    plan: me.plan === "pro" ? "pro" : billing.plan,
    status: billing.status || me.status,
    interval: billing.interval || me.interval,
    active: billing.active || me.active,
    planSource: me.planSource || billing.planSource,
    isAdmin: me.isAdmin || billing.isAdmin,
  });
}

export async function startAdminHandoff(env) {
  const result = await cloudFetch(AUTH_HANDOFF_PATH, { method: "POST" }, env);
  if (!result.ok) return { ...result, url: "", code: "" };
  const url = redirectUrl(result.data?.url);
  if (!url || !url.startsWith("https://")) {
    return { ok: false, error: "invalid_response", message: "", url: "", code: "" };
  }
  return {
    ok: true,
    status: result.status,
    url,
    code: typeof result.data?.code === "string" ? result.data.code : "",
    expiresInSec: Number(result.data?.expiresInSec) || 0,
  };
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

/** O item do menu abre a tela. O portal da Stripe fica lá dentro, em pagamento e faturas. */
export function accountBillingDestination({ status = "", entitlement = null } = {}) {
  if (status === "ready" && entitlement && (entitlement.active || entitlement.status === "past_due")) {
    return "subscription";
  }
  return "upgrade";
}

function subscriptionInterval(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "year" || raw === "annual" || raw === "yearly") return "year";
  if (raw === "month" || raw === "monthly") return "month";
  return null;
}

function isoOrEmpty(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  return raw;
}

/** Data longa. Em português, o fuso de São Paulo evita o dia virar na virada do UTC. */
export function formatSubscriptionDate(iso, locale = "pt") {
  const date = new Date(String(iso || ""));
  if (Number.isNaN(date.getTime())) return "";
  const loc = String(locale || "").toLowerCase() === "es" ? "es" : String(locale || "").toLowerCase() === "en" ? "en" : "pt";
  const tag = loc === "es" ? "es-ES" : loc === "en" ? "en-US" : "pt-BR";
  const timeZone = loc === "pt" ? "America/Sao_Paulo" : "UTC";
  return new Intl.DateTimeFormat(tag, { dateStyle: "long", timeZone }).format(date);
}

export function parseSubscription(data) {
  const body = data && typeof data === "object" ? data : {};
  const nested =
    body.subscription && typeof body.subscription === "object" && !Array.isArray(body.subscription)
      ? body.subscription
      : body;
  const planSource = planSourceOf(nested.planSource);
  const courtesy = isCourtesySource(planSource);
  const amountRaw = Number(nested.amount);
  const currencyRaw = String(nested.currency ?? "").trim().toLowerCase();
  return {
    plan: courtesy || planRank(nested.plan) === "pro" ? "pro" : "none",
    planSource,
    status: String(nested.status ?? "").trim().toLowerCase(),
    interval: subscriptionInterval(nested.interval),
    currency: currencyRaw === "brl" || currencyRaw === "usd" ? currencyRaw : "",
    amount: Number.isFinite(amountRaw) ? Math.round(amountRaw) : null,
    currentPeriodEnd: isoOrEmpty(nested.currentPeriodEnd),
    cancelAtPeriodEnd: nested.cancelAtPeriodEnd === true,
    compUntil: isoOrEmpty(nested.compUntil),
    canCancel: nested.canCancel === true,
    canResume: nested.canResume === true,
  };
}

const EMPTY_SUBSCRIPTION_SCREEN = {
  kind: "none",
  planKey: "",
  priceKey: "",
  price: "",
  statusKey: "",
  whenKey: "",
  whenDate: "",
  canCancel: false,
  canResume: false,
  showPortal: false,
};

/** O que a tela mostra. Cortesia não cancela; quem não assina vê o convite do Pro. */
export function subscriptionScreen(data, locale = "pt") {
  const sub = parseSubscription(data);
  if (sub.plan !== "pro") return { ...EMPTY_SUBSCRIPTION_SCREEN };
  if (isCourtesySource(sub.planSource)) {
    const whenDate = sub.compUntil ? formatSubscriptionDate(sub.compUntil, locale) : "";
    return {
      ...EMPTY_SUBSCRIPTION_SCREEN,
      kind: "courtesy",
      planKey: "billing.planComp",
      whenKey: whenDate ? "billing.subValidUntil" : "billing.subNoEnd",
      whenDate,
    };
  }
  const scheduled = sub.cancelAtPeriodEnd;
  const whenDate = sub.currentPeriodEnd ? formatSubscriptionDate(sub.currentPeriodEnd, locale) : "";
  const currency = sub.currency || paywallCurrency(locale);
  let price = "";
  let priceKey = "";
  if (sub.amount != null && (sub.interval === "month" || sub.interval === "year")) {
    price = formatPaywallAmount(sub.amount, currency);
    priceKey = sub.interval === "year" ? "billing.yearAmount" : "billing.monthEquiv";
  }
  const planKey =
    sub.interval === "year" ? "billing.subPlanAnnual" : sub.interval === "month" ? "billing.subPlanMonthly" : "billing.planCloud";
  let statusKey = "billing.subStatusActive";
  if (scheduled) statusKey = "billing.subStatusScheduled";
  else if (sub.status === "past_due") statusKey = "billing.pastDue";
  return {
    kind: "paid",
    planKey,
    priceKey,
    price,
    statusKey,
    whenKey: whenDate ? (scheduled ? "billing.subAccessUntil" : "billing.subRenews") : "",
    whenDate,
    canCancel: sub.canCancel,
    canResume: sub.canResume,
    showPortal: true,
  };
}

async function subscriptionResult(path, method, env) {
  const result = await cloudFetch(path, { method }, env);
  if (!result.ok) return { ...result, subscription: null };
  return { ok: true, status: result.status, subscription: parseSubscription(result.data) };
}

export function fetchSubscription(env) {
  return subscriptionResult(BILLING_SUBSCRIPTION_PATH, "GET", env);
}

export function cancelSubscription(env) {
  return subscriptionResult(BILLING_CANCEL_PATH, "POST", env);
}

export function resumeSubscription(env) {
  return subscriptionResult(BILLING_RESUME_PATH, "POST", env);
}

/** 409 quando cancelar ou retomar não é possível. A tela avisa e busca de novo. */
export function subscriptionConflictKey(result) {
  if (result?.error === "cancel_unavailable") return "billing.subCancelUnavailable";
  if (result?.error === "resume_unavailable") return "billing.subResumeUnavailable";
  return "";
}
