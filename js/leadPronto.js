/**
 * Conector LeadPronto da conta (Pro). Contrato da sessão, o mesmo da API v1:
 *   GET  /integrations/leadpronto/start   (Accept: application/json → authorizeUrl)
 *   GET  /integrations/leadpronto         status: config_missing | disconnected | connected | disabled
 *   PUT  /integrations/leadpronto         { tours: null | string[], enabled: boolean }
 *   DELETE /integrations/leadpronto
 * tours null envia todos os tours da conta. A volta do OAuth é
 * /editor?leadpronto=connected ou ?leadpronto=error&reason=…
 * A lista de entregas, quando a API manda, segue a fila do webhook.
 */

import { normalizeDelivery } from "./leadWebhook.js";

export const LP_HELP = {
  pt: "/integracoes#leadpronto",
  en: "/en/integrations#leadpronto",
  es: "/es/integraciones#leadpronto",
};

const STATUSES = new Set(["config_missing", "disconnected", "connected", "disabled"]);
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

export function isTourSlug(value) {
  return SLUG_RE.test(String(value || "").trim().toLowerCase());
}

function firstNumber(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function connectorOf(data) {
  if (!data || typeof data !== "object") return null;
  if (data.leadpronto && typeof data.leadpronto === "object") return data.leadpronto;
  if (data.leadPronto && typeof data.leadPronto === "object") return data.leadPronto;
  if (typeof data.status === "string") return data;
  return null;
}

function tenantName(raw) {
  const value = raw.tenant ?? raw.tenantName ?? raw.tenant_name;
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") return String(value.name || value.title || "").trim();
  return "";
}

/** null = todos os tours. Lista só com slugs publicados. */
export function toursOf(raw) {
  if (!raw || raw.tours == null) return null;
  if (!Array.isArray(raw.tours)) return null;
  const slugs = [];
  const seen = new Set();
  for (const item of raw.tours) {
    const slug = String(item || "").trim().toLowerCase();
    if (!isTourSlug(slug) || seen.has(slug)) continue;
    seen.add(slug);
    slugs.push(slug);
  }
  return slugs;
}

function deliveryFromList(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const row of list) {
    if (!row || typeof row !== "object" || !row.status || row.status === "pending") continue;
    const httpStatus = firstNumber(row.lastStatus, row.last_status);
    const ok = row.status === "delivered";
    out.push({
      ok,
      httpStatus,
      at: String(row.deliveredAt || row.delivered_at || row.createdAt || row.created_at || ""),
      error: ok ? "" : String(row.lastError || row.last_error || row.status || ""),
    });
    if (out.length >= 3) break;
  }
  return out;
}

function deliveriesOf(raw, data) {
  const fromList = deliveryFromList(raw.deliveries);
  if (fromList.length) return fromList;
  const one = normalizeDelivery(raw.lastDelivery || raw.last_delivery || raw.delivery || data?.lastDelivery);
  return one ? [one] : [];
}

/** Estado do GET, ou null quando o corpo não traz um status conhecido. */
export function normalizeLeadPronto(data) {
  const raw = connectorOf(data);
  if (!raw) return null;
  const status = String(raw.status || "").trim();
  if (!STATUSES.has(status)) return null;
  const failures = firstNumber(raw.consecutiveFailures, raw.consecutive_failures, raw.failures);
  const autoDisabled = Boolean(
    raw.autoDisabled || raw.auto_disabled
    || raw.disabledReason === "failures" || raw.disabled_reason === "failures"
  );
  return {
    status,
    tenant: tenantName(raw),
    enabled: status === "connected" && raw.enabled !== false,
    tours: toursOf(raw),
    consecutiveFailures: failures,
    autoDisabled,
    deliveries: deliveriesOf(raw, data),
  };
}

/** URL https (ou http só em localhost) devolvida por GET /start. */
export function readAuthorizeUrl(data) {
  if (!data || typeof data !== "object") return "";
  const nested = data.leadpronto && typeof data.leadpronto === "object" ? data.leadpronto : null;
  const raw = data.authorizeUrl || data.authorize_url || nested?.authorizeUrl || nested?.authorize_url || "";
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    return "";
  }
  const host = url.hostname.toLowerCase();
  const local = host === "localhost" || host === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return "";
  return url.toString();
}

/** { error: "tours" } ou { body } pronto para o PUT. */
export function planLeadProntoSave({ enabled, allTours, tours } = {}) {
  const on = enabled !== false;
  if (allTours) return { body: { enabled: on, tours: null } };
  const slugs = [];
  const seen = new Set();
  for (const item of Array.isArray(tours) ? tours : []) {
    const slug = String(item || "").trim().toLowerCase();
    if (!isTourSlug(slug) || seen.has(slug)) continue;
    seen.add(slug);
    slugs.push(slug);
  }
  if (!slugs.length) return { error: "tours" };
  return { body: { enabled: on, tours: slugs } };
}

/** "paywall" | "auth" | "config" | "tours" | "generic" | "". */
export function leadProntoProblem(res) {
  if (!res || res.ok) return "";
  const code = String(res.error || res.data?.code || res.data?.error || "");
  if (res.status === 402 || code === "subscription_required" || code === "owner_not_pro") return "paywall";
  if (res.status === 401 || code === "unauthorized") return "auth";
  if (res.status === 503 || code === "config_missing" || code === "not_configured" || code === "unavailable") return "config";
  if (/tour/.test(code)) return "tours";
  return "generic";
}

/** Links permanentes da conta (GET /shares/mine) para o seletor de tours. */
export function normalizeShareList(data) {
  const list = Array.isArray(data?.shares) ? data.shares : [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const slug = String(item?.slug || "").trim().toLowerCase();
    if (!isTourSlug(slug) || seen.has(slug)) continue;
    seen.add(slug);
    out.push({ slug, title: String(item?.title || item?.name || "").trim() });
  }
  return out;
}

/** { kind: "connected"|"error", reason } ou null. */
export function readLeadProntoReturn(href) {
  let url;
  try {
    url = new URL(String(href || ""));
  } catch {
    return null;
  }
  const kind = url.searchParams.get("leadpronto");
  if (kind !== "connected" && kind !== "error") return null;
  const reason = kind === "error" ? String(url.searchParams.get("reason") || "").trim() : "";
  return { kind, reason: reason.slice(0, 40) };
}

/** Tira leadpronto e reason da URL do editor. Não mexe em outra query. */
export function stripLeadProntoReturn(href) {
  const url = new URL(String(href || ""));
  if (url.searchParams.get("leadpronto") == null) return url.toString();
  url.searchParams.delete("leadpronto");
  url.searchParams.delete("reason");
  const search = url.searchParams.toString();
  return `${url.origin}${url.pathname}${search ? `?${search}` : ""}${url.hash}`;
}

/** Chave i18n do ?leadpronto=error&reason=… */
export function leadProntoReturnKey(reason) {
  const code = String(reason || "").trim();
  if (code === "state") return "leads.lp.errReturnState";
  if (code === "access_denied") return "leads.lp.errReturnDenied";
  if (code === "config_missing" || code === "unavailable" || code === "config") return "leads.lp.configMissing";
  return "leads.lp.errReturn";
}
