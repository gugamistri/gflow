/**
 * Conector RD Station Marketing do link permanente (Pro).
 * Contrato da sessão, igual ao da API v1 (OpenAPI):
 *   GET/PUT/DELETE /shares/:slug/rd-station
 *   POST /shares/:slug/rd-station/test
 * PUT aceita só { apiKey, enabled, remove, sendTest }. A resposta não devolve
 * a chave: o campo é keyLast4. Não há mapeamento nem evento configuráveis.
 * A entrega, quando a API manda, usa o mesmo objeto do webhook (fila compartilhada).
 */

import { normalizeDelivery, normalizeTestResult } from "./leadWebhook.js";

export const RD_HELP = {
  pt: "/integracoes#rd-station",
  en: "/en/integrations#rd-station",
  es: "/es/integraciones#rd-station",
};

export { normalizeTestResult };

/** "" se a chave pode ir no PUT; senão "required" | "key". */
export function rdKeyError(raw) {
  const value = String(raw || "").trim();
  if (!value) return "required";
  if (value.length > 500 || /\s/.test(value)) return "key";
  return "";
}

function last4(raw) {
  const hint = String(raw?.keyLast4 || raw?.key_last4 || "").replace(/\s/g, "");
  return hint.slice(-4);
}

function firstNumber(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function connectorOf(data) {
  if (!data || typeof data !== "object") return undefined;
  if (Object.prototype.hasOwnProperty.call(data, "rdStation")) return data.rdStation;
  if (Object.prototype.hasOwnProperty.call(data, "rd_station")) return data.rd_station;
  if (data.keyLast4 || data.key_last4 || data.hasKey || data.has_key) return data;
  return undefined;
}

/** Conector do GET/PUT, ou null quando o link ainda não tem chave. */
export function normalizeRdStation(data) {
  const raw = connectorOf(data);
  if (!raw || typeof raw !== "object") return null;
  const keyLast4 = last4(raw);
  const hasKey = Boolean(keyLast4 || raw.hasKey || raw.has_key);
  const status = String(raw.status || "");
  const failures = firstNumber(raw.consecutiveFailures, raw.consecutive_failures, raw.failures);
  const autoDisabled = Boolean(
    raw.autoDisabled || raw.auto_disabled || status === "auto_disabled"
    || raw.disabledReason === "failures" || raw.disabled_reason === "failures"
  );
  if (!hasKey && raw.enabled == null && !status && failures === 0 && !autoDisabled) return null;
  return {
    enabled: raw.enabled !== false && !autoDisabled,
    hasKey,
    keyLast4,
    status,
    consecutiveFailures: failures,
    autoDisabled,
    lastDelivery: normalizeDelivery(raw.lastDelivery || raw.last_delivery || raw.delivery || data?.lastDelivery),
  };
}

/** Corpo do PUT. A chave só entra quando o usuário colou uma nova. */
export function rdSaveBody({ apiKey, enabled } = {}) {
  const body = { enabled: enabled !== false };
  const key = String(apiKey || "").trim();
  if (key) body.apiKey = key;
  return body;
}

/** { error: "required"|"key" } ou { body } pronto para o PUT. */
export function planRdSave({ apiKey, enabled, connected } = {}) {
  const key = String(apiKey || "").trim();
  if (key) {
    const err = rdKeyError(key);
    if (err === "key") return { error: "key" };
  } else if (!connected) {
    return { error: "required" };
  }
  return { body: rdSaveBody({ apiKey: key, enabled }) };
}

/** "paywall" | "auth" | "key" | "generic" | "". */
export function rdProblem(res) {
  if (!res || res.ok) return "";
  const code = String(res.error || res.data?.code || res.data?.error || "");
  if (res.status === 402 || code === "subscription_required" || code === "owner_not_pro") return "paywall";
  if (res.status === 401 || code === "unauthorized") return "auth";
  if (/api_?key|invalid_key|key_invalid|missing_key/.test(code)) return "key";
  return "generic";
}
