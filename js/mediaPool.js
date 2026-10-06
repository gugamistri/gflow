/**
 * Guarda payloads data: uma vez e troca por fichas curtas nos snapshots.
 * why: structuredClone do projeto inteiro duplicava cada screenshot no undo.
 */

const TOKEN_PREFIX = "\u0000gf:";
const MIN_POOL_LENGTH = 64;

export function createMediaPool() {
  let seq = 0;
  const payloads = new Map();
  const byExact = new Map();

  function intern(dataUrl) {
    const existing = byExact.get(dataUrl);
    if (existing && payloads.has(existing)) return TOKEN_PREFIX + existing;
    const id = "m" + (++seq);
    byExact.set(dataUrl, id);
    payloads.set(id, dataUrl);
    return TOKEN_PREFIX + id;
  }

  function packString(value) {
    if (value.startsWith(TOKEN_PREFIX) && payloads.has(value.slice(TOKEN_PREFIX.length))) return value;
    if (value.startsWith("data:") && value.length >= MIN_POOL_LENGTH) return intern(value);
    return value;
  }

  function pack(value, seen = new WeakMap()) {
    if (typeof value === "string") return packString(value);
    if (!value || typeof value !== "object") return value;
    if (seen.has(value)) return seen.get(value);
    if (Array.isArray(value)) {
      const out = new Array(value.length);
      seen.set(value, out);
      for (let i = 0; i < value.length; i += 1) out[i] = pack(value[i], seen);
      return out;
    }
    const out = {};
    seen.set(value, out);
    for (const key of Object.keys(value)) out[key] = pack(value[key], seen);
    return out;
  }

  function unpack(value, seen = new WeakMap()) {
    if (typeof value === "string") {
      if (value.startsWith(TOKEN_PREFIX)) {
        const id = value.slice(TOKEN_PREFIX.length);
        if (payloads.has(id)) return payloads.get(id);
      }
      return value;
    }
    if (!value || typeof value !== "object") return value;
    if (seen.has(value)) return seen.get(value);
    if (Array.isArray(value)) {
      const out = new Array(value.length);
      seen.set(value, out);
      for (let i = 0; i < value.length; i += 1) out[i] = unpack(value[i], seen);
      return out;
    }
    const out = {};
    seen.set(value, out);
    for (const key of Object.keys(value)) out[key] = unpack(value[key], seen);
    return out;
  }

  function collect(value, ids, seen = new WeakSet()) {
    if (typeof value === "string") {
      if (value.startsWith(TOKEN_PREFIX)) ids.add(value.slice(TOKEN_PREFIX.length));
      return;
    }
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) collect(item, ids, seen);
      return;
    }
    for (const key of Object.keys(value)) collect(value[key], ids, seen);
  }

  function exportMedia(states) {
    const ids = new Set();
    for (const state of states) collect(state, ids);
    const media = {};
    for (const id of ids) {
      if (payloads.has(id)) media[id] = payloads.get(id);
    }
    return media;
  }

  function importMedia(media) {
    if (!media || typeof media !== "object") return;
    for (const [id, dataUrl] of Object.entries(media)) {
      if (!id || typeof dataUrl !== "string") continue;
      payloads.set(id, dataUrl);
      if (!byExact.has(dataUrl)) byExact.set(dataUrl, id);
      const match = /^m(\d+)$/.exec(id);
      if (match) seq = Math.max(seq, Number(match[1]));
    }
  }

  function retain(states) {
    const ids = new Set();
    for (const state of states) {
      if (state) collect(state, ids);
    }
    for (const id of [...payloads.keys()]) {
      if (ids.has(id)) continue;
      const dataUrl = payloads.get(id);
      payloads.delete(id);
      if (byExact.get(dataUrl) === id) byExact.delete(dataUrl);
    }
  }

  return { pack, unpack, exportMedia, importMedia, retain };
}
