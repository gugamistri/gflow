/**
 * Analytics do visitante no link permanente (/p e embed) — transporte, sem regra de plano.
 * why: sem cookies e sem storage; o sessionId vive só em memória. Com "Não rastrear" (DNT)
 * ou GPC ligado, nada é criado e nenhum request sai. O servidor decide se grava (Pro do dono).
 * Os passos fixos (início/fim) não entram em step_view, então ficam fora do drop-off.
 */

export const FLUSH_MS = 10_000;
export const MAX_BATCH_EVENTS = 32;
export const MAX_BATCH_BYTES = 16 * 1024;
export const MAX_DWELL_MS = 10 * 60 * 1000;
/** Eventos de mídia (vídeo por link). Vão em lote PRÓPRIO: um servidor antigo recusa o lote
 * inteiro quando vê um nome que não conhece — assim só o lote de vídeo cai, o resto do analytics não. */
export const MEDIA_EVENTS = Object.freeze(["video_play", "video_progress"]);
export const VIDEO_KINDS = Object.freeze(["youtube", "vimeo"]);
export const VIDEO_PCTS = Object.freeze([0, 25, 50, 75, 100]);
export const MAX_VIDEO_SEC = 24 * 60 * 60;

/** Navegador pediu para não rastrear (DNT "1"/"yes") ou Global Privacy Control. */
export function privacySignal({ dnt, windowDnt, msDnt, gpc } = {}) {
  const on = (v) => v === "1" || v === 1 || v === "yes" || v === true;
  return on(dnt) || on(windowDnt) || on(msDnt) || gpc === true;
}

/** Só /p, só com a Cloud, nunca com DNT/GPC, nunca na pré-visualização do autor (?preview=1). */
export function shouldTrack({ dnt, windowDnt, msDnt, gpc, kind, cloudEnabled, flags, search } = {}) {
  if (kind !== "permanent") return false;
  if (!cloudEnabled) return false;
  if (flags && flags.analytics === false) return false;
  if (privacySignal({ dnt, windowDnt, msDnt, gpc })) return false;
  if (isPreview(search)) return false;
  return true;
}

export function isPreview(search) {
  try {
    return new URLSearchParams(String(search || "")).get("preview") === "1";
  } catch {
    return false;
  }
}

function clip(value, max) {
  const v = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return v ? v.slice(0, max) : null;
}

/** Origem: só o host do referrer (sem caminho nem query), UTM e nada mais. */
export function trafficSource(referrer, search, origin = "") {
  let referrerHost = null;
  try {
    if (referrer) {
      const url = new URL(referrer);
      const own = origin ? new URL(origin).host : "";
      if ((url.protocol === "https:" || url.protocol === "http:") && url.host !== own) {
        referrerHost = url.hostname.toLowerCase().replace(/^www\./, "") || null;
      }
    }
  } catch {
    referrerHost = null;
  }
  let params;
  try {
    params = new URLSearchParams(String(search || ""));
  } catch {
    params = new URLSearchParams();
  }
  return {
    referrerHost,
    utm_source: clip(params.get("utm_source"), 100),
    utm_medium: clip(params.get("utm_medium"), 100),
    utm_campaign: clip(params.get("utm_campaign"), 100),
  };
}

const LEAD_UTM = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];

/** Campos de origem que o POST do lead leva para o webhook. Omite o que estiver vazio. */
export function leadAttribution(referrer, search, origin = "") {
  const base = trafficSource(referrer, search, origin);
  let params;
  try {
    params = new URLSearchParams(String(search || ""));
  } catch {
    params = new URLSearchParams();
  }
  const out = {};
  if (base.referrerHost) out.referrerHost = base.referrerHost;
  for (const key of LEAD_UTM) {
    const value = key in base ? base[key] : clip(params.get(key), 100);
    if (value) out[key] = value;
  }
  return out;
}

export function deviceKind({ coarse = false, width = 1280 } = {}) {
  return coarse || width < 768 ? "mobile" : "desktop";
}

export function shortLocale(value) {
  const m = /^([a-z]{2})(?:[-_]([A-Za-z]{2}))?/.exec(String(value || ""));
  if (!m) return null;
  return m[2] ? `${m[1]}-${m[2].toUpperCase()}` : m[1];
}

export function uuidV4(random = globalThis.crypto) {
  if (random?.randomUUID) return random.randomUUID();
  const b = new Uint8Array(16);
  random.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Divide eventos em lotes de ≤ 32 eventos e ≤ 16 KB. */
export function chunkEvents(sessionId, events) {
  const out = [];
  let cur = [];
  const size = (list) => JSON.stringify({ v: 1, sessionId, events: list }).length;
  for (const ev of events) {
    const next = [...cur, ev];
    if (cur.length && (next.length > MAX_BATCH_EVENTS || size(next) > MAX_BATCH_BYTES)) {
      out.push(cur);
      cur = [ev];
    } else {
      cur = next;
    }
  }
  if (cur.length) out.push(cur);
  return out.map((list) => JSON.stringify({ v: 1, sessionId, events: list }));
}

/** Transporte padrão: fetch sem cookies (text/plain = sem preflight); beacon na saída. */
export function defaultSender(endpoint) {
  return (body, { beacon = false } = {}) => {
    if (beacon && typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      try {
        if (navigator.sendBeacon(endpoint, body)) return;
      } catch {
        /* cai no fetch */
      }
    }
    try {
      fetch(endpoint, {
        method: "POST",
        body,
        mode: "no-cors",
        keepalive: true,
        credentials: "omit",
        headers: { "Content-Type": "text/plain" },
      }).catch(() => {});
    } catch {
      /* analytics nunca quebra o tour */
    }
  };
}

/**
 * Tracker de uma carga de página. Recebe os ganchos do player (onStep/onComplete/onExit)
 * e os do passo final (CTA). `now` é monotônico (performance.now).
 */
const LANG_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/;
/** { text, audio, cc } do menu de idiomas → campos do evento (nada se o tour não tem idiomas). */
export function langFields(state) {
  if (!state || typeof state !== "object") return {};
  const out = {};
  if (LANG_RE.test(String(state.text || ""))) out.textLang = state.text;
  if (state.audio === "none" || LANG_RE.test(String(state.audio || ""))) out.audioLang = state.audio;
  if (typeof state.cc === "boolean") out.cc = state.cc;
  return out;
}

export function createViewTracker({
  send,
  embed = false,
  source = {},
  device = null,
  locale = null,
  langs = null,
  mediaEvents = true,
  now = () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
  uuid = () => uuidV4(),
  setTimer = (fn, ms) => setInterval(fn, ms),
  clearTimer = (id) => clearInterval(id),
} = {}) {
  const sessionId = uuid();
  const queue = [];
  // why: mídia em fila separada → corpo separado (compatível com servidor que ainda não conhece)
  const mediaQueue = [];
  const mediaOn = mediaEvents !== false;
  const played = new Set();
  const dwell = new Map();
  let current = null; // { index, stepId, since|null }
  let hidden = false;
  let tourStarted = false;
  let leadSent = false;
  let timer = null;
  let disposed = false;

  function push(ev) {
    if (disposed) return;
    queue.push(ev);
    if (!timer) timer = setTimer(() => flush(), FLUSH_MS);
  }

  function flush({ beacon = false } = {}) {
    if (!queue.length && !mediaQueue.length) return 0;
    const batch = queue.splice(0, queue.length);
    // why: o lote principal sai antes — o servidor cria a sessão no 1º lote com session_start
    const bodies = [...chunkEvents(sessionId, batch), ...chunkEvents(sessionId, mediaQueue.splice(0, mediaQueue.length))];
    for (const body of bodies) send(body, { beacon });
    if (timer) {
      clearTimer(timer);
      timer = null;
    }
    return bodies.length;
  }

  function pushMedia(ev) {
    if (disposed || !mediaOn) return;
    mediaQueue.push(ev);
    if (!timer) timer = setTimer(() => flush(), FLUSH_MS);
  }

  function mediaBase({ index, stepId, kind } = {}) {
    if (!Number.isInteger(index) || index < 0 || index > 999) return null;
    if (!VIDEO_KINDS.includes(kind)) return null;
    const id = stepId && /^[\w:.-]{1,80}$/.test(stepId) ? stepId : null;
    return { index, stepId: id, kind };
  }

  function settle() {
    if (!current || current.since == null) return;
    const t = now();
    const add = Math.max(0, t - current.since);
    current.since = t;
    dwell.set(current.index, Math.min(MAX_DWELL_MS, (dwell.get(current.index) || 0) + add));
  }

  function leaveCurrent() {
    if (!current) return;
    settle();
    push({
      name: "step_leave",
      index: current.index,
      stepId: current.stepId,
      dwellMs: Math.round(dwell.get(current.index) || 0),
    });
    current = null;
  }

  push({
    name: "session_start",
    embed: Boolean(embed),
    referrerHost: source.referrerHost || null,
    utm_source: source.utm_source || null,
    utm_medium: source.utm_medium || null,
    utm_campaign: source.utm_campaign || null,
    device,
    locale,
    ...langFields(langs),
  });

  return {
    sessionId,
    get queue() {
      return queue.slice();
    },
    get mediaQueue() {
      return mediaQueue.slice();
    },
    onStep({ index, stepId = null, total = 0 } = {}) {
      if (!Number.isInteger(index) || index < 0) return;
      if (current && current.index === index) return;
      leaveCurrent();
      if (!tourStarted) {
        tourStarted = true;
        push({ name: "tour_start" });
      }
      const id = stepId && /^[\w:.-]{1,80}$/.test(stepId) ? stepId : null;
      push({ name: "step_view", index, stepId: id, total: total > 0 ? Math.min(1000, total) : null });
      current = { index, stepId: id, since: hidden ? null : now() };
    },
    onComplete() {
      leaveCurrent();
      push({ name: "complete" });
      flush();
    },
    onExit({ index, reason = "close" } = {}) {
      leaveCurrent();
      push({ name: "exit", index: Number.isInteger(index) ? index : null, reason });
      flush();
    },
    ctaView() {
      push({ name: "cta_view" });
    },
    ctaClick({ slot = "primary", type = "url" } = {}) {
      push({ name: "cta_click", slot, type });
      flush({ beacon: true });
    },
    /** Visitante trocou idioma de texto/áudio/legenda no menu 🌐 (RF28). */
    langChange(next) {
      const f = langFields(next);
      if (!f.textLang && !f.audioLang) return;
      push({ name: "lang_change", ...f });
    },
    /** Visitante tocou ▶ no vídeo do passo (uma vez por passo na sessão). */
    videoPlay(info) {
      const base = mediaBase(info);
      if (!base || played.has(base.index)) return;
      played.add(base.index);
      pushMedia({ name: "video_play", ...base });
    },
    /** Marco de progresso (25/50/75/100) ou 0 = só o tempo assistido ao sair do passo. */
    videoProgress(info = {}) {
      const base = mediaBase(info);
      if (!base || !VIDEO_PCTS.includes(info.pct)) return;
      const watchedSec = Math.max(0, Math.min(MAX_VIDEO_SEC, Math.round(Number(info.watchedSec) || 0)));
      pushMedia({ name: "video_progress", ...base, pct: info.pct, watchedSec });
      if (info.pct === 100) flush();
    },
    /** Só chamar com o leadId de quem marcou o consentimento no passo inicial. */
    lead(leadId) {
      if (leadSent || !leadId) return;
      leadSent = true;
      push({ name: "lead", leadId: String(leadId).slice(0, 80) });
    },
    /** Aba escondida: pausa o tempo no passo e manda o que tem (beacon). */
    visibility(isHidden) {
      if (isHidden === hidden) return;
      if (isHidden) {
        settle();
        if (current) current.since = null;
        hidden = true;
        flush({ beacon: true });
      } else {
        hidden = false;
        if (current) current.since = now();
      }
    },
    /** Página fechando: fecha o passo aberto como saída "pagehide". */
    pagehide() {
      if (current) {
        const index = current.index;
        leaveCurrent();
        push({ name: "exit", index, reason: "pagehide" });
      }
      flush({ beacon: true });
    },
    flush,
    dispose() {
      disposed = true;
      if (timer) clearTimer(timer);
      timer = null;
    },
  };
}

/** Tipo do CTA para o evento a partir da ação do cartão final. */
export function ctaFromAction(action) {
  if (!action) return { slot: "primary", type: "url" };
  if (action.kind === "whatsapp") return { slot: "primary", type: "whatsapp" };
  if (action.kind === "contact-form") return { slot: "secondary", type: "form" };
  const href = String(action.href || "");
  return { slot: "secondary", type: href.startsWith("mailto:") ? "mailto" : "url" };
}
