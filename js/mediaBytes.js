/**
 * Bytes de mídia ↔ data URL, e o sha256 que identifica cada arquivo.
 * why: o IndexedDB local e a sincronização do Pro (PUT /media/:sha) usam a mesma chave,
 *      o sha256 dos bytes decodificados — o mesmo arquivo nunca é guardado nem enviado duas vezes.
 */

const MEDIA_DATA_URL_RE = /^data:((?:image|audio|video)\/[a-z0-9.+-]+)(;[^,]*)?,/i;

export function dataUrlMime(value) {
  if (typeof value !== "string" || !value.startsWith("data:")) return "";
  const comma = value.indexOf(",");
  if (comma < 0) return "";
  return value.slice(5, comma).split(";")[0].toLowerCase();
}

export function isMediaDataUrl(value) {
  return typeof value === "string" && MEDIA_DATA_URL_RE.test(value);
}

/** Tamanho real dos bytes de um data:...;base64, sem decodificar. */
export function dataUrlByteLength(value) {
  if (typeof value !== "string" || !value.startsWith("data:")) return 0;
  const comma = value.indexOf(",");
  if (comma < 0) return 0;
  const head = value.slice(5, comma);
  const bodyLen = value.length - comma - 1;
  if (!/;base64/i.test(head)) return bodyLen;
  let pad = 0;
  if (value.endsWith("==")) pad = 2;
  else if (value.endsWith("=")) pad = 1;
  return Math.max(0, Math.floor((bodyLen * 3) / 4) - pad);
}

export function dataUrlToBytes(dataUrl) {
  const comma = dataUrl.indexOf(",");
  const head = dataUrl.slice(5, comma);
  const mime = head.split(";")[0].toLowerCase();
  const body = dataUrl.slice(comma + 1);
  if (/;base64/i.test(head)) {
    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return { mime, bytes };
  }
  return { mime, bytes: new TextEncoder().encode(decodeURIComponent(body)) };
}

export function bytesToDataUrl(bytes, mime) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < view.length; i += chunk) {
    binary += String.fromCharCode.apply(null, view.subarray(i, i + chunk));
  }
  return `data:${mime || "application/octet-stream"};base64,${btoa(binary)}`;
}

export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Blob/File/ArrayBuffer → data URL sem FileReader (funciona no Node dos testes também). */
export async function blobToDataUrl(blob, mime) {
  if (blob instanceof ArrayBuffer || ArrayBuffer.isView(blob)) {
    return bytesToDataUrl(blob instanceof ArrayBuffer ? new Uint8Array(blob) : new Uint8Array(blob.buffer, blob.byteOffset, blob.byteLength), mime);
  }
  const buf = await blob.arrayBuffer();
  return bytesToDataUrl(new Uint8Array(buf), mime || blob.type);
}

/** "4,2 MB" / "840 KB" — tamanho discreto para cartões e menus. */
export function formatBytes(bytes, locale = "pt") {
  const n = Math.max(0, Number(bytes) || 0);
  const en = /^en/i.test(locale);
  const fix = (v) => {
    const text = v >= 10 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, "");
    return en ? text : text.replace(".", ",");
  };
  if (n < 1024 * 1024) return `${fix(Math.max(n, 1024) / 1024)} KB`;
  return `${fix(n / (1024 * 1024))} MB`;
}
