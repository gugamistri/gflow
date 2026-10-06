/**
 * Miniaturas JPEG para listas (filmstrip, grade, biblioteca).
 * O canvas e o player continuam com a imagem cheia.
 */

export const LIBRARY_THUMB_MAX_CHARS = 80_000;

const decodeQueue = [];
let decodeRunning = false;

function enqueueDecode(task) {
  return new Promise((resolve, reject) => {
    decodeQueue.push({ task, resolve, reject });
    pumpDecode();
  });
}

function pumpDecode() {
  if (decodeRunning) return;
  const next = decodeQueue.shift();
  if (!next) return;
  decodeRunning = true;
  Promise.resolve()
    .then(next.task)
    .then(next.resolve, next.reject)
    .finally(() => {
      decodeRunning = false;
      pumpDecode();
    });
}

/** why: a chave evita varrer o dataUrl inteiro a cada redesenho da lista. */
export function thumbKey(src) {
  const s = String(src || "");
  if (!s) return "";
  let h = 2166136261;
  const stride = Math.max(1, Math.floor(s.length / 48));
  for (let i = 0; i < s.length; i += stride) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= s.length;
  return (h >>> 0).toString(36);
}

export function shouldDownscaleSrc(src) {
  const s = String(src || "");
  return s.startsWith("data:image/") || s.startsWith("blob:");
}

export function isHeavyDataUrl(src, limit = LIBRARY_THUMB_MAX_CHARS) {
  return typeof src === "string" && src.startsWith("data:") && src.length > limit;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image"));
    img.src = src;
  });
}

async function drawThumb(src, maxEdge) {
  if (typeof document === "undefined" || typeof Image === "undefined") return null;
  const img = await loadImage(src);
  try {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return null;
    const scale = Math.min(1, maxEdge / Math.max(w, h));
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement("canvas");
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, tw, th);
    return canvas;
  } finally {
    img.onload = null;
    img.onerror = null;
    img.removeAttribute("src");
  }
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve) => {
    if (!canvas?.toBlob) {
      resolve(null);
      return;
    }
    canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality);
  });
}

async function blobUrlFor(src, maxEdge, quality) {
  const canvas = await drawThumb(src, maxEdge);
  if (!canvas) return "";
  const blob = await canvasToBlob(canvas, quality);
  canvas.width = 0;
  canvas.height = 0;
  if (!blob || typeof URL === "undefined" || !URL.createObjectURL) return "";
  return URL.createObjectURL(blob);
}

export function createThumbCache({ maxEdge = 168, quality = 0.66 } = {}) {
  const cache = new Map();
  const scopes = new Map();

  function isHeld(key) {
    for (const scope of scopes.values()) {
      if (scope.has(key)) return true;
    }
    return false;
  }

  function revokeKey(key) {
    const entry = cache.get(key);
    if (!entry) return;
    cache.delete(key);
    if (entry.url && typeof URL !== "undefined" && URL.revokeObjectURL) {
      URL.revokeObjectURL(entry.url);
    }
  }

  function sweep() {
    for (const key of [...cache.keys()]) {
      if (!isHeld(key)) revokeKey(key);
    }
  }

  function hold(scope, pairs) {
    const next = new Map();
    for (const pair of pairs || []) {
      if (!pair?.key || !pair.src) continue;
      next.set(pair.key, pair.src);
    }
    scopes.set(scope, next);
    sweep();
    return next;
  }

  function releaseScope(scope) {
    scopes.delete(scope);
    sweep();
  }

  function peek(key) {
    return cache.get(key)?.url || "";
  }

  function holds(scope, key) {
    return Boolean(scopes.get(scope)?.has(key));
  }

  function load(key, src) {
    const hit = cache.get(key);
    if (hit?.url) return Promise.resolve(hit.url);
    if (hit?.pending) return hit.pending;
    const entry = { url: "", pending: null };
    cache.set(key, entry);
    entry.pending = enqueueDecode(() => blobUrlFor(src, maxEdge, quality))
      .then((url) => {
        if (!url || cache.get(key) !== entry || !isHeld(key)) {
          if (url && typeof URL !== "undefined" && URL.revokeObjectURL) URL.revokeObjectURL(url);
          if (cache.get(key) === entry) cache.delete(key);
          return "";
        }
        entry.url = url;
        entry.pending = null;
        return url;
      })
      .catch(() => {
        if (cache.get(key) === entry && !entry.url) cache.delete(key);
        return "";
      });
    return entry.pending;
  }

  return { hold, releaseScope, peek, holds, load };
}

export async function downscaleImageUrl(src, { maxEdge = 480, quality = 0.72, maxChars = LIBRARY_THUMB_MAX_CHARS } = {}) {
  const url = String(src || "");
  if (!url) return "";
  if (url.startsWith("data:image/jpeg") && url.length <= maxChars) return url;
  if (!shouldDownscaleSrc(url) && !/^https?:/i.test(url)) return "";
  if (typeof document === "undefined") return "";
  const canvas = await enqueueDecode(() => drawThumb(url, maxEdge));
  if (!canvas) return "";
  const out = canvas.toDataURL("image/jpeg", quality);
  canvas.width = 0;
  canvas.height = 0;
  return out || "";
}
