/**
 * Mídia fora do registro do projeto no IndexedDB.
 * why: data URL em base64 ocupa +33% e cada autosave regravava todas as capturas.
 *      No disco o projeto guarda só uma ficha "\u0001gfm:<sha256>:<bytes>" por arquivo;
 *      os bytes ficam uma vez só (Blob) na store "media", com a mesma chave sha256 da
 *      sincronização do Pro (PUT /media/:sha). Capturas iguais viram um arquivo só.
 * Na memória o editor continua com data URLs; só a camada de armazenamento troca.
 * hazard: registros antigos (com data: inline) continuam lendo normal e migram no próximo save.
 */

import { blobToDataUrl, dataUrlByteLength, dataUrlToBytes, isMediaDataUrl, sha256Hex } from "./mediaBytes.js";

export const MEDIA_TOKEN_PREFIX = "\u0001gfm:";
/** Abaixo disto o data: fica no registro mesmo (ícones, pixels de teste). */
export const MEDIA_MIN_CHARS = 2048;
const TOKEN_RE = /^\u0001gfm:([a-f0-9]{64}):(\d+)$/;

export function isMediaToken(value) {
  return typeof value === "string" && value.startsWith(MEDIA_TOKEN_PREFIX) && TOKEN_RE.test(value);
}

export function parseMediaToken(value) {
  const match = typeof value === "string" ? TOKEN_RE.exec(value) : null;
  return match ? { sha: match[1], size: Number(match[2]) } : null;
}

export function mediaToken(sha, size) {
  return `${MEDIA_TOKEN_PREFIX}${sha}:${Math.max(0, Number(size) || 0)}`;
}

export function shouldExternalize(value) {
  return typeof value === "string" && value.length >= MEDIA_MIN_CHARS && isMediaDataUrl(value) && /;base64,/i.test(value.slice(0, 120));
}

/**
 * Caches da sessão: string → sha (não refaz o hash a cada autosave) e sha → data URL
 * (abrir de novo não relê o Blob). O segundo tem teto de bytes para não segurar tudo.
 */
export function createMediaCodec({ maxCachedChars = 160 * 1024 * 1024 } = {}) {
  const byString = new Map();
  const byShaUrl = new Map();
  let cachedChars = 0;

  function rememberUrl(sha, dataUrl, meta) {
    if (meta && !byString.has(dataUrl)) byString.set(dataUrl, { sha, mime: meta.mime, size: meta.size });
    if (byShaUrl.has(sha)) {
      const prev = byShaUrl.get(sha);
      byShaUrl.delete(sha);
      byShaUrl.set(sha, prev);
      return;
    }
    byShaUrl.set(sha, dataUrl);
    cachedChars += dataUrl.length;
    while (cachedChars > maxCachedChars && byShaUrl.size > 1) {
      const [oldSha, oldUrl] = byShaUrl.entries().next().value;
      byShaUrl.delete(oldSha);
      cachedChars -= oldUrl.length;
      const meta = byString.get(oldUrl);
      if (meta && meta.sha === oldSha) byString.delete(oldUrl);
    }
  }

  async function describe(dataUrl) {
    const known = byString.get(dataUrl);
    if (known) return known;
    const { mime, bytes } = dataUrlToBytes(dataUrl);
    const sha = await sha256Hex(bytes);
    const entry = { sha, mime, size: bytes.length, bytes };
    byString.set(dataUrl, { sha, mime, size: bytes.length });
    rememberUrl(sha, dataUrl);
    return entry;
  }

  function cachedUrl(sha) {
    return byShaUrl.get(sha) || "";
  }

  return { describe, cachedUrl, rememberUrl, lookup: (dataUrl) => byString.get(dataUrl) || null };
}

function collectStrings(value, out, seen = new WeakSet()) {
  if (typeof value === "string") {
    if (shouldExternalize(value)) out.add(value);
    return out;
  }
  if (!value || typeof value !== "object" || seen.has(value)) return out;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out, seen);
    return out;
  }
  for (const key of Object.keys(value)) collectStrings(value[key], out, seen);
  return out;
}

/**
 * Cópia do valor com cada data: de mídia trocado pela ficha.
 * Primeiro calcula (async) o sha do que é novo; a cópia em si é síncrona, então
 * reflete um único instante do projeto mesmo com o usuário editando durante o save.
 * @returns {{ value, blobs: Map<string,{mime:string,size:number,bytes:Uint8Array|null,dataUrl:string}>, refs: Map<string,number> }}
 */
export async function externalizeMedia(value, codec) {
  const fresh = new Map();
  for (const str of collectStrings(value, new Set())) {
    if (codec.lookup(str)) continue;
    const entry = await codec.describe(str);
    fresh.set(entry.sha, entry.bytes);
  }
  const blobs = new Map();
  const refs = new Map();
  const seen = new Map();
  function walk(node) {
    if (typeof node === "string") {
      if (isMediaToken(node)) {
        const parsed = parseMediaToken(node);
        refs.set(parsed.sha, parsed.size);
        return node;
      }
      if (!shouldExternalize(node)) return node;
      const meta = codec.lookup(node);
      if (!meta) return node; // entrou durante o hash: fica inline e vira ficha no próximo save
      refs.set(meta.sha, meta.size);
      if (!blobs.has(meta.sha)) {
        blobs.set(meta.sha, { mime: meta.mime, size: meta.size, bytes: fresh.get(meta.sha) || null, dataUrl: node });
      }
      return mediaToken(meta.sha, meta.size);
    }
    if (!node || typeof node !== "object") return node;
    if (seen.has(node)) return seen.get(node);
    if (Array.isArray(node)) {
      const out = new Array(node.length);
      seen.set(node, out);
      for (let i = 0; i < node.length; i += 1) out[i] = walk(node[i]);
      return out;
    }
    const out = {};
    seen.set(node, out);
    for (const key of Object.keys(node)) out[key] = walk(node[key]);
    return out;
  }
  return { value: walk(value), blobs, refs };
}

export function collectMediaRefs(value, refs = new Map(), seen = new WeakSet()) {
  if (typeof value === "string") {
    const parsed = parseMediaToken(value);
    if (parsed) refs.set(parsed.sha, parsed.size);
    return refs;
  }
  if (!value || typeof value !== "object" || seen.has(value)) return refs;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectMediaRefs(item, refs, seen);
    return refs;
  }
  for (const key of Object.keys(value)) collectMediaRefs(value[key], refs, seen);
  return refs;
}

/**
 * Troca as fichas pelos data URLs. `load(shas)` → Map sha → { blob|bytes, mime }.
 * Ficha sem arquivo fica como está (contada em `missing`) para nunca perder a referência.
 */
export async function internalizeMedia(value, codec, load) {
  const refs = collectMediaRefs(value);
  const urls = new Map();
  const need = [];
  for (const sha of refs.keys()) {
    const hit = codec?.cachedUrl(sha);
    if (hit) urls.set(sha, hit);
    else need.push(sha);
  }
  const missing = [];
  if (need.length) {
    const rows = (await load(need)) || new Map();
    for (const sha of need) {
      const row = rows.get(sha);
      const data = row?.blob ?? row?.bytes;
      if (!data) {
        missing.push(sha);
        continue;
      }
      const mime = row.mime || (data && data.type) || "application/octet-stream";
      const url = await blobToDataUrl(data, mime);
      urls.set(sha, url);
      codec?.rememberUrl(sha, url, { mime, size: row.size || data.size || data.byteLength || 0 });
    }
  }
  if (!refs.size) return { value, missing };
  const seen = new Map();
  function walk(node) {
    if (typeof node === "string") {
      const parsed = parseMediaToken(node);
      if (!parsed) return node;
      // why: arquivo sumido mantém a ficha — nada é apagado do registro por engano
      return urls.get(parsed.sha) || node;
    }
    if (!node || typeof node !== "object") return node;
    if (seen.has(node)) return seen.get(node);
    if (Array.isArray(node)) {
      const out = new Array(node.length);
      seen.set(node, out);
      for (let i = 0; i < node.length; i += 1) out[i] = walk(node[i]);
      return out;
    }
    const out = {};
    seen.set(node, out);
    for (const key of Object.keys(node)) out[key] = walk(node[key]);
    return out;
  }
  return { value: walk(value), missing };
}

/**
 * Tamanho de um projeto como ele ocupa: JSON sem a mídia + cada arquivo uma vez.
 * Aceita registro com fichas ou com data: inline (estimativa sem decodificar).
 */
export function mediaFootprint(value) {
  const files = new Map();
  let other = 0;
  const seen = new WeakSet();
  function walk(node) {
    if (typeof node === "string") {
      const parsed = parseMediaToken(node);
      if (parsed) {
        files.set(`sha:${parsed.sha}`, parsed.size);
        other += 8;
        return;
      }
      if (shouldExternalize(node)) {
        files.set(`len:${node.length}:${node.slice(-64)}`, dataUrlByteLength(node));
        other += 8;
        return;
      }
      other += node.length + 2;
      return;
    }
    if (typeof node === "number" || typeof node === "boolean") {
      other += 6;
      return;
    }
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    for (const key of Object.keys(node)) {
      other += key.length + 4;
      walk(node[key]);
    }
  }
  walk(value);
  let media = 0;
  for (const size of files.values()) media += size;
  return { bytes: media + other, mediaBytes: media, files: files.size };
}
