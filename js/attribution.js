/**
 * Medição de aquisição (plano GTM), primeiro-partido e sem PII.
 * - captureAttribution: guarda utm_source/medium/campaign/content da URL em localStorage (90 dias).
 * - sendProductEvent: conta landing_view, editor_started, demo_created e demo_shared na nossa API (sem id de projeto nem slug).
 * - syncAccountAttribution: grava a primeira origem na conta logada (uma vez por e-mail neste navegador).
 * why: LGPD. Nada de terceiros nem cookie; com "Não rastrear" (DNT) ou GPC, nada é guardado nem enviado.
 */
import { privacySignal } from "./viewAnalytics.js";

export const ATTRIBUTION_KEY = "gf-utm-v1";
export const CREATED_KEY = "gf-pe-created-v1";
export const ACCOUNT_SENT_KEY = "gf-utm-account-v1";
export const ATTRIBUTION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const PRODUCT_EVENTS_PATH = "/api/product-events";
export const ACCOUNT_ATTRIBUTION_PATH = "/account/attribution";
export const UTM_KEYS = Object.freeze(["utm_source", "utm_medium", "utm_campaign", "utm_content"]);
/** Eventos que o navegador pode enviar. landing_view e editor_started: uma vez por sessão. */
export const CLIENT_PRODUCT_EVENTS = Object.freeze(["landing_view", "editor_started", "demo_created", "demo_shared"]);
export const SESSION_EVENTS_KEY = "gf-pe-session-v1";
const MAX_CREATED_IDS = 300;

function safeStorage(storage) {
  if (storage) return storage;
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function safeSessionStorage(storage) {
  if (storage) return storage;
  try {
    return typeof sessionStorage !== "undefined" ? sessionStorage : null;
  } catch {
    return null;
  }
}

/** Sinal de privacidade do navegador atual (DNT/GPC). */
export function browserPrivacySignal(nav = typeof navigator !== "undefined" ? navigator : {}, win = typeof window !== "undefined" ? window : {}) {
  return privacySignal({ dnt: nav?.doNotTrack, windowDnt: win?.doNotTrack, msDnt: nav?.msDoNotTrack, gpc: nav?.globalPrivacyControl });
}

/** Mesmo filtro do servidor: minúsculo, [a-z0-9._+-], até 64; e-mail ou número longo vira "". */
export function cleanUtmValue(value) {
  if (typeof value !== "string" || value.includes("@")) return "";
  const v = value.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9._+-]/g, "").slice(0, 64);
  if (!v || /\d{8,}/.test(v)) return "";
  return v;
}

/** UTMs da query string, limpos. null se não houver nenhum. */
export function readUtm(search) {
  let params;
  try {
    params = new URLSearchParams(String(search || ""));
  } catch {
    return null;
  }
  const out = {};
  for (const key of UTM_KEYS) {
    const v = cleanUtmValue(params.get(key) || "");
    if (v) out[key] = v;
  }
  return Object.keys(out).length ? out : null;
}

/** Origem guardada e ainda válida (90 dias), ou null. */
export function getAttribution({ storage, now = Date.now() } = {}) {
  const store = safeStorage(storage);
  if (!store) return null;
  try {
    const data = JSON.parse(store.getItem(ATTRIBUTION_KEY) || "null");
    if (!data || typeof data !== "object") return null;
    if (!Number.isFinite(data.at) || now - data.at > ATTRIBUTION_TTL_MS) {
      store.removeItem(ATTRIBUTION_KEY);
      return null;
    }
    const out = {};
    for (const key of UTM_KEYS) {
      const v = cleanUtmValue(data[key] || "");
      if (v) out[key] = v;
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

/**
 * Guarda os UTMs da URL (último toque com UTM vence; visita sem UTM não apaga).
 * @returns {object|null} a origem válida depois da captura
 */
export function captureAttribution({ search = typeof location !== "undefined" ? location.search : "", storage, now = Date.now(), privacy = browserPrivacySignal() } = {}) {
  const store = safeStorage(storage);
  if (!store || privacy) return null;
  const utm = readUtm(search);
  if (utm) {
    try {
      store.setItem(ATTRIBUTION_KEY, JSON.stringify({ ...utm, at: now }));
    } catch {
      /* storage cheio ou bloqueado: segue sem origem */
    }
  }
  return getAttribution({ storage: store, now });
}

/** Modo do projeto para os eventos: galeria ou guia. */
export function projectMode(project) {
  if (!project || typeof project !== "object") return "";
  return project.playback?.mode === "gallery" ? "galeria" : "guia";
}

/** Só projetos criados há pouco: quem já tinha projetos antes do deploy não vira «demo criada» no próximo save. */
export const CREATED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Projeto conta como demo criada quando é novo, tem passo e não é o tour de exemplo. */
export function isCreatedDemo(project, now = Date.now()) {
  if (!project || typeof project !== "object" || !project.id) return false;
  if (project.stock === true) return false;
  const created = Number(project.createdAt);
  if (!Number.isFinite(created) || now - created > CREATED_WINDOW_MS) return false;
  return Array.isArray(project.steps) && project.steps.length > 0;
}

/** true na primeira vez que este id aparece (e marca). Ids ficam só neste navegador. */
export function markCreatedOnce(id, { storage } = {}) {
  const store = safeStorage(storage);
  if (!store || !id) return false;
  let ids = [];
  try {
    ids = JSON.parse(store.getItem(CREATED_KEY) || "[]");
    if (!Array.isArray(ids)) ids = [];
  } catch {
    ids = [];
  }
  const key = String(id);
  if (ids.includes(key)) return false;
  ids.push(key);
  try {
    store.setItem(CREATED_KEY, JSON.stringify(ids.slice(-MAX_CREATED_IDS)));
  } catch {
    return false;
  }
  return true;
}

/**
 * POST do navegador para a API de medição (landing ou editor). Nunca lança.
 * @param {string} path
 * @param {RequestInit} opts
 * @param {{ fetchImpl?: typeof fetch, cloudBase?: string }} [extra]
 */
export function landingFetchCloud(path, opts = {}, { fetchImpl, cloudBase } = {}) {
  const base = String(
    cloudBase ?? (typeof window !== "undefined" ? window.__GUIAFLOW_CLOUD__ : "") ?? "",
  ).trim().replace(/\/+$/, "");
  if (!base) return Promise.resolve(null);
  const fetchFn = typeof fetchImpl === "function" ? fetchImpl : typeof fetch === "function" ? fetch : null;
  if (!fetchFn) return Promise.resolve(null);
  return fetchFn(`${base}${path}`, {
    method: opts.method || "GET",
    headers: { "content-type": "application/json", accept: "application/json", ...(opts.headers || {}) },
    body: opts.body,
    keepalive: opts.keepalive,
    credentials: "omit",
  });
}

/** true na primeira vez que este evento aparece nesta sessão do navegador (sessionStorage). */
export function markSessionEventOnce(event, { session } = {}) {
  const store = safeSessionStorage(session);
  if (!store || !event) return false;
  let ids = [];
  try {
    ids = JSON.parse(store.getItem(SESSION_EVENTS_KEY) || "[]");
    if (!Array.isArray(ids)) ids = [];
  } catch {
    ids = [];
  }
  const key = String(event);
  if (ids.includes(key)) return false;
  ids.push(key);
  try {
    store.setItem(SESSION_EVENTS_KEY, JSON.stringify(ids));
  } catch {
    return false;
  }
  return true;
}

/**
 * Envia um evento da landing ou do editor. Nunca lança; sem Cloud ou com DNT/GPC não faz nada.
 * @param {"landing_view"|"editor_started"|"demo_created"|"demo_shared"} event
 * @param {{ mode?: string, vertical?: string }} props
 * @param {{ fetchCloud: Function, storage?: Storage, privacy?: boolean }} deps fetchCloud = cloudFetch
 */
export async function sendProductEvent(event, props = {}, { fetchCloud, storage, privacy = browserPrivacySignal() } = {}) {
  if (privacy || typeof fetchCloud !== "function") return false;
  if (!CLIENT_PRODUCT_EVENTS.includes(event)) return false;
  const body = { event };
  if (props.mode) body.mode = props.mode;
  if (props.vertical) body.vertical = props.vertical;
  const utm = getAttribution({ storage });
  if (utm) body.utm = utm;
  try {
    const res = await fetchCloud(PRODUCT_EVENTS_PATH, { method: "POST", body: JSON.stringify(body), keepalive: true, timeoutMs: 8000 });
    return Boolean(res?.ok);
  } catch {
    return false;
  }
}

/** demo_created uma vez por projeto, no primeiro save com passo. */
export function noteDemoSaved(project, deps = {}) {
  if (!isCreatedDemo(project, deps.now ?? Date.now())) return false;
  if (deps.privacy ?? browserPrivacySignal()) return false;
  if (!markCreatedOnce(project.id, deps)) return false;
  void sendProductEvent("demo_created", { mode: projectMode(project) }, deps);
  return true;
}

function noteOncePerSession(event, deps = {}) {
  if (!CLIENT_PRODUCT_EVENTS.includes(event)) return false;
  if (deps.privacy ?? browserPrivacySignal()) return false;
  if (!markSessionEventOnce(event, deps)) return false;
  const fetchCloud = typeof deps.fetchCloud === "function" ? deps.fetchCloud : (path, opts) => landingFetchCloud(path, opts, deps);
  void sendProductEvent(event, {}, { ...deps, fetchCloud });
  return true;
}

/** Visita à landing (pt/en/es), uma vez por sessão do navegador. */
export function noteLandingView(deps = {}) {
  return noteOncePerSession("landing_view", deps);
}

/** Carregamento do editor, uma vez por sessão; distinto de demo_created. */
export function noteEditorStarted(deps = {}) {
  return noteOncePerSession("editor_started", deps);
}

/**
 * Leva a origem do navegador para a conta logada (o servidor guarda só a primeira).
 * @param {{ fetchCloud: Function, account: { signedIn: boolean, email?: string }, storage?: Storage, privacy?: boolean }} deps
 */
export async function syncAccountAttribution({ fetchCloud, account, storage, privacy = browserPrivacySignal() } = {}) {
  if (privacy || typeof fetchCloud !== "function" || !account?.signedIn) return false;
  const store = safeStorage(storage);
  const utm = getAttribution({ storage: store });
  if (!store || !utm) return false;
  const who = String(account.email || "anon").toLowerCase();
  // why: guardamos só um resumo do e-mail para não repetir o POST; nunca o e-mail em si
  const tag = `${who.length}:${[...who].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7).toString(36)}`;
  if (store.getItem(ACCOUNT_SENT_KEY) === tag) return false;
  try {
    const res = await fetchCloud(ACCOUNT_ATTRIBUTION_PATH, { method: "POST", body: JSON.stringify({ utm }), timeoutMs: 8000 });
    if (res?.ok) store.setItem(ACCOUNT_SENT_KEY, tag);
    return Boolean(res?.ok);
  } catch {
    return false;
  }
}
