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

/** Estado separado por conta. A chave antiga (sem e-mail) só existe para migrar. */
export function syncMetaKey(account) {
  const key = String(account || "").trim().toLowerCase();
  return key ? `${SYNC_META_KEY}:${key}` : SYNC_META_KEY;
}
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

/** O que sobe: o registro local sem id, sem cloudId, sem o link temporário (writeToken) e sem updatedAt. */
export function projectToSyncPayload(project) {
  const { id: _id, share: _share, updatedAt: _updatedAt, cloudId: _cloudId, ...rest } = project || {};
  return rest;
}

export function syncPayloadToProject(payload, { id, name, updatedAt } = {}) {
  const project = { ...(payload || {}) };
  delete project.share;
  delete project.cloudId;
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
    collabBlocked: {},
    settingsRevision: 0,
    settingsDirty: false,
    media: {},
    lastSyncAt: null,
  };
}

export function readMeta(storage, account) {
  const key = String(account || "").trim().toLowerCase();
  try {
    let raw = key ? storage?.getItem(syncMetaKey(key)) : null;
    if (!raw && key) {
      const legacy = storage?.getItem(SYNC_META_KEY);
      if (legacy) {
        const parsed = JSON.parse(legacy);
        // why: a chave única antiga zerava quando o e-mail mudava; só herda se a conta for a mesma
        if (parsed && parsed.v === 1 && parsed.account === key) {
          raw = legacy;
          try {
            storage.setItem(syncMetaKey(key), legacy);
            storage.removeItem(SYNC_META_KEY);
          } catch {
            /* se a chave nova não couber, segue lendo a antiga nesta sessão */
          }
        }
      }
    }
    const data = raw ? JSON.parse(raw) : null;
    if (!data || data.v !== 1 || data.account !== key) return emptyMeta(key);
    return { ...emptyMeta(key), ...data };
  } catch {
    return emptyMeta(key);
  }
}

export function writeMeta(storage, meta) {
  const key = String(meta?.account || "").trim().toLowerCase();
  if (!key) return;
  try {
    storage?.setItem(syncMetaKey(key), JSON.stringify(meta));
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
    // colaboração ativa: o servidor é a verdade (ops); o PATCH completo e o pull ficam de fora
    isCollab = () => false,
    onCollabActive = () => {},
    conflictName = (name) => `${name} (outra versão)`,
    debounceMs = 2500,
    pollMs = 60 * 1000,
    now = () => Date.now(),
    locks = typeof navigator !== "undefined" ? navigator.locks : null,
  } = deps;

  let meta = null;
  let enabled = false;
  let running = null;
  let again = false;
  let timer = null;
  let poll = null;
  let lockHeld = false;
  let serverList = null;
  const assetCache = new Map();
  let state = { phase: "off", done: 0, total: 0, error: "" };

  function setStatus(next) {
    state = { ...state, ...next };
    onStatus({ ...state, lastSyncAt: meta?.lastSyncAt || null });
  }

  let refreshStorageLock = () => {};

  function save() {
    refreshStorageLock();
    if (!meta?.account) return;
    // why: outra aba pode ter gravado o mapa enquanto esta só marcou dirty; sem o merge a chave inteira volta atrás
    if (!lockHeld) {
      const fresh = readMeta(storage, meta.account);
      meta.remote = { ...fresh.remote, ...meta.remote };
      for (const [localId, link] of Object.entries(fresh.remote || {})) {
        if (link?.id && meta.pendingDeletes?.[link.id]) delete meta.remote[localId];
      }
      meta.dirty = { ...fresh.dirty, ...meta.dirty };
      meta.pendingDeletes = { ...fresh.pendingDeletes, ...meta.pendingDeletes };
      meta.media = { ...fresh.media, ...meta.media };
      meta.collabBlocked = { ...(fresh.collabBlocked || {}), ...(meta.collabBlocked || {}) };
      if (fresh.initialDone) meta.initialDone = true;
      if ((fresh.cursor || "") > (meta.cursor || "")) meta.cursor = fresh.cursor;
      if ((fresh.lastSyncAt || "") > (meta.lastSyncAt || "")) meta.lastSyncAt = fresh.lastSyncAt;
      if ((fresh.settingsRevision || 0) > (meta.settingsRevision || 0)) meta.settingsRevision = fresh.settingsRevision;
      if (fresh.settingsDirty) meta.settingsDirty = true;
    }
    writeMeta(storage, meta);
  }

  function reloadMeta() {
    if (!meta?.account) return;
    meta = readMeta(storage, meta.account);
  }

  /**
   * Uma aba por vez. navigator.locks espera a outra; sem a API, uma trava no
   * localStorage com confirmação (no Node a confirmação é imediata: um só processo).
   */
  async function withSyncLock(fn) {
    if (lockHeld) return fn();
    const name = `guiaflow-sync:${meta?.account || "off"}`;
    if (locks && typeof locks.request === "function") {
      return locks.request(name, { mode: "exclusive" }, async () => {
        lockHeld = true;
        try {
          return await fn();
        } finally {
          lockHeld = false;
        }
      });
    }
    if (!storage) {
      lockHeld = true;
      try {
        return await fn();
      } finally {
        lockHeld = false;
      }
    }
    return withStorageLock(name, fn);
  }

  async function withStorageLock(name, fn) {
    const key = `${SYNC_META_KEY}:lock:${name}`;
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const ttl = 10 * 60 * 1000;
    const deadline = Date.now() + 30 * 1000;
    const settleMs = typeof document !== "undefined" ? 40 : 0;
    while (Date.now() < deadline) {
      let cur = null;
      try {
        cur = JSON.parse(storage.getItem(key) || "null");
      } catch {
        cur = null;
      }
      if (!cur || !(cur.until > Date.now())) {
        try {
          storage.setItem(key, JSON.stringify({ token, until: Date.now() + ttl }));
        } catch {
          break;
        }
        if (settleMs) await new Promise((resolve) => setTimeout(resolve, settleMs));
        let check = null;
        try {
          check = JSON.parse(storage.getItem(key) || "null");
        } catch {
          check = null;
        }
        if (check?.token === token) {
          const touch = () => {
            try {
              const held = JSON.parse(storage.getItem(key) || "null");
              if (held?.token === token) storage.setItem(key, JSON.stringify({ token, until: Date.now() + ttl }));
            } catch {
              /* a outra aba segue quando o prazo vence */
            }
          };
          lockHeld = true;
          const prevTouch = refreshStorageLock;
          refreshStorageLock = touch;
          try {
            return await fn();
          } finally {
            refreshStorageLock = prevTouch;
            lockHeld = false;
            try {
              const end = JSON.parse(storage.getItem(key) || "null");
              if (end?.token === token) storage.removeItem(key);
            } catch {
              storage.removeItem?.(key);
            }
          }
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    schedule(1000);
    return null;
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

  function collabOwned(localId) {
    return Boolean(isCollab(localId) || meta?.collabBlocked?.[localId]);
  }

  function notifyLocalChange(event) {
    if (!meta) return;
    if (event?.type === "put" && event.id) {
      if (collabOwned(event.id)) delete meta.dirty[event.id];
      else meta.dirty[event.id] = true;
    }
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

  async function stampCloudId(localId, remoteId) {
    if (!localId || !remoteId) return;
    const project = await store.getProject(localId);
    if (!project || project.cloudId === remoteId) return;
    project.cloudId = remoteId;
    await store.putProject(project, { silent: true, keepUpdatedAt: true });
  }

  async function ensureServerList() {
    if (serverList) return serverList;
    const res = await request("/projects", { method: "GET" });
    if (!res.ok) throw syncError(res);
    serverList = (Array.isArray(res.data?.projects) ? res.data.projects : []).filter((item) => item && !item.deletedAt);
    return serverList;
  }

  function noteServerProject(saved, { name, payload, clientId } = {}) {
    if (!serverList || !saved?.id) return;
    const row = {
      id: saved.id,
      clientId: saved.clientId ?? clientId ?? null,
      name: saved.name || name,
      revision: saved.revision,
      deletedAt: null,
      payload: saved.payload || payload,
    };
    const index = serverList.findIndex((item) => item.id === saved.id);
    if (index >= 0) serverList[index] = { ...serverList[index], ...row };
    else serverList.push(row);
  }

  function remoteTaken(remoteId, localId) {
    for (const [id, link] of Object.entries(meta.remote || {})) {
      if (id !== localId && link?.id === remoteId) return true;
    }
    return false;
  }

  /** Liga um projeto sem vínculo a um que já está na lista desta conta. Não cria. */
  async function matchUnlinked(project, hash) {
    const list = await ensureServerList();
    const cloudId = project?.cloudId || "";
    if (cloudId) {
      const byId = list.find((item) => item.id === cloudId);
      if (byId && !remoteTaken(byId.id, project.id)) return byId;
    }
    const clientHit = list.find((item) => item.clientId && item.clientId === project.id && !remoteTaken(item.id, project.id));
    if (clientHit) return clientHit;
    const name = String(project.name || "Projeto").slice(0, 200);
    for (const item of list) {
      if (!item?.id || item.name !== name || remoteTaken(item.id, project.id)) continue;
      let payload = item.payload;
      let revision = item.revision;
      if (!payload) {
        const full = await request(`/projects/${encodeURIComponent(item.id)}`, { method: "GET" });
        if (!full.ok) continue;
        payload = full.data?.project?.payload;
        revision = full.data?.project?.revision;
      }
      if (stableHash(payload) !== hash) continue;
      return { ...item, revision, payload };
    }
    return null;
  }

  async function resolvedLink(localId, project, hash) {
    let link = meta.remote[localId];
    if (!link?.id && project?.cloudId) {
      const listed = (await ensureServerList()).find((item) => item.id === project.cloudId);
      if (listed && !remoteTaken(listed.id, localId)) {
        link = { id: listed.id, rev: listed.revision, hash: "" };
        meta.remote[localId] = link;
      }
    }
    if (link?.id && link.rev == null) {
      const listed = (await ensureServerList()).find((item) => item.id === link.id);
      if (!listed || remoteTaken(listed.id, localId)) {
        delete meta.remote[localId];
        link = null;
      } else {
        link = { id: listed.id, rev: listed.revision, hash: link.hash || "" };
        meta.remote[localId] = link;
      }
    }
    if (!link?.id) {
      const match = await matchUnlinked(project, hash);
      if (match) {
        // hash vazio de propósito: o PATCH abaixo grava o vínculo em vez de um POST
        link = { id: match.id, rev: match.revision, hash: "" };
        meta.remote[localId] = link;
        await stampCloudId(localId, match.id);
        save();
      }
    }
    return link || null;
  }

  async function pushProject(localId) {
    const project = await store.getProject(localId);
    if (!project || collabOwned(localId)) {
      delete meta.dirty[localId];
      return;
    }
    if (skipProject(project) && !meta.remote[localId] && !project.cloudId) {
      delete meta.dirty[localId];
      return;
    }
    const { payload, assets } = await dehydrate(projectToSyncPayload(project), assetCache);
    const hash = stableHash(payload);
    let link = await resolvedLink(localId, project, hash);
    if (link && link.hash === hash) {
      delete meta.dirty[localId];
      save();
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
    if (!res.ok && res.status === 409 && res.error === "collab_active") {
      // o PATCH completo atropelaria as ops; a partir daqui este projeto só anda pelo canal de colaboração
      meta.collabBlocked = meta.collabBlocked || {};
      meta.collabBlocked[localId] = true;
      const server = res.data?.project;
      if (link && server?.revision != null) link.rev = server.revision;
      delete meta.dirty[localId];
      save();
      onCollabActive({ localId, remoteId: link?.id || server?.id || "", name: server?.name || name });
      return;
    }
    if (!res.ok && res.status === 404 && link) {
      if (serverList) serverList = serverList.filter((item) => item.id !== link.id);
      delete meta.remote[localId];
      const match = await matchUnlinked({ ...project, cloudId: "" }, hash);
      res = match
        ? await request(`/projects/${encodeURIComponent(match.id)}`, {
            method: "PATCH",
            body: JSON.stringify({ name, payload, revision: match.revision }),
          })
        : await request("/projects", { method: "POST", body: JSON.stringify({ name, payload, clientId: localId }) });
    }
    if (!res.ok) throw syncError(res);
    const saved = res.data?.project;
    meta.remote[localId] = { id: saved.id, rev: saved.revision, hash };
    delete meta.dirty[localId];
    noteServerProject(saved, { name, payload, clientId: localId });
    save();
    await stampCloudId(localId, saved.id);
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
    const locals = await store.listAllProjects();
    const localIds = new Set(locals.map((p) => p.id));
    const byCloudId = new Map();
    for (const project of locals) {
      if (project?.cloudId && !byCloudId.has(project.cloudId)) byCloudId.set(project.cloudId, project.id);
    }
    let changed = 0;
    for (const item of items) {
      const fromCloud = byCloudId.get(item.id);
      let localId = localIdFor(item.id) || null;
      if (!localId && fromCloud && (!meta.remote[fromCloud] || meta.remote[fromCloud].id === item.id)) {
        localId = fromCloud;
      }
      if (!localId && item.clientId && localIds.has(item.clientId) && !meta.remote[item.clientId]) {
        // mesmo projeto já está aqui (id local = clientId): adota sem baixar de novo
        localId = item.clientId;
        if (item.deletedAt) continue;
        meta.remote[localId] = { id: item.id, rev: item.revision, hash: "" };
        meta.dirty[localId] = true;
        await stampCloudId(localId, item.id);
        continue;
      }
      if (!localId && item.clientId && localIds.has(item.clientId) && meta.remote[item.clientId]?.id && meta.remote[item.clientId].id !== item.id) {
        // o id local já pertence a outro remoto; não inventa um terceiro
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
      if (localId && collabOwned(localId)) continue;
      if (link && link.rev === item.revision) continue;
      if (localId && (meta.dirty[localId] || isProjectBusy(localId))) continue;
      const full = await request(`/projects/${encodeURIComponent(item.id)}`, { method: "GET" });
      if (!full.ok) {
        if (full.status === 404) continue;
        throw syncError(full);
      }
      const payload = await hydrate(full.data.project.payload || {}, cachedFetchAsset);
      // clientId, quando existe, é o id local. Id aleatório só para projeto antigo sem clientId.
      const id = localId || item.clientId || store.createProjectId();
      const project = syncPayloadToProject(payload, {
        id,
        name: full.data.project.name,
        updatedAt: Date.parse(full.data.project.updatedAt),
      });
      project.cloudId = item.id;
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
    reloadMeta();
    serverList = null;
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
        let ran = false;
        await withSyncLock(async () => {
          ran = true;
          do {
            again = false;
            await runOnce();
          } while (again && enabled);
        });
        if (ran && enabled) setStatus({ phase: "synced", error: "" });
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
    // why: "conta" (sessão sem e-mail) alternava a chave e zerava o mapa, e o próximo sync fazia POST de tudo
    if (!key || !key.includes("@")) return Promise.resolve({ ...state, lastSyncAt: meta?.lastSyncAt || null });
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
