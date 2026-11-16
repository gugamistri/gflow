/**
 * Configuração única do PostHog (projeto único GuiaFlow + LeadPronto). Sem DOM: editor, player e
 * testes importam daqui. A nuvem espelha o mesmo contrato em guiaflow-cloud apps/api/src/lib/posthog.js.
 *
 * - A chave pública (phc_…) e o host vêm do ambiente (POSTHOG_KEY / POSTHOG_HOST na Vercel), nunca do código.
 *   Sem os dois válidos, readPosthogConfig devolve null e NADA inicializa.
 * - Super property product=guiaflow em todo evento.
 * - Nenhum dado pessoal: sanitizeProperties tira nome, e-mail, telefone e conteúdo de formulário.
 * - URLs vão sem query nem hash (o ?token= do link mágico e o ?lp= nunca saem).
 */

export const POSTHOG_PRODUCT = "guiaflow";
export const POSTHOG_CAPTURE_PATH = "/i/v0/e/";
export const POSTHOG_CONFIG_PATH = "/api/analytics-config";

/** Eventos do funil. tour_viewed sai do player; tour_lead_captured só do servidor (guiaflow-cloud). */
export const FUNNEL_EVENTS = Object.freeze(["tour_viewed", "tour_lead_captured"]);
export const PLAYER_EVENTS = Object.freeze(["tour_viewed"]);

const KEY_RE = /^phc_[A-Za-z0-9_-]{10,}$/;

/** { key, host } ou null. host: só https, sem caminho além de "/", sem query. */
export function readPosthogConfig(raw) {
  if (!raw || typeof raw !== "object") return null;
  const key = typeof raw.key === "string" ? raw.key.trim() : "";
  const hostRaw = typeof raw.host === "string" ? raw.host.trim().replace(/\/+$/, "") : "";
  if (!KEY_RE.test(key) || !hostRaw) return null;
  try {
    const url = new URL(hostRaw);
    if (url.protocol !== "https:" || url.search || url.hash || (url.pathname && url.pathname !== "/")) return null;
    return { key, host: url.origin };
  } catch {
    return null;
  }
}

/** Chaves que nunca saem (nome, e-mail, telefone, mensagem, campos do formulário). */
export const PII_KEY_RE =
  /(^|[_$.-])(e-?mail|phone|telefone|tel|celular|whatsapp|name|nome|first_?name|last_?name|surname|message|mensagem|consent_?text|website|cpf|cnpj|address|endereco|fields?|form|prefill|lead)($|[_.-])/i;
// tag_name: nome da tag HTML no $elements do autocapture (não é nome de pessoa)
const ALLOWED_KEYS = new Set(["gf_lead_ref", "destination", "tag_name"]);
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

export function isPiiKey(key) {
  const k = String(key || "");
  if (ALLOWED_KEYS.has(k)) return false;
  return PII_KEY_RE.test(k);
}

export function looksLikePii(value) {
  if (typeof value !== "string") return false;
  if (EMAIL_RE.test(value)) return true;
  const digits = value.replace(/\D/g, "");
  return /^\+?[\d\s().-]+$/.test(value.trim()) && digits.length >= 8;
}

/** origem + caminho; sem query, hash, usuário ou senha. */
export function cleanUrl(value) {
  if (typeof value !== "string" || !value) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

const URL_KEYS = new Set(["$current_url", "$referrer", "$initial_current_url", "$initial_referrer", "$prev_pageview_pathname"]);

/**
 * Cópia sem PII. Mantém as chaves $ do SDK (exceto $set/$set_once com PII), limpa URLs e descarta
 * valores com cara de e-mail ou telefone. Objetos e listas aninhados passam pela mesma limpeza.
 */
export function sanitizeProperties(props) {
  const out = {};
  if (!props || typeof props !== "object") return out;
  for (const [key, value] of Object.entries(props)) {
    if (isPiiKey(key)) continue;
    if (value === undefined || value === null) continue;
    if (URL_KEYS.has(key)) {
      const clean = cleanUrl(value);
      if (clean) out[key] = clean;
      continue;
    }
    if (Array.isArray(value)) {
      // $elements do autocapture e listas do SDK: itens limpos um a um
      out[key] = value
        .map((item) => (item && typeof item === "object" ? sanitizeProperties(item) : item))
        .filter((item) => !looksLikePii(item));
      continue;
    }
    if (typeof value === "object") {
      const nested = sanitizeProperties(value);
      if (Object.keys(nested).length) out[key] = nested;
      continue;
    }
    if (looksLikePii(value)) continue;
    // qualquer URL (ex.: $initial_person_info.u) sai sem query nem hash
    if (typeof value === "string" && /^https?:\/\//i.test(value)) {
      const clean = cleanUrl(value);
      if (clean) out[key] = clean;
      continue;
    }
    out[key] = value;
  }
  return out;
}

/** Opções do posthog-js no editor (guiaflow.pro/editor). Só pageviews; autocapture, replay, pesquisas e flags desligados. */
export function editorInitOptions(config, { beforeSend } = {}) {
  return {
    api_host: config.host,
    // why: sem script externo (gravação, pesquisas, toolbar); a lib vem de vendor/posthog
    disable_external_dependency_loading: true,
    // why: decisão do Gustavo (16/11): só pageviews no editor, sem cliques
    autocapture: false,
    // defesa extra caso o autocapture seja ligado no futuro
    mask_all_text: true,
    mask_all_element_attributes: true,
    capture_pageview: "history_change",
    capture_pageleave: true,
    disable_session_recording: true,
    disable_surveys: true,
    disable_product_tours: true,
    disable_conversations: true,
    disable_web_experiments: true,
    advanced_disable_flags: true,
    capture_dead_clicks: false,
    capture_heatmaps: false,
    enable_heatmaps: false,
    capture_exceptions: false,
    capture_performance: false,
    rageclick: false,
    // why: sem cookie; o editor já usa o localStorage para funcionar
    persistence: "localStorage",
    person_profiles: "identified_only",
    save_referrer: true,
    respect_dnt: true,
    before_send: beforeSend,
  };
}

/** Evento no formato do POST /i/v0/e/ (player e testes). */
export function captureBody(config, { event, distinctId, properties = {}, timestamp = new Date() }) {
  return {
    api_key: config.key,
    event,
    distinct_id: String(distinctId),
    timestamp: (timestamp instanceof Date ? timestamp : new Date(timestamp)).toISOString(),
    properties: { ...sanitizeProperties(properties), product: POSTHOG_PRODUCT },
  };
}
