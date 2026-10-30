/**
 * Vídeo do passo por LINK (YouTube ou Vimeo). Sem upload e sem armazenamento: o passo guarda só
 * `step.video = { kind, id, h?, durationSec? }` e um pôster nosso (WebP) em `step.image`.
 * why: capa, miniaturas, exportação, validação e players antigos continuam lendo `step.image`
 *      (mostram o pôster); só o player novo troca o pôster pelo vídeo, e só depois do clique.
 * JS puro (sem DOM): editor, players e API usam as mesmas regras.
 */

export const VIDEO_KINDS = Object.freeze(["youtube", "vimeo"]);
export const VIDEO_PROVIDER_LABELS = Object.freeze({ youtube: "YouTube", vimeo: "Vimeo" });
/** Origens que o player carrega no iframe (a CSP do /v libera só estas em frame-src). */
export const VIDEO_FRAME_ORIGINS = Object.freeze({
  youtube: "https://www.youtube-nocookie.com",
  vimeo: "https://player.vimeo.com",
});
/** Marcos de progresso do analytics (%). */
export const VIDEO_MILESTONES = Object.freeze([25, 50, 75, 100]);
export const VIDEO_MAX_DURATION_SEC = 24 * 60 * 60;

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{1,12}$/;
/** Hash de vídeo "não listado" do Vimeo (vimeo.com/ID/HASH ou ?h=HASH). */
const VIMEO_HASH = /^[0-9a-f]{6,32}$/i;
const YT_HOSTS = new Set(["youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com"]);

function toUrl(input) {
  const raw = String(input ?? "").trim();
  if (!raw || raw.length > 2048 || /\s/.test(raw)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw.replace(/^\/\//, "")}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url;
  } catch {
    return null;
  }
}

function hostOf(url) {
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

function parseYoutube(url) {
  const host = hostOf(url);
  const parts = url.pathname.split("/").filter(Boolean);
  if (host === "youtu.be") {
    return YT_ID.test(parts[0] || "") ? { kind: "youtube", id: parts[0] } : null;
  }
  if (!YT_HOSTS.has(host)) return null;
  if (parts[0] === "watch" || (!parts.length && url.searchParams.has("v"))) {
    const id = url.searchParams.get("v") || "";
    return YT_ID.test(id) ? { kind: "youtube", id } : null;
  }
  if (["embed", "shorts", "live", "v", "e"].includes(parts[0]) && YT_ID.test(parts[1] || "")) {
    return { kind: "youtube", id: parts[1] };
  }
  return null;
}

function parseVimeo(url) {
  const host = hostOf(url);
  const parts = url.pathname.split("/").filter(Boolean);
  const queryHash = url.searchParams.get("h") || "";
  const withHash = (id, h) => {
    const out = { kind: "vimeo", id };
    if (h && VIMEO_HASH.test(h)) out.h = h.toLowerCase();
    return out;
  };
  if (host === "player.vimeo.com") {
    if (parts[0] === "video" && VIMEO_ID.test(parts[1] || "")) return withHash(parts[1], queryHash);
    return null;
  }
  if (host !== "vimeo.com") return null;
  // vimeo.com/ID, vimeo.com/ID/HASH, vimeo.com/channels/x/ID, vimeo.com/groups/x/videos/ID,
  // vimeo.com/showcase/x/video/ID, vimeo.com/album/x/video/ID
  if (VIMEO_ID.test(parts[0] || "")) return withHash(parts[0], parts[1] || queryHash);
  for (let i = parts.length - 1; i >= 1; i -= 1) {
    if (VIMEO_ID.test(parts[i]) && ["channels", "groups", "showcase", "album"].includes(parts[0])) {
      return withHash(parts[i], queryHash);
    }
  }
  return null;
}

/**
 * Link colado pelo autor → { kind, id, h? } ou null.
 * Aceita youtube.com/watch?v=, youtu.be/, /shorts/, /embed/, /live/, youtube-nocookie.com,
 * vimeo.com/ID (e /ID/HASH, canais, grupos, showcases) e player.vimeo.com/video/ID.
 */
export function parseVideoUrl(input) {
  const url = toUrl(input);
  if (!url) return null;
  return parseYoutube(url) || parseVimeo(url);
}

/** Valida e limpa `step.video`. Qualquer coisa fora do formato vira null (passo sem vídeo). */
export function normalizeStepVideo(video) {
  if (!video || typeof video !== "object" || Array.isArray(video)) return null;
  const kind = video.kind;
  const id = typeof video.id === "string" ? video.id : typeof video.id === "number" ? String(video.id) : "";
  let out = null;
  if (kind === "youtube" && YT_ID.test(id)) out = { kind, id };
  else if (kind === "vimeo" && VIMEO_ID.test(id)) {
    out = { kind, id };
    if (typeof video.h === "string" && VIMEO_HASH.test(video.h)) out.h = video.h.toLowerCase();
  }
  if (!out) return null;
  const dur = Number(video.durationSec);
  if (Number.isFinite(dur) && dur > 0) out.durationSec = Math.min(VIDEO_MAX_DURATION_SEC, Math.round(dur));
  return out;
}

/** Passo de tela com vídeo válido (slide nunca tem vídeo). */
export function stepVideo(step) {
  if (!step || step.type === "slide") return null;
  return normalizeStepVideo(step.video);
}

export function isVideoStep(step) {
  return stepVideo(step) !== null;
}

/**
 * URL do iframe — só depois do clique em ▶. Começa sem som (autoplay só toca mudo no celular),
 * inline no iPhone e com legenda; YouTube sem cookies (youtube-nocookie) e Vimeo com dnt=1.
 * `origin` (opcional) vai para o YouTube conferir as mensagens da API (enablejsapi).
 */
export function videoEmbedUrl(video, { origin = "" } = {}) {
  const v = normalizeStepVideo(video);
  if (!v) return "";
  if (v.kind === "youtube") {
    const params = new URLSearchParams({
      playsinline: "1",
      mute: "1",
      autoplay: "1",
      cc_load_policy: "1",
      enablejsapi: "1",
      rel: "0",
    });
    if (/^https?:\/\/[^/]+$/i.test(String(origin || ""))) params.set("origin", origin);
    return `${VIDEO_FRAME_ORIGINS.youtube}/embed/${v.id}?${params.toString()}`;
  }
  const params = new URLSearchParams({ muted: "1", playsinline: "1", dnt: "1", autoplay: "1" });
  if (v.h) params.set("h", v.h);
  return `${VIDEO_FRAME_ORIGINS.vimeo}/video/${v.id}?${params.toString()}`;
}

/** Link público do vídeo (export HTML/MP4, sem JavaScript, leitor de tela). */
export function videoWatchUrl(video) {
  const v = normalizeStepVideo(video);
  if (!v) return "";
  if (v.kind === "youtube") return `https://www.youtube.com/watch?v=${v.id}`;
  return v.h ? `https://vimeo.com/${v.id}/${v.h}` : `https://vimeo.com/${v.id}`;
}

export function videoProviderLabel(kind) {
  return VIDEO_PROVIDER_LABELS[kind] || "";
}

/**
 * Onde o EDITOR busca o pôster (uma vez, na hora de colar o link). O resultado é recodificado
 * em WebP e salvo no projeto — quem assiste nunca toca i.ytimg.com / vimeocdn antes do clique.
 * YouTube: lista em ordem de preferência (maxres pode não existir). Vimeo: o oEmbed devolve a
 * URL da miniatura e a duração.
 */
export function videoPosterSources(video) {
  const v = normalizeStepVideo(video);
  if (!v) return { images: [], oembed: "" };
  if (v.kind === "youtube") {
    return {
      images: ["maxresdefault", "sddefault", "hqdefault"].map((n) => `https://i.ytimg.com/vi/${v.id}/${n}.jpg`),
      oembed: "",
    };
  }
  return {
    images: [],
    oembed: `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(videoWatchUrl(v))}&width=1280`,
  };
}

/** Miniatura do oEmbed do Vimeo: só https em *.vimeocdn.com. */
export function vimeoThumbnailFromOembed(data) {
  const raw = typeof data?.thumbnail_url === "string" ? data.thumbnail_url : "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || !/(^|\.)vimeocdn\.com$/i.test(url.hostname)) return "";
    // why: a miniatura padrão vem com _640; pede uma maior para o pôster ficar nítido
    url.pathname = url.pathname.replace(/-d_\d+(x\d+)?$/, "-d_1280");
    return url.href;
  } catch {
    return "";
  }
}

/** Passo pronto para receber o vídeo: pôster na imagem, destaque no quadro inteiro, sem clique simulado. */
export function applyVideoToStep(step, video, posterRef) {
  const v = normalizeStepVideo(video);
  if (!step || !v) return step;
  step.type = "screen";
  step.video = v;
  if (posterRef) step.image = posterRef;
  step.hotspot = { x: 0, y: 0, w: 100, h: 100 };
  step.clickPoint = { x: 50, y: 50 };
  step.simulateClick = false;
  step.zoomHighlight = false;
  return step;
}

/** Tira o vídeo; o pôster fica como imagem do passo (o autor troca se quiser). */
export function removeVideoFromStep(step) {
  if (step && "video" in step) delete step.video;
  return step;
}

/** Estado de progresso de um vídeo (analytics): marcos atingidos e segundos assistidos. */
export function createVideoProgress() {
  return { lastTime: null, watchedSec: 0, reached: new Set(), duration: 0 };
}

/**
 * Atualiza o progresso com a posição atual. Só soma o tempo quando a posição andou para frente
 * até 2 s desde a última leitura (pulo/seek não conta como assistido).
 * Devolve os marcos novos (25/50/75/100).
 */
export function trackVideoTime(state, { currentTime, duration, ended = false } = {}) {
  const now = Number(currentTime);
  const dur = Number(duration);
  if (Number.isFinite(dur) && dur > 0) state.duration = dur;
  if (Number.isFinite(now) && now >= 0) {
    if (state.lastTime != null) {
      const delta = now - state.lastTime;
      if (delta > 0 && delta <= 2) state.watchedSec = Math.min(VIDEO_MAX_DURATION_SEC, state.watchedSec + delta);
    }
    state.lastTime = now;
  }
  const fresh = [];
  const pct = state.duration > 0 && Number.isFinite(now) ? (now / state.duration) * 100 : 0;
  for (const m of VIDEO_MILESTONES) {
    if (state.reached.has(m)) continue;
    const hit = m === 100 ? ended || pct >= 99 : pct >= m;
    if (hit) {
      state.reached.add(m);
      fresh.push(m);
    }
  }
  return fresh;
}
