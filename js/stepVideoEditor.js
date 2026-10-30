/**
 * Campo "Vídeo" do passo no editor: cola um link do YouTube ou do Vimeo, busca a capa UMA vez
 * (aqui, na edição) e guarda como WebP nosso em `step.image`. Sem upload, sem armazenamento.
 * why: quem assiste nunca baixa nada de i.ytimg.com / vimeocdn.com antes de tocar no play.
 */
import { t } from "./i18n.js";
import {
  applyVideoToStep,
  parseVideoUrl,
  removeVideoFromStep,
  stepVideo,
  videoPosterSources,
  videoProviderLabel,
  videoWatchUrl,
  vimeoThumbnailFromOembed,
} from "./tour-schema/video.js";

export const POSTER_MAX_WIDTH = 1920;
export const POSTER_QUALITY = 0.85;
/** Placeholder do YouTube para miniatura inexistente (120×90). */
const MIN_POSTER_WIDTH = 200;

/**
 * Recorte 16:9 no centro quando a miniatura vem 4:3 com faixas pretas (hqdefault/sddefault).
 * Devolve { sx, sy, sw, sh, w, h } em pixels, com largura final ≤ maxWidth.
 */
export function posterCrop(width, height, maxWidth = POSTER_MAX_WIDTH) {
  let sx = 0;
  let sy = 0;
  let sw = width;
  let sh = height;
  const ratio = width / height;
  if (Math.abs(ratio - 4 / 3) < 0.02) {
    sh = Math.round((width * 9) / 16);
    sy = Math.round((height - sh) / 2);
  }
  const scale = sw > maxWidth ? maxWidth / sw : 1;
  return { sx, sy, sw, sh, w: Math.round(sw * scale), h: Math.round(sh * scale) };
}

async function fetchJson(fetchImpl, url) {
  const res = await fetchImpl(url, { mode: "cors", credentials: "omit", referrerPolicy: "no-referrer" });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return res.json();
}

async function fetchImageBitmap(fetchImpl, url) {
  const res = await fetchImpl(url, { mode: "cors", credentials: "omit", referrerPolicy: "no-referrer" });
  if (!res.ok) throw new Error(`http_${res.status}`);
  const blob = await res.blob();
  if (!/^image\//.test(blob.type || "image/")) throw new Error("not_image");
  return createImageBitmap(blob);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Bitmap → data URL WebP (JPEG se o navegador não gera WebP). */
export async function encodePoster(bitmap) {
  const crop = posterCrop(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = crop.w;
  canvas.height = crop.h;
  const ctx2d = canvas.getContext("2d");
  ctx2d.imageSmoothingQuality = "high";
  ctx2d.drawImage(bitmap, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, crop.w, crop.h);
  bitmap.close?.();
  let blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", POSTER_QUALITY));
  if (!blob || blob.type !== "image/webp") {
    blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", POSTER_QUALITY));
  }
  if (!blob) throw new Error("encode_failed");
  return { dataUrl: await blobToDataUrl(blob), width: crop.w, height: crop.h, type: blob.type };
}

/**
 * Busca capa (e título/duração quando o provedor dá) de um vídeo.
 * @returns {Promise<{ dataUrl: string, title: string, durationSec: number|null }>}
 */
export async function fetchVideoPoster(video, { fetchImpl = globalThis.fetch?.bind(globalThis), encode = encodePoster } = {}) {
  const sources = videoPosterSources(video);
  let title = "";
  let durationSec = null;
  let images = sources.images.slice();
  if (video.kind === "vimeo") {
    const data = await fetchJson(fetchImpl, sources.oembed);
    const thumb = vimeoThumbnailFromOembed(data);
    if (thumb) images = [thumb];
    title = typeof data?.title === "string" ? data.title : "";
    const dur = Number(data?.duration);
    if (Number.isFinite(dur) && dur > 0) durationSec = Math.round(dur);
  } else {
    // título é bônus: o oEmbed do YouTube responde com CORS; se falhar, segue sem
    try {
      const data = await fetchJson(
        fetchImpl,
        `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(videoWatchUrl(video))}`
      );
      title = typeof data?.title === "string" ? data.title : "";
    } catch {
      /* sem título */
    }
  }
  let lastError = new Error("no_poster");
  for (const url of images) {
    try {
      const bitmap = await fetchImageBitmap(fetchImpl, url);
      if (bitmap.width < MIN_POSTER_WIDTH) {
        bitmap.close?.();
        continue;
      }
      const poster = await encode(bitmap);
      return { dataUrl: poster.dataUrl, title: title.trim().slice(0, 120), durationSec };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

/**
 * @param {{ getDemo: Function, currentStep: Function, commit: Function, toast?: Function,
 *   newImageId: Function, defaultTitles?: Set<string>, openSection?: Function, onMediaAdded?: Function,
 *   fetchPoster?: Function }} ctx
 */
export function createStepVideoEditor(ctx) {
  const els = {
    wrap: document.getElementById("wrap-video"),
    input: document.getElementById("prop-video-url"),
    apply: document.getElementById("btn-video-apply"),
    remove: document.getElementById("btn-video-remove"),
    status: document.getElementById("prop-video-status"),
    current: document.getElementById("prop-video-current"),
    stb: document.getElementById("stb-video"),
  };
  const fetchPoster = ctx.fetchPoster || fetchVideoPoster;
  let busy = false;

  function setStatus(text, { error = false } = {}) {
    if (!els.status) return;
    els.status.textContent = text || "";
    els.status.hidden = !text;
    els.status.classList.toggle("is-error", Boolean(error));
    els.input?.setAttribute("aria-invalid", error ? "true" : "false");
  }

  function sync(step = ctx.currentStep()) {
    if (!els.wrap) return;
    const isScreen = Boolean(step) && step.type !== "slide";
    els.wrap.hidden = !isScreen;
    const video = stepVideo(step);
    if (els.current) {
      els.current.hidden = !video;
      if (video) {
        els.current.textContent = t("video.current", { provider: videoProviderLabel(video.kind), id: video.id });
        els.current.href = videoWatchUrl(video);
      }
    }
    if (els.remove) els.remove.hidden = !video;
    if (els.apply) {
      els.apply.textContent = t(video ? "video.replace" : "video.add");
      els.apply.disabled = busy;
    }
    if (els.input && document.activeElement !== els.input && !busy) els.input.value = video ? videoWatchUrl(video) : "";
    if (els.stb) {
      els.stb.classList.toggle("is-active", Boolean(video));
      els.stb.setAttribute("aria-pressed", video ? "true" : "false");
    }
    if (!busy) setStatus("");
  }

  async function apply() {
    const step = ctx.currentStep();
    if (!step || busy) return false;
    if (step.type === "slide") {
      setStatus(t("video.slideNote"), { error: true });
      return false;
    }
    const parsed = parseVideoUrl(els.input?.value);
    if (!parsed) {
      setStatus(t("video.invalid"), { error: true });
      els.input?.focus();
      return false;
    }
    const current = stepVideo(step);
    if (current && current.kind === parsed.kind && current.id === parsed.id && (current.h || "") === (parsed.h || "")) {
      sync(step);
      return true;
    }
    busy = true;
    if (els.apply) els.apply.disabled = true;
    setStatus(t("video.fetching"));
    const provider = videoProviderLabel(parsed.kind);
    try {
      let poster = null;
      try {
        poster = await fetchPoster(parsed);
      } catch {
        poster = null;
      }
      // why: o passo pode ter mudado enquanto a capa baixava
      if (ctx.currentStep() !== step) return false;
      if (!poster && !step.image) {
        setStatus(t("video.posterFailed"), { error: true });
        ctx.toast?.(t("video.posterFailed"));
        return false;
      }
      const demo = ctx.getDemo();
      let posterRef = "";
      if (poster) {
        if (!demo.customImages) demo.customImages = {};
        const id = ctx.newImageId();
        demo.customImages[id] = { name: `${parsed.kind}-${parsed.id}.webp`, dataUrl: poster.dataUrl, addedAt: Date.now() };
        posterRef = `custom:${id}`;
      }
      const video = { ...parsed };
      if (poster?.durationSec) video.durationSec = poster.durationSec;
      applyVideoToStep(step, video, posterRef);
      if (!step.popover) step.popover = { side: "bottom", align: "center" };
      const defaults = ctx.defaultTitles || new Set([""]);
      if (poster?.title && defaults.has(String(step.popover.title || ""))) {
        step.popover.title = poster.title;
        step.label = poster.title;
      }
      busy = false;
      ctx.commit();
      if (!poster) setStatus(t("video.posterFailed"), { error: true });
      ctx.toast?.(t("video.added", { provider }));
      return true;
    } finally {
      busy = false;
      if (els.apply) els.apply.disabled = false;
      if (els.status?.textContent === t("video.fetching")) setStatus("");
    }
  }

  function remove() {
    const step = ctx.currentStep();
    if (!step || !stepVideo(step)) return false;
    removeVideoFromStep(step);
    ctx.commit();
    ctx.toast?.(t("video.removed"));
    els.input?.focus();
    return true;
  }

  els.apply?.addEventListener("click", () => apply());
  els.remove?.addEventListener("click", () => remove());
  els.input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      apply();
    }
  });
  els.input?.addEventListener("input", () => {
    if (els.status?.classList.contains("is-error")) setStatus("");
  });
  els.stb?.addEventListener("click", () => {
    ctx.openSection?.("image");
    requestAnimationFrame(() => els.input?.focus({ preventScroll: true }));
  });

  return { sync, apply, remove };
}
