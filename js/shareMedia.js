/**
 * /p v2 (PRD multi-idioma §7.4): o áudio dos idiomas-alvo vai por referência.
 * why: com N idiomas o payload crescia N vezes no áudio e estourava os 12 MB; agora o publicar
 *      sobe cada clip uma vez (PUT /media/:sha, deduplicado) e o player baixa só o idioma ativo
 *      em GET /api/shares/:slug/media/:sha. A origem continua inline (players antigos).
 */
import { dataUrlToBytes, sha256Hex } from "./cloudSync.js";

export const ASSET_REF = "asset:";
const SHA_RE = /^[a-f0-9]{64}$/;

function langAudios(snapshot) {
  const out = [];
  for (const step of Array.isArray(snapshot?.steps) ? snapshot.steps : []) {
    const bag = step?.i18n;
    if (!bag || typeof bag !== "object") continue;
    for (const lang of Object.keys(bag)) {
      const a = bag[lang]?.narrationAudio;
      if (a && Array.isArray(a.clips)) out.push(a);
    }
  }
  return out;
}

/**
 * Troca os clips `data:` dos idiomas-alvo por `asset:<sha>`, subindo o que falta.
 * deps.check(hashes) → { missing: [] }; deps.upload(sha, bytes, mime) → { ok }.
 * Devolve uma cópia; o projeto do editor não muda.
 */
export async function externalizeLangAudio(snapshot, { check, upload } = {}) {
  const copy = structuredClone(snapshot);
  const audios = langAudios(copy);
  if (!audios.length || !upload) return { snapshot: copy, uploaded: 0, refs: 0 };
  const files = new Map();
  for (const a of audios) {
    for (let i = 0; i < a.clips.length; i += 1) {
      const clip = a.clips[i];
      if (typeof clip !== "string" || !clip.startsWith("data:audio/")) continue;
      const { mime, bytes } = dataUrlToBytes(clip);
      const sha = await sha256Hex(bytes);
      files.set(sha, { mime, bytes });
      a.clips[i] = ASSET_REF + sha;
    }
  }
  let missing = [...files.keys()];
  if (missing.length && check) {
    const res = await check(missing);
    if (res?.ok && Array.isArray(res.data?.missing)) missing = res.data.missing.filter((s) => files.has(s));
  }
  for (const sha of missing) {
    const f = files.get(sha);
    const res = await upload(sha, f.bytes, f.mime);
    if (!res?.ok) {
      const err = new Error("media_upload_failed");
      err.code = "share_failed";
      throw err;
    }
  }
  return { snapshot: copy, uploaded: missing.length, refs: files.size };
}

/** Player do /p: `asset:<sha>` dos idiomas-alvo → URL pública do share (baixada só ao tocar). */
export function resolveShareMedia(tour, mediaBase) {
  const base = String(mediaBase || "").replace(/\/$/, "");
  if (!base) return tour;
  for (const a of langAudios(tour)) {
    a.clips = a.clips.map((c) => {
      if (typeof c !== "string" || !c.startsWith(ASSET_REF)) return c;
      const sha = c.slice(ASSET_REF.length);
      return SHA_RE.test(sha) ? `${base}/media/${sha}` : "";
    }).filter(Boolean);
  }
  return tour;
}

export { isPlayableClipUrl } from "./playback.js";
