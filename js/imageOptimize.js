/**
 * Capturas leves na entrada: WebP ~0,85, lado maior até 2560 px, proporção mantida.
 * why: PNG de Retina pesa 1–3 MB; o mesmo quadro em WebP fica 5–10× menor sem perda visível.
 *      Sem WebP no navegador (Safari) vira JPEG sobre branco; PNG só fica se for menor
 *      (recortes pequenos com transparência). Hotspots são em %, então redimensionar não move nada.
 * Roda num worker com OffscreenCanvas; sem ele, no canvas da página.
 */

import { blobToDataUrl, bytesToDataUrl, dataUrlByteLength, dataUrlMime, dataUrlToBytes } from "./mediaBytes.js";

export const IMAGE_MAX_EDGE = 2560;
export const IMAGE_QUALITY = 0.85;
/** Recodificar algo que já é WebP/JPEG só vale se economizar pelo menos isto (evita perda à toa). */
export const REENCODE_MIN_GAIN = 0.12;
/** Abaixo disto a imagem já é leve. */
export const IMAGE_MIN_BYTES = 24 * 1024;

const OPTIMIZABLE_RE = /^image\/(png|jpeg|jpg|webp|bmp|gif|avif|tiff)$/i;

export function fitWithin(width, height, maxEdge = IMAGE_MAX_EDGE) {
  const w = Math.max(0, Math.round(width));
  const h = Math.max(0, Math.round(height));
  const long = Math.max(w, h);
  if (!long || !maxEdge || long <= maxEdge) return { width: w, height: h, resized: false };
  const scale = maxEdge / long;
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)), resized: true };
}

/**
 * Decide se o resultado entra no lugar do original.
 * - redimensionou: entra se não ficou maior (a resolução menor é o objetivo);
 * - original sem perda (PNG/BMP): entra se for menor;
 * - original já comprimido (JPEG/WebP): só com ganho de REENCODE_MIN_GAIN.
 */
export function acceptOptimized({ beforeBytes, afterBytes, sourceMime, resized }) {
  if (!(afterBytes > 0) || !(beforeBytes > 0)) return false;
  if (resized) return afterBytes <= beforeBytes;
  if (/^image\/(png|bmp|tiff)$/i.test(sourceMime)) return afterBytes < beforeBytes;
  if (/^image\/gif$/i.test(sourceMime)) return false; // why: GIF pode ser animado; canvas pegaria só o 1º quadro
  return afterBytes <= beforeBytes * (1 - REENCODE_MIN_GAIN);
}

export function isOptimizableImage(dataUrl) {
  return typeof dataUrl === "string" && /;base64,/i.test(dataUrl.slice(0, 80)) && OPTIMIZABLE_RE.test(dataUrlMime(dataUrl));
}

/* ---------- worker ---------- */

let worker = null;
let workerBroken = false;
let seq = 0;
const pending = new Map();

function getWorker() {
  if (workerBroken || typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./mediaWorker.js", import.meta.url));
    worker.onmessage = (event) => {
      const msg = event.data || {};
      const job = pending.get(msg.id);
      if (!job) return;
      pending.delete(msg.id);
      clearTimeout(job.timer);
      if (msg.ok) job.resolve(msg);
      else job.reject(new Error(msg.error || "worker_failed"));
    };
    worker.onerror = (event) => {
      event?.preventDefault?.();
      failWorker(new Error("worker_error"));
    };
  } catch {
    workerBroken = true;
    worker = null;
  }
  return worker;
}

function failWorker(err) {
  workerBroken = true;
  try {
    worker?.terminate();
  } catch {
    /* já morto */
  }
  worker = null;
  for (const job of pending.values()) {
    clearTimeout(job.timer);
    job.reject(err);
  }
  pending.clear();
}

/** Manda um trabalho para o worker. `transfer` evita copiar os bytes. */
export function runMediaWorker(message, transfer = [], timeoutMs = 30000) {
  const w = getWorker();
  if (!w) return Promise.reject(Object.assign(new Error("no_worker"), { code: "no_worker" }));
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Object.assign(new Error("timeout"), { code: "timeout" }));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    try {
      w.postMessage({ ...message, id }, transfer);
    } catch (err) {
      pending.delete(id);
      clearTimeout(timer);
      reject(err);
    }
  });
}

export function mediaWorkerAvailable() {
  return Boolean(getWorker());
}

/* ---------- canvas da página (fallback) ---------- */

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image_load"));
    img.src = src;
  });
}

function canvasHasAlpha(canvas) {
  const w = Math.min(160, canvas.width);
  const h = Math.min(160, canvas.height);
  const probe = document.createElement("canvas");
  probe.width = w;
  probe.height = h;
  const ctx = probe.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return true;
  return false;
}

async function encodeOnPage(dataUrl, { maxEdge, quality }) {
  const img = await loadImage(dataUrl);
  const sw = img.naturalWidth || img.width;
  const sh = img.naturalHeight || img.height;
  if (!sw || !sh) throw new Error("image_empty");
  const fit = fitWithin(sw, sh, maxEdge);
  const canvas = document.createElement("canvas");
  canvas.width = fit.width;
  canvas.height = fit.height;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, fit.width, fit.height);
  let out = canvas.toDataURL("image/webp", quality);
  if (!out.startsWith("data:image/webp")) {
    const mime = dataUrlMime(dataUrl);
    if (/png|webp|gif/i.test(mime) && canvasHasAlpha(canvas)) {
      out = out.startsWith("data:image/png") ? out : canvas.toDataURL("image/png");
    } else {
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, fit.width, fit.height);
      out = canvas.toDataURL("image/jpeg", quality);
    }
  }
  return { dataUrl: out, width: fit.width, height: fit.height, sourceWidth: sw, sourceHeight: sh, resized: fit.resized };
}

async function encodeInWorker(dataUrl, { maxEdge, quality, timeoutMs }) {
  const { mime, bytes } = dataUrlToBytes(dataUrl);
  const res = await runMediaWorker({ kind: "image", bytes, mime, maxEdge, quality }, [bytes.buffer], timeoutMs);
  return {
    dataUrl: bytesToDataUrl(res.bytes, res.mime),
    width: res.width,
    height: res.height,
    sourceWidth: res.sourceWidth,
    sourceHeight: res.sourceHeight,
    resized: res.resized,
  };
}

/**
 * Otimiza uma imagem (data URL). Nunca rejeita: em erro devolve a original com changed=false.
 * @returns {Promise<{dataUrl:string, changed:boolean, beforeBytes:number, afterBytes:number, width?:number, height?:number}>}
 */
export async function optimizeImageDataUrl(
  dataUrl,
  { maxEdge = IMAGE_MAX_EDGE, quality = IMAGE_QUALITY, timeoutMs = 30000, minBytes = IMAGE_MIN_BYTES, encode } = {}
) {
  const beforeBytes = dataUrlByteLength(dataUrl);
  const keep = { dataUrl, changed: false, beforeBytes, afterBytes: beforeBytes };
  if (!isOptimizableImage(dataUrl) || beforeBytes < minBytes) return keep;
  const sourceMime = dataUrlMime(dataUrl);
  let res = null;
  try {
    if (encode) res = await encode(dataUrl, { maxEdge, quality, timeoutMs });
    else {
      try {
        res = await encodeInWorker(dataUrl, { maxEdge, quality, timeoutMs });
      } catch (err) {
        if (typeof document === "undefined") throw err;
        res = await encodeOnPage(dataUrl, { maxEdge, quality });
      }
    }
  } catch {
    return keep;
  }
  if (!res?.dataUrl || !res.dataUrl.startsWith("data:image/")) return keep;
  const afterBytes = dataUrlByteLength(res.dataUrl);
  if (!acceptOptimized({ beforeBytes, afterBytes, sourceMime, resized: Boolean(res.resized) })) {
    return { ...keep, width: res.sourceWidth, height: res.sourceHeight };
  }
  return { dataUrl: res.dataUrl, changed: true, beforeBytes, afterBytes, width: res.width, height: res.height };
}

/** File/Blob vindo de upload, colar ou arrastar → data URL já otimizado. */
export async function optimizeImageFile(file, opts) {
  const dataUrl = await blobToDataUrl(file, file.type || "image/png");
  const res = await optimizeImageDataUrl(dataUrl, opts);
  return res.dataUrl;
}
