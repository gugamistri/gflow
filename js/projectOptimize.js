/**
 * Recomprime toda a mídia de um projeto (imagens e áudio) e mede antes/depois.
 * why: "Otimizar projeto" e a entrada de capturas/importações usam o mesmo caminho;
 *      cada arquivo distinto é processado uma vez, mesmo que apareça em vários passos.
 */

import { dataUrlByteLength, isMediaDataUrl } from "./mediaBytes.js";
import { mediaFootprint } from "./mediaStore.js";
import { isOptimizableImage, optimizeImageDataUrl } from "./imageOptimize.js";
import { MUSIC_PROFILE, VOICE_PROFILE, audioNeedsWork, optimizeAudioDataUrl } from "./audioOptimize.js";

/** Campos que não são mídia do tour (links, capas geradas, miniaturas). */
const SKIP_KEYS = new Set(["share", "cloudShare", "thumb"]);

/**
 * Lista cada data: de mídia com o papel dele.
 * @returns {Map<string,{kind:"image"|"audio", profile?:object}>}
 */
export function collectProjectMedia(project, { images = true, audio = true } = {}) {
  const found = new Map();
  const seen = new WeakSet();
  function walk(node, path) {
    if (typeof node === "string") {
      if (!isMediaDataUrl(node) || found.has(node)) return;
      if (images && isOptimizableImage(node)) found.set(node, { kind: "image" });
      else if (audio && /^data:audio\//i.test(node)) {
        const music = path[0] === "narration" && path[1] === "background";
        found.set(node, { kind: "audio", profile: music ? MUSIC_PROFILE : VOICE_PROFILE });
      }
      return;
    }
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      node.forEach((item) => walk(item, path));
      return;
    }
    for (const key of Object.keys(node)) {
      if (path.length === 0 && SKIP_KEYS.has(key)) continue;
      walk(node[key], path.length < 3 ? [...path, key] : path);
    }
  }
  walk(project, []);
  return found;
}

/** Troca, no lugar, cada string do mapa (old → new). Devolve quantas trocou. */
export function replaceMediaStrings(target, map) {
  if (!map || !map.size) return 0;
  let count = 0;
  const seen = new WeakSet();
  function walk(node) {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    const keys = Array.isArray(node) ? node.keys() : Object.keys(node);
    for (const key of keys) {
      const value = node[key];
      if (typeof value === "string") {
        const next = map.get(value);
        if (next !== undefined && next !== value) {
          node[key] = next;
          count += 1;
        }
      } else if (value && typeof value === "object") walk(value);
    }
  }
  walk(target);
  return count;
}

/** Bytes da mídia como fica guardada (cada arquivo uma vez) + o resto do projeto. */
export function projectSizeBytes(project) {
  return mediaFootprint(project).bytes;
}

/**
 * Otimiza os arquivos de mídia. Não mexe no projeto: devolve o mapa de trocas.
 * @returns {Promise<{map: Map<string,string>, before:number, after:number, images:number, audio:number, changedImages:number, changedAudio:number}>}
 */
export async function optimizeProjectMedia(
  project,
  {
    images = true,
    audio = true,
    only,
    optimizeImage = optimizeImageDataUrl,
    optimizeAudio = optimizeAudioDataUrl,
    onProgress,
    signal,
  } = {}
) {
  const media = collectProjectMedia(project, { images, audio });
  const entries = [...media.entries()].filter(([src, info]) => {
    if (only && !only.has(src)) return false;
    if (info.kind === "audio") return audioNeedsWork(src, info.profile);
    return true;
  });
  const map = new Map();
  let changedImages = 0;
  let changedAudio = 0;
  let imageCount = 0;
  let audioCount = 0;
  for (let i = 0; i < entries.length; i += 1) {
    if (signal?.aborted) {
      const err = new Error("aborted");
      err.code = "aborted";
      throw err;
    }
    const [src, info] = entries[i];
    onProgress?.(i + 1, entries.length, info.kind);
    if (info.kind === "image") {
      imageCount += 1;
      const res = await optimizeImage(src);
      if (res?.changed && res.dataUrl && res.dataUrl !== src) {
        map.set(src, res.dataUrl);
        changedImages += 1;
      }
    } else {
      audioCount += 1;
      const res = await optimizeAudio(src, { profile: info.profile });
      if (res?.changed && res.dataUrl && res.dataUrl !== src) {
        map.set(src, res.dataUrl);
        changedAudio += 1;
      }
    }
  }
  const before = projectSizeBytes(project);
  let saved = 0;
  for (const [src, out] of map) saved += dataUrlByteLength(src) - dataUrlByteLength(out);
  return {
    map,
    before,
    after: Math.max(0, before - saved),
    images: imageCount,
    audio: audioCount,
    changedImages,
    changedAudio,
  };
}

/** Cópia profunda do projeto com as trocas aplicadas (o original fica intacto). */
export function applyMediaMap(project, map) {
  const copy = structuredClone(project);
  replaceMediaStrings(copy, map);
  return copy;
}
