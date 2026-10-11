/**
 * Sincronização de projetos do GuiaFlow Pro.
 * why: no Pro os projetos sobem para a conta e voltam num navegador limpo.
 *      O IndexedDB continua sendo o cache offline; a nuvem é a cópia da conta.
 * hazard: mídia (data:) nunca vai dentro do JSON do projeto; sobe como
 *         asset:<sha256> (PUT /media/:sha) e volta como data: ao baixar.
 * Conflito (409): mantém as duas versões — a do servidor vira uma cópia local nova.
 */

import { bytesToDataUrl, dataUrlToBytes, sha256Hex } from "./mediaBytes.js";

export { bytesToDataUrl, dataUrlToBytes, sha256Hex };

export const SYNC_META_KEY = "guiaflow.sync.v1";
export const ASSET_PREFIX = "asset:";
const MEDIA_MIN_CHARS = 512;
const CURSOR_OVERLAP_MS = 60 * 1000;
const DATA_URL_RE = /^data:((?:image|audio|video)\/[a-z0-9.+-]+)(;[^,]*)?,/i;

/* ---------- mídia ---------- */

export function isSyncableDataUrl(value) {
  return typeof value === "string" && value.length >= MEDIA_MIN_CHARS && DATA_URL_RE.test(value);
}

/** Troca cada data: grande por asset:<sha>. Devolve o payload e os arquivos a subir. */
export async function dehydrate(value, cache = new Map()) {
  const assets = new Map();
  async function walk(node) {
    if (typeof node === "string") {
      if (!isSyncableDataUrl(node)) return node;
      let entry = cache.get(node);
      if (!entry) {
        const { mime, bytes } = dataUrlToBytes(node);
        entry = { sha: await sha256Hex(bytes), mime, bytes };
        cache.set(node, entry);
      }
      assets.set(entry.sha, entry);
      return ASSET_PREFIX + entry.sha;
    }
    if (Array.isArray(node)) {
      const out = [];
      for (const item of node) out.push(await walk(item));
      return out;
    }
    if (node && typeof node === "object") {
      const out = {};
      for (const [key, item] of Object.entries(node)) out[key] = await walk(item);
      return out;
    }
    return node;
  }
  const payload = await walk(value);
  return { payload, assets };
}

export function collectAssetRefs(value, found = new Set()) {
  if (typeof value === "string") {
    if (value.startsWith(ASSET_PREFIX) && /^[a-f0-9]{64}$/.test(value.slice(ASSET_PREFIX.length))) {
      found.add(value.slice(ASSET_PREFIX.length));
    }
  } else if (Array.isArray(value)) {
    for (const item of value) collectAssetRefs(item, found);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectAssetRefs(item, found);
  }
  return found;
}

/** Troca asset:<sha> de volta por data:. `fetchAsset(sha)` → data URL. */
export async function hydrate(value, fetchAsset) {
  const urls = new Map();
  for (const sha of collectAssetRefs(value)) urls.set(sha, await fetchAsset(sha));
  function walk(node) {
    if (typeof node === "string") {
      if (!node.startsWith(ASSET_PREFIX)) return node;
      const url = urls.get(node.slice(ASSET_PREFIX.length));
      return url || node;
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      const out = {};
      for (const [key, item] of Object.entries(node)) out[key] = walk(item);
      return out;
    }
    return node;
  }
  return walk(value);
}

/* ---------- projeto ↔ payload ---------- */

/** O que sobe: o registro local sem id, sem o link temporário (writeToken) e sem updatedAt. */
export function projectToSyncPayload(project) {
  const { id: _id, share: _share, updatedAt: _updatedAt, ...rest } = project || {};
  return rest;
}

export function syncPayloadToProject(payload, { id, name, updatedAt } = {}) {
  const project = { ...(payload || {}) };
  delete project.share;
  project.id = id;
  if (name) project.name = name;
  if (!Array.isArray(project.steps)) project.steps = [];
  if (!project.customImages || typeof project.customImages !== "object") project.customImages = {};
  if (!project.createdAt) project.createdAt = Date.now();
  project.updatedAt = Number.isFinite(updatedAt) ? updatedAt : Date.now();
  return project;
}

export function stableHash(value) {
  // why: FNV-1a basta para saber se o payload (já sem mídia) mudou desde o último envio
  const text = JSON.stringify(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${text.length.toString(36)}-${h.toString(36)}`;
}

/* ---------- temas personalizados ---------- */

export function mergeCustomThemes(local = [], remote = [], { preferLocal = false } = {}) {
  const byId = new Map();
  const order = [];
  const add = (theme, win) => {
    const key = theme?.id || theme?.customId || JSON.stringify(theme);
    if (!byId.has(key)) order.push(key);
    if (!byId.has(key) || win) byId.set(key, theme);
  };
  for (const theme of remote || []) add(theme, !preferLocal);
  for (const theme of local || []) add(theme, preferLocal);
  return order.map((key) => byId.get(key));
}

/* ---------- metadados ---------- */

export function emptyMeta(account = "") {
  return {
    v: 1,
    account,
    cursor: null,
    initialDone: false,
    remote: {},
    dirty: {},
    pendingDeletes: {},
    settingsRevision: 0,
    settingsDirty: false,
    media: {},
    lastSyncAt: null,
  };
}

export function readMeta(storage, account) {
  try {
    const raw = storage?.getItem(SYNC_META_KEY);
    const data = raw ? JSON.parse(raw) : null;
    if (!data || data.v !== 1 || data.account !== account) return emptyMeta(account);
    return { ...emptyMeta(account), ...data };
  } catch {
    return emptyMeta(account);
  }
}

export function writeMeta(storage, meta) {
  try {
    storage?.setItem(SYNC_META_KEY, JSON.stringify(meta));
  } catch {
    /* cota cheia: a sincronização segue, só perde o estado ao recarregar */
  }
}

/* ---------- motor ---------- */

/**
 * @param {object} deps
 * @param {(path:string, init?:object)=>Promise<{ok:boolean,status?:number,error?:string,data?:any}>} deps.request JSON na nuvem (cloudFetch)
 * @param {(sha:string)=>Promise<string>} deps.fetchAsset devolve data URL
 * @param {(sha:string, bytes:Uint8Array, mime:string)=>Promise<{ok:boolean,status?:number,error?:string}>} deps.uploadAsset
 * @param {object} deps.store listAllProjects/getProject/putProject/deleteProject/getCustomThemes/saveCustomThemes/createProjectId
 */
export function createCloudSync(deps) {
  const {
    request,
    fetchAsset,
    uploadAsset,
    store,
    storage = typeof localStorage !== "undefined" ? localStorage : null,
    onStatus = () => {},
    onRemoteChange = () => {},
    isProjectBusy = () => false,
    skipProject = () => false,
    conflictName = (name) => `${name} (outra versão)`,
    debounceMs = 2500,
    pollMs = 60 * 1000,
    now = () => Date.now(),
  } = deps;

  let meta = null;
  let enabled = false;
  let running = null;
  let again = false;
  let timer = null;
  let poll = null;
  const assetCache = new Map();
  let state = { phase: "off", done: 0, total: 0, error: "" };

  function setStatus(next) {
    state = { ...state, ...next };
    onStatus({ ...state, lastSyncAt: meta?.lastSyncAt || null });
  }

  function save() {
    if (meta) writeMeta(storage, meta);
  }

  function localIdFor(remoteId) {
    for (const [localId, link] of Object.entries(meta.remote)) if (link.id === remoteId) return localId;
    return null;
  }

  function schedule(delay = debounceMs) {
    if (!enabled) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      syncNow();
    }, delay);
    timer?.unref?.(); // Node (testes): não segura o processo
  }

  function notifyLocalChange(event) {
    if (!meta) return;
    if (event?.type === "put" && event.id) meta.dirty[event.id] = true;
    if (event?.type === "delete" && event.id) {
      const link = meta.remote[event.id];
      if (link) meta.pendingDeletes[link.id] = true;
      delete meta.remote[event.id];
      delete meta.dirty[event.id];
    }
    if (event?.type === "settings") meta.settingsDirty = true;
    save();
    schedule();
  }

  async function uploadMissing(assets) {
    const hashes = [...assets.keys()].filter((sha) => !meta.media[sha]);
    if (!hashes.length) return;
    const missing = new Set(hashes);
    for (let i = 0; i < hashes.length; i += 500) {
      const res = await request("/media/check", { method: "POST", body: JSON.stringify({ hashes: hashes.slice(i, i + 500) }) });
      if (!res.ok) throw syncError(res);
      const stillMissing = new Set(res.data?.missing || []);
      for (const sha of hashes.slice(i, i + 500)) {
        if (!stillMissing.has(sha)) {
          missing.delete(sha);
          meta.media[sha] = 1;
        }
      }
    }
    for (const sha of missing) {
      const entry = assets.get(sha);
      const res = await uploadAsset(sha, entry.bytes, entry.mime);
      if (!res.ok) throw syncError(res);
      meta.media[sha] = 1;
    }
    save();
  }

  async function forkServerCopy(serverProject) {
    const payload = await hydrate(serverProject.payload || {}, cachedFetchAsset);
    const copy = syncPayloadToProject(payload, {
      id: store.createProjectId(),
      name: conflictName(serverProject.name || payload.name || ""),
    });
    delete copy.cloudShare;
    await store.putProject(copy, { silent: true });
    // a cópia é um projeto novo: sobe como tal na próxima volta
    meta.dirty[copy.id] = true;
    return copy;
  }

  async function pushProject(localId) {
    const project = await store.getProject(localId);
    if (!project) {
      delete meta.dirty[localId];
      return;
    }
    if (skipProject(project) && !meta.remote[localId]) {
      delete meta.dirty[localId];
      return;
    }
    const { payload, assets } = await dehydrate(projectToSyncPayload(project), assetCache);
    const hash = stableHash(payload);
    const link = meta.remote[localId];
    if (link && link.hash === hash) {
      delete meta.dirty[localId];
      return;
    }
    await uploadMissing(assets);
    const name = String(project.name || "Projeto").slice(0, 200);
    const body = JSON.stringify({ name, payload, ...(link ? { revision: link.rev } : { clientId: localId }) });
    let res = link
      ? await request(`/projects/${encodeURIComponent(link.id)}`, { method: "PATCH", body })
      : await request("/projects", { method: "POST", body });

    if (!res.ok && res.status === 409 && res.error === "client_id_exists") {
      const existing = res.data?.project;
      res = await request(`/projects/${encodeURIComponent(existing.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ name, payload, revision: existing.revision }),
      });
    }
    if (!res.ok && res.status === 409 && res.error === "revision_conflict" && res.data?.project) {
      // as duas versões ficam: a do servidor vira cópia local; a local sobrescreve com o revision novo
      await forkServerCopy(res.data.project);
      res = await request(`/projects/${encodeURIComponent(res.data.project.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ name, payload, revision: res.data.project.revision }),
      });
    }
    if (!res.ok && res.status === 404 && link) {
      delete meta.remote[localId];
      res = await request("/projects", { method: "POST", body: JSON.stringify({ name, payload, clientId: localId }) });
    }
    if (!res.ok) throw syncError(res);
    const saved = res.data?.project;
    meta.remote[localId] = { id: saved.id, rev: saved.revision, hash };
    delete meta.dirty[localId];
    save();
  }

  async function cachedFetchAsset(sha) {
    if (assetCache.has(sha)) return assetCache.get(sha);
    const url = await fetchAsset(sha);
    if (url) {
      assetCache.set(sha, url);
      meta.media[sha] = 1;
    }
    return url;
  }

  async function pull() {
    const since = meta.cursor ? new Date(Date.parse(meta.cursor) - CURSOR_OVERLAP_MS).toISOString() : "";
    const res = await request(since ? `/projects?since=${encodeURIComponent(since)}` : "/projects", { method: "GET" });
    if (!res.ok) throw syncError(res);
    const items = Array.isArray(res.data?.projects) ? res.data.projects : [];
    const localIds = new Set((await store.listAllProjects()).map((p) => p.id));
    let changed = 0;
    for (const item of items) {
      let localId = localIdFor(item.id);
      if (!localId && item.clientId && localIds.has(item.clientId) && !meta.remote[item.clientId]) {
        // mesmo projeto já está aqui (id local = clientId): adota sem baixar de novo
        localId = item.clientId;
        if (item.deletedAt) continue;
        meta.remote[localId] = { id: item.id, rev: item.revision, hash: "" };
        meta.dirty[localId] = true;
        continue;
      }
      if (item.deletedAt) {
        if (!localId) continue;
        if (meta.dirty[localId] || isProjectBusy(localId)) {
          // apagado noutro lugar mas mexido aqui: fica e sobe de novo
          delete meta.remote[localId];
          meta.dirty[localId] = true;
          continue;
        }
        await store.deleteProject(localId, { silent: true });
        delete meta.remote[localId];
        changed += 1;
        onRemoteChange({ type: "delete", id: localId });
        continue;
      }
      const link = localId ? meta.remote[localId] : null;
      if (link && link.rev === item.revision) continue;
      if (localId && (meta.dirty[localId] || isProjectBusy(localId))) continue;
      const full = await request(`/projects/${encodeURIComponent(item.id)}`, { method: "GET" });
      if (!full.ok) {
        if (full.status === 404) continue;
        throw syncError(full);
      }
      const payload = await hydrate(full.data.project.payload || {}, cachedFetchAsset);
      const id = localId || (item.clientId && !localIds.has(item.clientId) ? item.clientId : store.createProjectId());
      const project = syncPayloadToProject(payload, {
        id,
        name: full.data.project.name,
        updatedAt: Date.parse(full.data.project.updatedAt),
      });
      await store.putProject(project, { silent: true, keepUpdatedAt: true });
      localIds.add(id);
      const { payload: clean } = await dehydrate(projectToSyncPayload(project), assetCache);
      meta.remote[id] = { id: item.id, rev: full.data.project.revision, hash: stableHash(clean) };
      changed += 1;
      onRemoteChange({ type: "put", id });
    }
    if (res.data?.serverTime) meta.cursor = res.data.serverTime;
    save();
    return changed;
  }

  async function syncSettings() {
    const res = await request("/settings", { method: "GET" });
    if (!res.ok) throw syncError(res);
    const remote = res.data?.settings || { payload: {}, revision: 0 };
    const local = store.getCustomThemes() || [];
    const merged = mergeCustomThemes(local, remote.payload?.customThemes || [], { preferLocal: meta.settingsDirty });
    if (stableHash(merged) !== stableHash(local)) store.saveCustomThemes(merged, { silent: true });
    if (stableHash(merged) !== stableHash(remote.payload?.customThemes || []) ) {
      const put = await request("/settings", {
        method: "PUT",
        body: JSON.stringify({ payload: { ...(remote.payload || {}), customThemes: merged }, revision: remote.revision || 0 }),
      });
      if (!put.ok && put.status !== 409) throw syncError(put);
      if (put.ok) meta.settingsRevision = put.data.settings.revision;
      else meta.settingsDirty = true; // outro navegador gravou no meio; tenta na próxima volta
    } else {
      meta.settingsRevision = remote.revision || 0;
    }
    if (meta.settingsDirty && stableHash(merged) === stableHash(store.getCustomThemes() || [])) meta.settingsDirty = false;
    save();
  }

  async function runOnce() {
    if (!meta.initialDone) {
      for (const project of await store.listAllProjects()) {
        if (!meta.remote[project.id] && !skipProject(project)) meta.dirty[project.id] = true;
      }
      save();
    }
    for (const remoteId of Object.keys(meta.pendingDeletes)) {
      const res = await request(`/projects/${encodeURIComponent(remoteId)}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw syncError(res);
      delete meta.pendingDeletes[remoteId];
      save();
    }
    const dirty = Object.keys(meta.dirty);
    setStatus({ phase: "syncing", done: 0, total: dirty.length, error: "" });
    let done = 0;
    for (const localId of dirty) {
      await pushProject(localId);
      done += 1;
      setStatus({ phase: "syncing", done, total: dirty.length });
    }
    await pull();
    // cópias criadas por conflito no pull/push sobem já nesta volta
    for (const localId of Object.keys(meta.dirty)) await pushProject(localId);
    await syncSettings();
    meta.initialDone = true;
    meta.lastSyncAt = new Date(now()).toISOString();
    save();
  }

  async function syncNow() {
    if (!enabled) return state;
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await runOnce();
        } while (again && enabled);
        setStatus({ phase: "synced", error: "" });
      } catch (err) {
        if (err?.code === "subscription_required" || err?.status === 402) {
          enabled = false;
          setStatus({ phase: "inactive", error: "subscription_required" });
        } else if (err?.code === "unauthorized" || err?.status === 401) {
          setStatus({ phase: "error", error: "unauthorized" });
        } else if (err?.code === "network" || err?.code === "timeout" || (typeof navigator !== "undefined" && navigator.onLine === false)) {
          setStatus({ phase: "offline", error: err?.code || "network" });
          schedule(30 * 1000);
        } else {
          console.error("sync", err);
          setStatus({ phase: "error", error: err?.code || "sync_failed" });
          schedule(60 * 1000);
        }
      } finally {
        running = null;
      }
      return state;
    })();
    return running;
  }

  function enable(account) {
    const key = String(account || "").trim().toLowerCase();
    if (enabled && meta?.account === key) return syncNow();
    meta = readMeta(storage, key);
    enabled = true;
    clearInterval(poll);
    if (pollMs > 0) {
      poll = setInterval(() => {
        if (typeof document === "undefined" || document.visibilityState !== "hidden") syncNow();
      }, pollMs);
      poll?.unref?.();
    }
    return syncNow();
  }

  function disable(phase = "off") {
    enabled = false;
    clearTimeout(timer);
    clearInterval(poll);
    poll = null;
    setStatus({ phase, done: 0, total: 0, error: "" });
  }

  return {
    enable,
    disable,
    syncNow,
    notifyLocalChange,
    isEnabled: () => enabled,
    getState: () => ({ ...state, lastSyncAt: meta?.lastSyncAt || null }),
    getMeta: () => meta,
    remoteSlugs: () => null,
  };
}

function syncError(res) {
  const err = new Error(res?.error || `http_${res?.status || 0}`);
  err.code = res?.error || "";
  err.status = res?.status || 0;
  return err;
}

/* ---------- restaurar projetos dos links publicados ---------- */

/**
 * Links permanentes do dono sem projeto local viram projetos de novo.
 * @returns {Promise<{restored:number, total:number}>}
 */
export async function restoreFromPublishedLinks({ request, store, toProject, slugOf }) {
  const mine = await request("/shares/mine", { method: "GET" });
  if (!mine.ok) throw syncError(mine);
  const shares = Array.isArray(mine.data?.shares) ? mine.data.shares : [];
  const local = await store.listAllProjects();
  const have = new Set(local.map((p) => slugOf(p.cloudShare)).filter(Boolean));
  let restored = 0;
  for (const share of shares) {
    if (!share?.slug || have.has(share.slug)) continue;
    const res = await request(`/api/shares/${encodeURIComponent(share.slug)}`, { method: "GET", auth: false });
    if (!res.ok || !res.data?.payload) continue;
    const project = toProject(res.data.payload, { name: share.title || res.data.title || res.data.payload.name });
    project.cloudShare = {
      id: share.slug,
      slug: share.slug,
      url: share.url,
      updatedAt: share.updatedAt,
      publishedAt: Date.parse(share.updatedAt || share.createdAt) || Date.now(),
    };
    await store.putProject(project);
    have.add(share.slug);
    restored += 1;
  }
  return { restored, total: shares.length };
}
