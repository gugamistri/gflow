/**
 * PostHog no player público (/p e /p?embed=1): só tour_viewed.
 * O tour_lead_captured sai só do servidor (guiaflow-cloud), com o gf_lead_ref que o player
 * gera aqui (newLeadRef) e manda no POST do lead.
 *
 * why: o player roda no site de clientes; não carrega o SDK (nem autocapture, nem replay, nem
 * pesquisas). Um POST direto para /i/v0/e/ com:
 *  - distinct_id = gf_session_id (UUID aleatório por sessão do navegador, em sessionStorage);
 *  - sem identify, sem cookie, sem localStorage, sem perfil ($process_person_profile: false);
 *  - $ip vazio e $geoip_disable (o PostHog não grava o IP do visitante);
 *  - URL sem query.
 * Sem config válida, com DNT/GPC ou na pré-visualização do autor (?preview=1), nada é criado.
 */
import { captureBody, cleanUrl, POSTHOG_CAPTURE_PATH, readPosthogConfig } from "./posthogConfig.js";
import { isPreview, privacySignal, uuidV4 } from "./viewAnalytics.js";

export const GF_SESSION_KEY = "gf.ph.session";
const VIEWED_KEY = (tourId) => `gf.ph.viewed.${tourId}`;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeGet(storage, key) {
  try {
    return storage?.getItem?.(key) ?? null;
  } catch {
    return null;
  }
}

function safeSet(storage, key, value) {
  try {
    storage?.setItem?.(key, value);
    return true;
  } catch {
    return false;
  }
}

/** gf_session_id desta sessão do navegador (cria na primeira vez). Sem storage: só em memória. */
export function readSessionId(storage, random = globalThis.crypto) {
  const stored = safeGet(storage, GF_SESSION_KEY);
  if (stored && UUID_RE.test(stored)) return stored.toLowerCase();
  const fresh = uuidV4(random);
  safeSet(storage, GF_SESSION_KEY, fresh);
  return fresh;
}

/** Host da página que incorpora o tour (só no embed; nunca o caminho). */
export function embedHostOf({ embed, referrer, ancestorOrigins } = {}) {
  if (!embed) return null;
  const candidates = [];
  if (ancestorOrigins && typeof ancestorOrigins.length === "number" && ancestorOrigins.length) {
    candidates.push(ancestorOrigins[0]);
  }
  if (referrer) candidates.push(referrer);
  for (const raw of candidates) {
    try {
      const url = new URL(raw);
      if (url.protocol === "https:" || url.protocol === "http:") return url.hostname.toLowerCase() || null;
    } catch {
      /* próximo */
    }
  }
  return null;
}

export function defaultPosthogSender(url) {
  return (body) => {
    try {
      const res = fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        keepalive: true,
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
      res?.catch?.(() => {});
    } catch {
      /* rede: o funil perde o evento, o tour não */
    }
  };
}

/**
 * opts: { config, storage (sessionStorage), privacy: { dnt, windowDnt, msDnt, gpc }, search,
 *         currentUrl, embed, referrer, ancestorOrigins, send, random, now }
 * → null (nada a medir) ou { sessionId, tourViewed({ tourId, workspaceId }), newLeadRef() }
 */
export function createPlayerPosthog(opts = {}) {
  const config = readPosthogConfig(opts.config);
  if (!config) return null;
  if (privacySignal(opts.privacy || {})) return null;
  if (isPreview(opts.search)) return null;
  const storage = opts.storage || null;
  const random = opts.random || globalThis.crypto;
  const now = opts.now || (() => new Date());
  const send = opts.send || defaultPosthogSender(`${config.host}${POSTHOG_CAPTURE_PATH}`);
  const sessionId = readSessionId(storage, random);
  const embedHost = embedHostOf(opts);
  const currentUrl = cleanUrl(opts.currentUrl || "") || null;

  function base(tourId, workspaceId) {
    const props = {
      tour_id: tourId ? String(tourId) : null,
      workspace_id: workspaceId ? String(workspaceId) : null,
      gf_session_id: sessionId,
      embed_host: embedHost,
      $current_url: currentUrl,
      $lib: "guiaflow-player",
      $ip: "",
      $geoip_disable: true,
      $process_person_profile: false,
    };
    if (workspaceId) props.$groups = { workspace: String(workspaceId) };
    return props;
  }

  function capture(event, properties) {
    send(captureBody(config, { event, distinctId: sessionId, properties, timestamp: now() }));
  }

  return {
    sessionId,
    /** Uma vez por sessão do navegador e por tour. */
    tourViewed({ tourId, workspaceId } = {}) {
      if (!tourId) return false;
      if (safeGet(storage, VIEWED_KEY(tourId))) return false;
      safeSet(storage, VIEWED_KEY(tourId), "1");
      capture("tour_viewed", base(tourId, workspaceId));
      return true;
    },
    newLeadRef() {
      return uuidV4(random);
    },
  };
}
