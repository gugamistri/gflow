/**
 * Conector HubSpot do link permanente (Pro).
 * Contrato da sessão (as rotas existem em produção; o corpo segue o OpenAPI v1):
 *   GET/PUT/DELETE /shares/:slug/hubspot
 *   GET /shares/:slug/hubspot/authorize  → { authorizeUrl }
 *   POST /shares/:slug/hubspot/test
 * O PUT manda { enabled, mapping } e, quando o usuário colou um token novo, { token }.
 * O token é o de app privado (pat-…). A string vazia no mapping desliga aquele campo.
 * O GET devolve method (oauth | private_app), tokenLast4 e oauthAvailable.
 * code/state ficam no callback da API, que volta para
 * /editor?hubspot=connected&slug=… ou ?hubspot=error&reason=…
 * 503 config_missing: o app OAuth ainda não está configurado.
 * oauthAvailable false: o editor não oferece OAuth; o token é o caminho.
 */

import { normalizeDelivery, normalizeTestResult } from "./leadWebhook.js";

export const HUBSPOT_HELP = {
  pt: "/integracoes#hubspot",
  en: "/en/integrations#hubspot",
  es: "/es/integraciones#hubspot",
};

/** Chaves do objeto mapping no OpenAPI. Nada fora desta lista entra no PUT. */
export const HUBSPOT_FIELDS = Object.freeze([
  "email",
  "firstname",
  "lastname",
  "phone",
  "tour",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "consentText",
  "consentAt",
]);

const FIELD_SET = new Set(HUBSPOT_FIELDS);
const REASON_RE = /^[A-Za-z0-9_-]{1,40}$/;
/** App privado do HubSpot: pat- + região (na1, eu1, …) + UUID. */
const PRIVATE_APP_TOKEN_RE = /^pat-[a-z]{2}\d-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/** "" se o valor pode ir no PUT; "token" se não é um app privado. Vazio não é erro aqui. */
export function hubspotTokenError(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (value.length > 80 || /\s/.test(value) || !PRIVATE_APP_TOKEN_RE.test(value)) return "token";
  return "";
}

export { normalizeTestResult };

function firstNumber(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function pickString(raw, keys) {
  if (!raw || typeof raw !== "object") return "";
  for (const key of keys) {
    const value = raw[key];
    if (value == null || value === "") continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function tokenLast4Of(raw) {
  const hint = pickString(raw, ["tokenLast4", "token_last4", "accessTokenLast4", "refreshTokenLast4"]);
  return hint.replace(/\s/g, "").slice(-4);
}

function methodOf(...sources) {
  for (const raw of sources) {
    const value = pickString(raw, ["method", "authMethod", "auth_method"]).toLowerCase().replace(/-/g, "_");
    if (value === "oauth" || value === "private_app") return value;
  }
  return "";
}

function boolField(raw, keys) {
  if (!raw || typeof raw !== "object") return undefined;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    const value = raw[key];
    if (value === true || value === false) return value;
    if (value === "true" || value === "false") return value === "true";
  }
  return undefined;
}

function scopesOf(raw) {
  const src = raw?.scopes ?? raw?.scope;
  const list = Array.isArray(src) ? src : typeof src === "string" ? src.split(/[\s,]+/) : [];
  const out = [];
  for (const item of list) {
    const text = String(item || "").trim();
    if (text && !out.includes(text)) out.push(text);
  }
  return out;
}

function accountOf(raw) {
  const label = pickString(raw, [
    "hubDomain",
    "hub_domain",
    "account",
    "accountName",
    "account_name",
    "portalName",
    "portal_name",
    "user",
    "userEmail",
    "user_email",
  ]);
  if (label) return label.slice(0, 120);
  const id = pickString(raw, ["hubId", "hub_id", "portalId", "portal_id"]);
  return id ? id.slice(0, 40) : "";
}

function normalizeMapping(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const mapping = {};
  let any = false;
  for (const key of HUBSPOT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    any = true;
    mapping[key] = String(raw[key] ?? "").trim().slice(0, 200);
  }
  return any ? mapping : null;
}

function normalizeDeliveries(raw, data) {
  const lists = [raw?.deliveries, raw?.recentDeliveries, raw?.lastDeliveries, data?.deliveries];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    return list.map((item) => normalizeDelivery(item)).filter(Boolean).slice(0, 8);
  }
  const one = normalizeDelivery(raw?.lastDelivery || raw?.last_delivery || raw?.delivery || data?.lastDelivery);
  return one ? [one] : [];
}

function connectorOf(data) {
  if (!data || typeof data !== "object") return undefined;
  if (Object.prototype.hasOwnProperty.call(data, "hubspot")) return data.hubspot;
  if (data.tokenLast4 || data.token_last4 || data.connected != null || data.mapping) return data;
  return undefined;
}

/** Conector do GET/PUT, ou null quando o link ainda não tem HubSpot. */
export function normalizeHubspot(data) {
  const raw = connectorOf(data);
  if (!raw || typeof raw !== "object") return null;
  const tokenLast4 = tokenLast4Of(raw);
  const account = accountOf(raw);
  const scopes = scopesOf(raw);
  const mapping = normalizeMapping(raw.mapping);
  const status = String(raw.status || "");
  const failures = firstNumber(raw.consecutiveFailures, raw.consecutive_failures, raw.failures);
  const autoDisabled = Boolean(
    raw.autoDisabled || raw.auto_disabled || status === "auto_disabled"
    || raw.disabledReason === "failures" || raw.disabled_reason === "failures"
  );
  const deliveries = normalizeDeliveries(raw, data);
  const connected = raw.connected === false
    ? false
    : Boolean(raw.connected === true || tokenLast4 || account);
  const method = methodOf(raw, data);
  const has = connected || tokenLast4 || account || mapping || scopes.length || failures > 0
    || deliveries.length > 0 || status || raw.enabled != null || raw.connected != null || autoDisabled || method;
  if (!has) return null;
  return {
    connected,
    enabled: raw.enabled !== false && !autoDisabled,
    method,
    account,
    tokenLast4,
    scopes,
    mapping,
    status,
    consecutiveFailures: failures,
    autoDisabled,
    deliveries,
    lastDelivery: deliveries[0] || null,
  };
}

/** URL http(s) do GET /authorize, ou "". */
export function authorizeUrlOf(data) {
  const raw = data && typeof data === "object" ? data : {};
  const nested = raw.hubspot && typeof raw.hubspot === "object" ? raw.hubspot : {};
  const candidates = [raw.authorizeUrl, raw.authorize_url, nested.authorizeUrl, nested.authorize_url];
  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (!value) continue;
    try {
      const url = new URL(value);
      if (url.protocol === "https:") return url.toString();
    } catch {
      /* ignora o que não é URL */
    }
  }
  return "";
}

/**
 * method e oauthAvailable do GET/PUT, mesmo quando o link ainda não tem conta.
 * oauthAvailable só é true quando o status diz true.
 */
export function readHubspotView(data) {
  const root = data && typeof data === "object" ? data : {};
  const nested = root.hubspot && typeof root.hubspot === "object" ? root.hubspot : null;
  const oauthAvailable = boolField(nested, ["oauthAvailable", "oauth_available"])
    ?? boolField(root, ["oauthAvailable", "oauth_available"])
    ?? false;
  return { hubspot: normalizeHubspot(data), oauthAvailable };
}

/**
 * oauthAvailable false: sem "Conectar"; o token é o caminho principal.
 * oauthAvailable true: "Conectar com HubSpot" e, se o campo ainda está fechado, "usar token".
 * tokenOpen: o usuário pediu o token quando as duas opções existem.
 * method private_app deixa o campo aberto, porque esse já é o método da conta.
 */
export function hubspotConnectMode({ oauthAvailable, method, tokenOpen } = {}) {
  const oauth = oauthAvailable === true;
  const showToken = !oauth || tokenOpen === true || method === "private_app";
  return {
    showConnect: oauth,
    showToken,
    showTokenChoice: oauth && !showToken,
  };
}

/**
 * Corpo do PUT. mapping só leva chaves do OpenAPI.
 * A chave entra com "" quando o usuário apagou ou a API já tinha devolvido vazio.
 * Campo intocado e ausente na API fica de fora, para não desligar o padrão.
 * token só entra quando o usuário colou um app privado válido. O vazio não vai no corpo.
 * requireToken: ainda não há conta e o OAuth não está disponível.
 */
export function planHubspotSave({ enabled, values, baseMapping, dirtyKeys, token, requireToken } = {}) {
  const rawToken = String(token || "").trim();
  if (rawToken) {
    if (hubspotTokenError(rawToken)) return { error: "token" };
  } else if (requireToken) {
    return { error: "required" };
  }
  const body = { enabled: enabled !== false };
  if (rawToken) body.token = rawToken;
  const dirty = dirtyKeys instanceof Set ? dirtyKeys : new Set(dirtyKeys || []);
  const base = baseMapping && typeof baseMapping === "object" ? baseMapping : {};
  const current = values && typeof values === "object" ? values : {};
  const mapping = {};
  let include = false;
  for (const key of HUBSPOT_FIELDS) {
    if (!FIELD_SET.has(key)) continue;
    const fromServer = Object.prototype.hasOwnProperty.call(base, key);
    if (!fromServer && !dirty.has(key)) continue;
    include = true;
    mapping[key] = String(current[key] ?? "").trim().slice(0, 200);
  }
  if (include) body.mapping = mapping;
  return { body };
}

/** "paywall" | "auth" | "config" | "token" | "generic" | "". */
export function hubspotProblem(res) {
  if (!res || res.ok) return "";
  const code = String(res.error || res.data?.code || res.data?.error || "");
  if (res.status === 503 || code === "config_missing") return "config";
  if (res.status === 402 || code === "subscription_required" || code === "owner_not_pro") return "paywall";
  if (res.status === 401 || code === "unauthorized") return "auth";
  if (res.status === 400 && /token/i.test(code) && code !== "unauthorized") return "token";
  return "generic";
}

/** Volta do OAuth na URL do editor, ou null. */
export function readHubspotReturn(href) {
  let url;
  try {
    url = new URL(String(href || ""));
  } catch {
    return null;
  }
  const status = url.searchParams.get("hubspot");
  if (status !== "connected" && status !== "error") return null;
  const slug = String(url.searchParams.get("slug") || "").trim().slice(0, 80);
  const rawReason = status === "error" ? String(url.searchParams.get("reason") || "").trim() : "";
  const reason = REASON_RE.test(rawReason) ? rawReason : rawReason ? "error" : "";
  return { status, slug, reason };
}

/** Tira hubspot, reason e slug da volta. O resto da query fica. */
export function stripHubspotReturn(href) {
  let url;
  try {
    url = new URL(String(href || ""));
  } catch {
    return String(href || "");
  }
  if (!url.searchParams.has("hubspot")) return url.toString();
  url.searchParams.delete("hubspot");
  url.searchParams.delete("reason");
  url.searchParams.delete("slug");
  return url.toString();
}

/** { key, vars, error } para o toast e o status do diálogo. */
export function hubspotReturnNotice(result) {
  if (!result) return null;
  if (result.status === "connected") {
    return result.slug
      ? { key: "leads.hubspot.returnOkSlug", vars: { slug: result.slug }, error: false }
      : { key: "leads.hubspot.returnOk", vars: {}, error: false };
  }
  if (result.reason === "config_missing") return { key: "leads.hubspot.errConfig", vars: {}, error: true };
  if (result.reason === "state") return { key: "leads.hubspot.errState", vars: {}, error: true };
  if (result.reason === "access_denied" || result.reason === "denied") {
    return { key: "leads.hubspot.errDenied", vars: {}, error: true };
  }
  return { key: "leads.hubspot.errReturn", vars: { reason: result.reason || "error" }, error: true };
}
