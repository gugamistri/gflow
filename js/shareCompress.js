/**
 * Tamanho e compressão do tour antes do link permanente.
 * why: as capturas vêm em PNG (data URL) e, com a narração em MP3, o tour de exemplo
 * passava de 9 MB; o Cloud recusava (413) só depois de receber o corpo inteiro, duas vezes.
 * Aqui as capturas viram WebP (ou JPEG) com a mesma resolução, e o editor mede o corpo
 * antes de enviar para nunca subir algo que o servidor vai recusar.
 */

/** Limite do POST/PUT /shares no Cloud (guiaflow-cloud apps/api/src/routes/shares.js). */
export const SHARE_MAX_BODY_BYTES = 12 * 1024 * 1024;
/** Limite antigo, para quando o servidor responde 413 sem dizer o limite. */
export const LEGACY_SHARE_MAX_BODY_BYTES = 4 * 1024 * 1024;
export const SHARE_IMAGE_QUALITY = 0.85;
/** Abaixo disto a captura já é leve; recomprimir não compensa. */
const MIN_COMPRESS_CHARS = 48 * 1024;
// why: WebP já saiu otimizado da entrada (imageOptimize.js); recodificar só perderia qualidade
const COMPRESSIBLE_RE = /^data:image\/(png|jpeg|jpg|bmp);base64,/i;
/** JPEG→WebP só troca com ganho real (evita perda de geração à toa). */
const MIN_GAIN = 0.1;

export function utf8Bytes(text) {
  const value = String(text ?? "");
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(value).length;
  return unescape(encodeURIComponent(value)).length;
}

/** "9,4" (pt/es) ou "9.4" (en): MB com uma casa, sem arredondar 4,04 para 4. */
export function formatMb(bytes, locale = "pt") {
  const mb = Math.ceil((Number(bytes) || 0) / (1024 * 1024) * 10) / 10;
  const text = mb % 1 === 0 ? String(mb) : mb.toFixed(1);
  return /^en/i.test(locale) ? text : text.replace(".", ",");
}

/**
 * Corre a promessa com prazo. Ao estourar, rejeita com code "timeout".
 * why: nenhuma etapa do publicar pode deixar o painel parado para sempre.
 */
export function withTimeout(promise, ms, code = "timeout") {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(code);
      err.code = code;
      reject(err);
    }, ms);
  });
  return Promise.race([Promise.resolve(promise), limit]).finally(() => clearTimeout(timer));
}

/** Rejeita assim que o sinal for abortado (o botão Cancelar sempre solta o painel). */
export function abortable(promise, signal) {
  if (!signal) return Promise.resolve(promise);
  if (signal.aborted) return Promise.reject(abortError());
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
  });
  return Promise.race([Promise.resolve(promise), aborted]).finally(() =>
    signal.removeEventListener("abort", onAbort)
  );
}

function abortError() {
  const err = new Error("aborted");
  err.code = "aborted";
  return err;
}

function loadImage(src, timeoutMs) {
  return withTimeout(
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("image_load"));
      img.src = src;
    }),
    timeoutMs
  );
}

/**
 * Recodifica uma captura (data URL) em WebP; sem WebP no navegador, JPEG sobre branco.
 * Mantém largura e altura, então hotspots, zoom e capa não mudam.
 */
export async function encodeImageDataUrl(src, { quality = SHARE_IMAGE_QUALITY, timeoutMs = 8000 } = {}) {
  const img = await loadImage(src, timeoutMs);
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  if (!width || !height) return "";
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(img, 0, 0);
  const webp = canvas.toDataURL("image/webp", quality);
  if (webp.startsWith("data:image/webp")) return webp;
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

function compressible(src) {
  return typeof src === "string" && src.length >= MIN_COMPRESS_CHARS && COMPRESSIBLE_RE.test(src);
}

/**
 * Cópia do tour com as capturas dos passos recomprimidas.
 * Só troca quando o resultado é menor; erro ou prazo estourado mantém a original.
 */
export async function compressTourImages(
  tour,
  { encode = encodeImageDataUrl, onProgress, timeoutMs = 10000, signal } = {}
) {
  if (!tour || typeof tour !== "object" || !Array.isArray(tour.steps)) return tour;
  const next = { ...tour, steps: tour.steps.map((step) => (step && typeof step === "object" ? { ...step } : step)) };
  const sources = [...new Set(next.steps.map((step) => step?.image).filter(compressible))];
  const replaced = new Map();
  for (let i = 0; i < sources.length; i += 1) {
    if (signal?.aborted) throw abortError();
    const src = sources[i];
    onProgress?.(i + 1, sources.length);
    let out = "";
    try {
      out = await withTimeout(encode(src), timeoutMs);
    } catch {
      out = "";
    }
    if (typeof out === "string" && out.startsWith("data:image/") && out.length < src.length * (1 - MIN_GAIN)) {
      replaced.set(src, out);
    }
  }
  if (!replaced.size) return next;
  for (const step of next.steps) {
    if (step && replaced.has(step.image)) step.image = replaced.get(step.image);
  }
  return next;
}

/** Prazo do envio: 60 s + 1 s a cada 64 KB (≈ 0,5 Mbit/s de upload), até 6 min. */
export function uploadTimeoutMs(bytes) {
  const extra = Math.ceil((Number(bytes) || 0) / (64 * 1024)) * 1000;
  return Math.min(6 * 60 * 1000, 60 * 1000 + extra);
}
