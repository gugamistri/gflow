/**
 * Vídeo do passo no player (prévia do editor, /p, embed): fachada com o pôster e um botão ▶.
 * why: nada do YouTube/Vimeo carrega antes do clique — o pôster é a nossa imagem (step.image).
 *      Só no clique entra o iframe (youtube-nocookie / player.vimeo com dnt=1), mudo e inline.
 * Modo expandido é CSS (position:fixed; 100dvh) para os controles da página continuarem visíveis;
 * Esc recolhe antes de fechar o tour. O progresso (25/50/75/100% + segundos) vem pelo postMessage.
 */
import { t } from "./i18n.js";
import {
  VIDEO_FRAME_ORIGINS,
  createVideoProgress,
  stepVideo,
  trackVideoTime,
  videoEmbedUrl,
  videoProviderLabel,
  videoWatchUrl,
} from "./tour-schema/video.js";

const PLAY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>';
const EXPAND_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const COLLAPSE_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const EXTERNAL_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export const VIDEO_STAGE_ID = "gf-video";

/** Lê uma mensagem do iframe (string JSON ou objeto). null se não for nossa. */
export function parseEmbedMessage(kind, data) {
  let msg = data;
  if (typeof msg === "string") {
    try {
      msg = JSON.parse(msg);
    } catch {
      return null;
    }
  }
  if (!msg || typeof msg !== "object") return null;
  if (kind === "youtube") {
    // why: o YouTube manda infoDelivery com currentTime/duration/playerState (1 tocando, 0 fim)
    if (msg.event === "onStateChange" && typeof msg.info === "number") {
      return { state: stateFromYoutube(msg.info) };
    }
    if ((msg.event === "infoDelivery" || msg.event === "initialDelivery") && msg.info && typeof msg.info === "object") {
      const info = msg.info;
      const out = {};
      if (Number.isFinite(info.currentTime)) out.currentTime = info.currentTime;
      if (Number.isFinite(info.duration)) out.duration = info.duration;
      if (typeof info.playerState === "number") out.state = stateFromYoutube(info.playerState);
      return Object.keys(out).length ? out : null;
    }
    if (msg.event === "onReady") return { ready: true };
    return null;
  }
  if (kind === "vimeo") {
    if (msg.event === "ready") return { ready: true };
    const d = msg.data && typeof msg.data === "object" ? msg.data : {};
    if (msg.event === "timeupdate" || msg.event === "playProgress") {
      const out = { state: "playing" };
      if (Number.isFinite(d.seconds)) out.currentTime = d.seconds;
      if (Number.isFinite(d.duration)) out.duration = d.duration;
      return out;
    }
    if (msg.event === "play") return { state: "playing" };
    if (msg.event === "pause") return { state: "paused" };
    if (msg.event === "ended" || msg.event === "finish") {
      const out = { state: "ended" };
      if (Number.isFinite(d.seconds)) out.currentTime = d.seconds;
      if (Number.isFinite(d.duration)) out.duration = d.duration;
      return out;
    }
  }
  return null;
}

function stateFromYoutube(code) {
  if (code === 1) return "playing";
  if (code === 0) return "ended";
  if (code === 2) return "paused";
  return "";
}

/**
 * @param {{ frame: HTMLElement, onPlay?: Function, onProgress?: Function, onState?: Function,
 *   onLayout?: Function, origin?: string }} opts
 */
export function createVideoStage(opts = {}) {
  const { frame } = opts;
  let el = null;
  let current = null; // { step, video, index, stepId, title }
  let iframe = null;
  let progress = null;
  let reportedWatched = 0;
  let playing = false;
  let expanded = false;
  let detach = () => {};

  // why: a Galeria tem a própria fachada (outro id) num nó que entra e sai do DOM a cada foto
  const stageId = opts.id || VIDEO_STAGE_ID;

  function ensureEl() {
    if (el && (el.isConnected || frame?.contains?.(el))) return el;
    el = frame?.querySelector?.(`#${stageId}`) || document.getElementById(stageId);
    if (!el && frame) {
      el = document.createElement("div");
      el.id = stageId;
      el.className = "gf-video";
      el.hidden = true;
      el.innerHTML = `
        <button type="button" class="gf-video-play">
          <span class="gf-video-play-ico">${PLAY_SVG}</span>
          <span class="gf-video-play-text"></span>
        </button>
        <span class="gf-video-note" aria-hidden="true"></span>
        <div class="gf-video-bar" hidden>
          <a class="gf-video-open" target="_blank" rel="noopener noreferrer">${EXTERNAL_SVG}<span class="gf-video-sr"></span></a>
          <button type="button" class="gf-video-expand" aria-pressed="false">${EXPAND_SVG}<span class="gf-video-sr"></span></button>
        </div>`;
      // why: depois da imagem e antes do destaque — o pôster é o próprio <img> do passo
      const image = frame.querySelector("img");
      if (image?.nextSibling) frame.insertBefore(el, image.nextSibling);
      else frame.appendChild(el);
    }
    if (el && !el.dataset.bound) {
      el.dataset.bound = "1";
      // why: editor (prévia estática) e player usam o mesmo nó; o clique vai para quem mostrou por último
      const owner = () => el.__gfStage;
      el.querySelector(".gf-video-play")?.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        owner()?.play();
      });
      el.querySelector(".gf-video-expand")?.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        owner()?.toggleExpanded();
      });
    }
    return el;
  }

  function labels() {
    if (!el || !current) return;
    const provider = videoProviderLabel(current.video.kind);
    const title = current.title;
    const play = el.querySelector(".gf-video-play");
    play.setAttribute("aria-label", title ? t("video.playLabel", { provider, title }) : t("video.playLabelNoTitle", { provider }));
    el.querySelector(".gf-video-play-text").textContent = t("video.play");
    el.querySelector(".gf-video-note").textContent = t("video.loadsOnClick", { provider });
    const open = el.querySelector(".gf-video-open");
    open.href = videoWatchUrl(current.video);
    const openLabel = t("video.openOn", { provider });
    open.title = openLabel;
    open.querySelector(".gf-video-sr").textContent = openLabel;
    syncExpandLabel();
  }

  function syncExpandLabel() {
    const btn = el?.querySelector(".gf-video-expand");
    if (!btn) return;
    const label = t(expanded ? "video.collapse" : "video.expand");
    btn.title = label;
    btn.setAttribute("aria-pressed", expanded ? "true" : "false");
    btn.innerHTML = `${expanded ? COLLAPSE_SVG : EXPAND_SVG}<span class="gf-video-sr"></span>`;
    btn.querySelector(".gf-video-sr").textContent = label;
  }

  function setExpanded(next) {
    if (!el || expanded === Boolean(next)) return;
    expanded = Boolean(next);
    el.classList.toggle("is-expanded", expanded);
    document.documentElement.classList.toggle("gf-video-expanded", expanded);
    frame?.closest(".canvas-stage, .player-stage")?.classList.toggle("has-video-expanded", expanded);
    syncExpandLabel();
    opts.onLayout?.();
    if (expanded) el.querySelector(".gf-video-expand")?.focus({ preventScroll: true });
  }

  let swallowEscUp = false;
  function onKeydown(e) {
    if (e.key !== "Escape" || !expanded) return;
    // why: Esc no modo expandido só recolhe; o tour continua (o player fecha no Esc seguinte)
    e.preventDefault();
    e.stopImmediatePropagation();
    swallowEscUp = true;
    setExpanded(false);
  }
  function onKeyup(e) {
    if (e.key !== "Escape" || !swallowEscUp) return;
    // why: o Driver fecha o tour no keyup do Esc — o mesmo toque que só recolheu o vídeo
    swallowEscUp = false;
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  window.addEventListener("keydown", onKeydown, true);
  window.addEventListener("keyup", onKeyup, true);

  function reportProgress(pct) {
    if (!current || !progress) return;
    const watchedSec = Math.round(progress.watchedSec);
    reportedWatched = Math.max(reportedWatched, watchedSec);
    opts.onProgress?.({ index: current.index, stepId: current.stepId, kind: current.video.kind, pct, watchedSec });
  }

  function handle(update) {
    if (!update || !current) return;
    if (update.state === "playing" && !playing) {
      playing = true;
      opts.onState?.("playing");
    } else if (update.state === "paused" && playing) {
      playing = false;
      opts.onState?.("paused");
    }
    if ("currentTime" in update || "duration" in update || update.state === "ended") {
      const fresh = trackVideoTime(progress, { ...update, ended: update.state === "ended" });
      for (const pct of fresh) reportProgress(pct);
    }
    if (update.state === "ended") {
      playing = false;
      opts.onState?.("ended");
    }
  }

  function bridge(frameEl, kind) {
    const target = VIDEO_FRAME_ORIGINS[kind];
    let heard = false;
    let tries = 0;
    let timer = null;
    const send = (msg) => {
      try {
        frameEl.contentWindow?.postMessage(JSON.stringify(msg), target);
      } catch {
        /* iframe fora do ar */
      }
    };
    const subscribe = () => {
      if (kind === "youtube") {
        send({ event: "listening", id: VIDEO_STAGE_ID, channel: "widget" });
        send({ event: "command", func: "addEventListener", args: ["onStateChange"], id: VIDEO_STAGE_ID, channel: "widget" });
      } else {
        for (const value of ["play", "pause", "ended", "timeupdate"]) send({ method: "addEventListener", value });
      }
    };
    const onMessage = (e) => {
      if (e.origin !== target || e.source !== frameEl.contentWindow) return;
      const update = parseEmbedMessage(kind, e.data);
      if (!update) return;
      if (!heard) {
        heard = true;
        if (kind === "vimeo") subscribe();
      }
      if (update.ready && kind === "vimeo") subscribe();
      handle(update);
    };
    window.addEventListener("message", onMessage);
    frameEl.addEventListener("load", () => {
      subscribe();
      // why: o "listening" do YouTube pode chegar antes do player montar; repete até ouvir
      clearInterval(timer);
      timer = setInterval(() => {
        tries += 1;
        if (heard && kind === "vimeo") return clearInterval(timer);
        if (tries > 20) return clearInterval(timer);
        if (!heard) subscribe();
      }, 500);
    });
    return () => {
      clearInterval(timer);
      window.removeEventListener("message", onMessage);
    };
  }

  function play() {
    if (!current || iframe || !el) return;
    const { video } = current;
    const origin = typeof location !== "undefined" ? location.origin : "";
    const src = videoEmbedUrl(video, { origin: /^https?:/.test(origin) ? origin : "" });
    if (!src) return;
    progress = createVideoProgress();
    reportedWatched = 0;
    iframe = document.createElement("iframe");
    iframe.className = "gf-video-frame";
    iframe.src = src;
    iframe.title = t("video.frameTitle", { provider: videoProviderLabel(video.kind), title: current.title || "" }).replace(/[:\s—-]+$/, "");
    iframe.allow = "autoplay; fullscreen; picture-in-picture; encrypted-media";
    iframe.setAttribute("allowfullscreen", "");
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    detach = bridge(iframe, video.kind);
    el.classList.add("is-playing");
    el.appendChild(iframe);
    el.querySelector(".gf-video-bar").hidden = false;
    // why: o clique é a intenção de assistir; o "tocando" de verdade chega pelo postMessage
    playing = true;
    opts.onState?.("playing");
    opts.onPlay?.({ index: current.index, stepId: current.stepId, kind: video.kind });
    iframe.focus({ preventScroll: true });
  }

  /** Para o vídeo do passo atual (troca de passo, sair do tour) e manda o tempo assistido. */
  function teardown() {
    if (iframe && progress && current) {
      const watched = Math.round(progress.watchedSec);
      if (watched > reportedWatched) reportProgress(0);
    }
    detach();
    detach = () => {};
    iframe?.remove();
    iframe = null;
    progress = null;
    if (playing) {
      playing = false;
      opts.onState?.("stopped");
    }
    setExpanded(false);
    if (el && (!el.__gfStage || el.__gfStage === api)) {
      el.classList.remove("is-playing");
      const bar = el.querySelector(".gf-video-bar");
      if (bar) bar.hidden = true;
    }
  }

  const api = {
    get element() {
      return ensureEl();
    },
    /** Mostra a fachada do passo. `interactive: false` = prévia estática do editor (sem clique). */
    show(step, { index = 0, interactive = true } = {}) {
      const video = stepVideo(step);
      if (!video) {
        this.hide();
        return false;
      }
      const node = ensureEl();
      if (!node) return false;
      if (node.__gfStage && node.__gfStage !== api) node.__gfStage.teardown();
      node.__gfStage = api;
      const same = current && current.step === step && current.video.id === video.id && current.video.kind === video.kind;
      if (!same) teardown();
      current = {
        step,
        video,
        index,
        stepId: typeof step.id === "string" && /^[\w:.-]{1,80}$/.test(step.id) ? step.id : null,
        title: String(step.popover?.title || step.label || "").trim().slice(0, 120),
      };
      node.dataset.kind = video.kind;
      node.classList.toggle("is-static", !interactive);
      const btn = node.querySelector(".gf-video-play");
      btn.tabIndex = interactive ? 0 : -1;
      btn.disabled = !interactive;
      if (interactive) btn.removeAttribute("aria-hidden");
      else btn.setAttribute("aria-hidden", "true");
      labels();
      node.hidden = false;
      return true;
    },
    hide() {
      teardown();
      current = null;
      if (el && (!el.__gfStage || el.__gfStage === api)) {
        el.hidden = true;
        el.__gfStage = null;
      }
    },
    teardown,
    /** Some de vez (Galeria: uma fachada por slide): para o vídeo e solta os ouvintes da janela. */
    destroy() {
      this.hide();
      window.removeEventListener("keydown", onKeydown, true);
      window.removeEventListener("keyup", onKeyup, true);
    },
    play,
    collapse: () => setExpanded(false),
    toggleExpanded: () => setExpanded(!expanded),
    isPlaying: () => playing,
    isExpanded: () => expanded,
    isActive: () => Boolean(current && el && !el.hidden),
    /** Para testes: injeta uma atualização como se viesse do iframe. */
    _handle: handle,
  };
  return api;
}
