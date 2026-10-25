/**
 * Webhook de leads do link permanente (Pro).
 * Contrato com a API (sessão do editor):
 *   GET/PUT/DELETE /shares/:slug/webhook
 *   POST /shares/:slug/webhook/test
 *   GET ?reveal=1 devolve o segredo; PUT { rotateSecret: true } gira.
 * O segredo whsec_ pode ser colado ou gerado aqui. A URL só entra em https.
 */

export const WEBHOOK_HELP = {
  pt: "/integracoes#webhook",
  en: "/en/integrations#webhook",
  es: "/es/integraciones#webhook",
};

const SECRET_RE = /^whsec_[A-Za-z0-9+/_=-]{16,200}$/;

export function isWebhookSecret(value) {
  return SECRET_RE.test(String(value || "").trim());
}

/** 24 bytes aleatórios em base64, prefixo whsec_ (Standard Webhooks). */
export function generateWebhookSecret(random = globalThis.crypto) {
  const bytes = new Uint8Array(24);
  if (!random?.getRandomValues) throw new Error("no_crypto");
  random.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `whsec_${btoa(bin)}`;
}

function isPrivateHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host === "0.0.0.0" || host === "::1" || host === "metadata.google.internal") return true;
  if (host.includes(":") && (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80"))) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if ([a, b, Number(m[3]), Number(m[4])].some((n) => n > 255)) return true;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

/** "" se a URL pode ser salva; senão "required" | "https" | "private". */
export function webhookUrlError(raw) {
  const value = String(raw || "").trim();
  if (!value) return "required";
  let url;
  try {
    url = new URL(value);
  } catch {
    return "https";
  }
  if (url.protocol !== "https:" || url.username || url.password) return "https";
  if (url.port && url.port !== "443") return "https";
  if (isPrivateHost(url.hostname)) return "private";
  return "";
}

function firstNumber(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

export function normalizeDelivery(raw) {
  if (!raw || typeof raw !== "object") return null;
  const httpStatus = firstNumber(
    raw.httpStatus,
    raw.http_status,
    raw.statusCode,
    raw.status_code,
    typeof raw.status === "number" ? raw.status : null
  );
  const state = typeof raw.status === "string" ? raw.status : typeof raw.state === "string" ? raw.state : "";
  const ok = typeof raw.delivered === "boolean"
    ? raw.delivered
    : typeof raw.ok === "boolean"
    ? raw.ok
    : raw.success === true || state === "succeeded" || state === "success" || (httpStatus >= 200 && httpStatus < 300);
  const at = raw.at || raw.createdAt || raw.created_at || raw.deliveredAt || raw.delivered_at || "";
  const error = typeof raw.error === "string" ? raw.error : "";
  if (!at && !httpStatus && !error && raw.delivered == null && raw.ok == null && raw.success == null && !state) return null;
  return { ok: Boolean(ok) && !error, httpStatus, at: String(at || ""), error };
}

function last4Of(raw) {
  const hint = String(raw.secretLast4 || raw.secret_last4 || raw.last4 || "").replace(/\W/g, "");
  if (hint) return hint.slice(-4);
  const secret = typeof raw.secret === "string" ? raw.secret : "";
  const tail = secret.startsWith("whsec_") ? secret.slice(6).replace(/\W/g, "") : "";
  return tail.slice(-4);
}

/** Objeto do GET/PUT, ou null quando o link ainda não tem webhook. */
export function normalizeWebhook(data) {
  if (!data || typeof data !== "object") return null;
  const raw = data.webhook === null
    ? null
    : data.webhook && typeof data.webhook === "object"
      ? data.webhook
      : data.url
        ? data
        : null;
  if (!raw) return null;
  const url = String(raw.url || "").trim();
  if (!url) return null;
  const events = Array.isArray(raw.events) ? raw.events.filter((item) => typeof item === "string" && item) : [];
  const failures = firstNumber(raw.consecutiveFailures, raw.consecutive_failures, raw.failures);
  const status = String(raw.status || "");
  return {
    url,
    enabled: raw.enabled !== false && status !== "auto_disabled",
    events: events.length ? events : ["lead.created"],
    hasSecret: Boolean(raw.hasSecret || raw.has_secret || last4Of(raw) || raw.secret),
    secretLast4: last4Of(raw),
    secret: typeof raw.secret === "string" ? raw.secret : "",
    status,
    consecutiveFailures: failures,
    autoDisabled: Boolean(raw.autoDisabled || raw.auto_disabled || status === "auto_disabled" || raw.disabledReason === "failures" || raw.disabled_reason === "failures"),
    lastDelivery: normalizeDelivery(raw.lastDelivery || raw.last_delivery || raw.delivery || data.lastDelivery),
  };
}

export function normalizeTestResult(data) {
  const src = data && typeof data === "object" ? data : {};
  // why: a API responde { ok: true, test: { delivered, status, error } }; o ok de fora só diz que a chamada rodou
  const nested = src.test || src.delivery || src.result;
  return normalizeDelivery(nested && typeof nested === "object" ? { ...src, ...nested } : src);
}

export function webhookSaveBody({ url, enabled, secret, events, rotateSecret } = {}) {
  const body = {
    url: String(url || "").trim(),
    enabled: Boolean(enabled),
    events: Array.isArray(events) && events.length ? events : ["lead.created"],
  };
  if (rotateSecret) body.rotateSecret = true;
  else if (secret) body.secret = String(secret).trim();
  return body;
}

/** { error: "required"|"https"|"private"|"secret" } ou { body } pronto para o PUT. */
export function planWebhookSave({ url, enabled, secret, secretDirty, events, rotateSecret } = {}) {
  const urlError = webhookUrlError(url);
  if (urlError) return { error: urlError };
  if (!rotateSecret && secretDirty && !isWebhookSecret(secret)) return { error: "secret" };
  return {
    body: webhookSaveBody({
      url,
      enabled,
      secret: !rotateSecret && secretDirty ? secret : "",
      events,
      rotateSecret,
    }),
  };
}

/** "paywall" | "auth" | "private" | "url" | "secret" | "generic" | "". */
export function webhookProblem(res) {
  if (!res || res.ok) return "";
  const code = String(res.error || res.data?.code || res.data?.error || "");
  if (res.status === 402 || code === "subscription_required") return "paywall";
  if (res.status === 401 || code === "unauthorized") return "auth";
  if (/ssrf|private|blocked_host|forbidden_host/.test(code)) return "private";
  if (/invalid_url|url_invalid|https_required|bad_url/.test(code)) return "url";
  if (/secret/.test(code)) return "secret";
  return "generic";
}
