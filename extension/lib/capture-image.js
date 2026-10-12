/**
 * A API do Chrome só fotografa PNG ou JPEG. Recodifica para WebP aqui,
 * com os mesmos limites do editor (js/imageOptimize.js), para o handoff
 * já sair leve e a segunda passagem do editor não recomprimir à toa.
 */

export const CAPTURE_MAX_EDGE = 2560;
export const CAPTURE_WEBP_QUALITY = 0.85;

export function fitCaptureSize(width, height, maxEdge = CAPTURE_MAX_EDGE) {
  const w = Math.max(0, Math.round(width));
  const h = Math.max(0, Math.round(height));
  const long = Math.max(w, h);
  if (!long || !maxEdge || long <= maxEdge) return { width: w, height: h, resized: false };
  const scale = maxEdge / long;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
    resized: true,
  };
}

export function captureExtension(dataUrl) {
  if (typeof dataUrl === "string" && dataUrl.startsWith("data:image/webp")) return "webp";
  if (typeof dataUrl === "string" && dataUrl.startsWith("data:image/png")) return "png";
  return "jpg";
}

export function captureFileName(stepNumber, dataUrl) {
  return `passo-${stepNumber}.${captureExtension(dataUrl)}`;
}

/**
 * why: WebP entra no lugar do PNG quando fica menor; se redimensionou, também
 * quando não cresceu. JPEG/WebP maior que a origem seria uma geração perdida.
 */
export function preferEncodedCapture({ sourceUrl, encodedUrl, resized }) {
  if (typeof encodedUrl !== "string" || !encodedUrl.startsWith("data:image/webp")) return false;
  if (typeof sourceUrl !== "string" || encodedUrl.length === 0) return false;
  if (resized) return encodedUrl.length <= sourceUrl.length;
  return encodedUrl.length < sourceUrl.length;
}

function bytesToBinary(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return binary;
}

export function dataUrlToBlob(dataUrl) {
  const comma = String(dataUrl).indexOf(",");
  if (comma < 0) throw new Error("bad_data_url");
  const mime = /^data:([^;,]+)/.exec(dataUrl.slice(0, comma))?.[1] || "image/png";
  const bytes = Uint8Array.from(atob(dataUrl.slice(comma + 1)), (ch) => ch.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}

export async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const mime = blob.type || "image/webp";
  return `data:${mime};base64,${btoa(bytesToBinary(bytes))}`;
}

/** Recodifica uma captura. Sem OffscreenCanvas, devolve null e a origem fica. */
export async function encodeCaptureOffscreen(
  dataUrl,
  { maxEdge = CAPTURE_MAX_EDGE, quality = CAPTURE_WEBP_QUALITY, createBitmap, Canvas } = {}
) {
  const bitmapFactory = createBitmap || globalThis.createImageBitmap;
  const CanvasCtor = Canvas || globalThis.OffscreenCanvas;
  if (typeof bitmapFactory !== "function" || typeof CanvasCtor !== "function") return null;

  const bitmap = await bitmapFactory(dataUrlToBlob(dataUrl));
  try {
    const fit = fitCaptureSize(bitmap.width, bitmap.height, maxEdge);
    if (!fit.width || !fit.height) return null;
    const canvas = new CanvasCtor(fit.width, fit.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, fit.width, fit.height);
    const webp = await canvas.convertToBlob({ type: "image/webp", quality });
    if (!webp || webp.type !== "image/webp") return null;
    return { dataUrl: await blobToDataUrl(webp), resized: fit.resized };
  } finally {
    bitmap.close?.();
  }
}

/**
 * Devolve a captura em WebP quando a recodificação cabe.
 * Falha ou resultado maior: mantém o que o Chrome fotografou.
 */
export async function optimizeCaptureDataUrl(dataUrl, { encode } = {}) {
  const source = typeof dataUrl === "string" ? dataUrl : "";
  const keep = { dataUrl: source, optimized: false };
  if (!source.startsWith("data:image/")) return keep;
  let encoded = null;
  try {
    encoded = await (encode || encodeCaptureOffscreen)(source);
  } catch {
    encoded = null;
  }
  if (
    encoded &&
    preferEncodedCapture({
      sourceUrl: source,
      encodedUrl: encoded.dataUrl,
      resized: Boolean(encoded.resized),
    })
  ) {
    return { dataUrl: encoded.dataUrl, optimized: true };
  }
  return keep;
}
