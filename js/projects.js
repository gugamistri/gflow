/**
 * Biblioteca de projetos: IndexedDB + índice em localStorage
 */

import {
  cloneTheme,
  defaultTheme,
  themePreviewDots,
  THEME_PRESETS,
} from "./themes.js";
import { defaultNarration, defaultPlayback, ensureNarration, ensurePlayback } from "./playback.js";
import { t } from "./i18n.js";
import { downscaleImageUrl, isHeavyDataUrl, thumbKey } from "./thumbs.js";
import { fixedStepsForPayload, normalizeEndStep, normalizeStartStep } from "./fixedSteps.js";
import {
  collectMediaRefs,
  createMediaCodec,
  externalizeMedia,
  internalizeMedia,
  mediaFootprint,
  parseMediaToken,
} from "./mediaStore.js";
import { dataUrlToBytes } from "./mediaBytes.js";

const DB_NAME = "demo-studio";
const DB_VERSION = 3;
const STORE = "projects";
const HISTORY_STORE = "history";
const CLIPBOARD_STORE = "clipboard";
const CLIPBOARD_KEY = "steps";
const INDEX_KEY = "demo-studio-index-v2";
const LEGACY_KEYS = ["interactive-demo-v1"];
const DEFAULT_JSON_URL = "data/demo.json";
/** Bump when data/demo.json muda — reinstala o tour de exemplo sem apagar outros projetos. */
const SEED_REVISION = 4;
export const STOCK_DEMO_NAME = "Como usar o Guia";

/**
 * Arquivos de mídia (Blob por sha256) num banco à parte.
 * why: subir a versão do "demo-studio" quebraria o save de abas antigas abertas (VersionError);
 *      banco separado não mexe no que já existe.
 */
const MEDIA_DB_NAME = "demo-studio-media";
const MEDIA_DB_VERSION = 1;
const MEDIA_STORE = "media";
const MEDIA_LOCK = "guiaflow-media";

const DEFAULT_SCENE_LABELS = {
  1: "Cena 1",
};

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(HISTORY_STORE)) {
        db.createObjectStore(HISTORY_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(CLIPBOARD_STORE)) {
        db.createObjectStore(CLIPBOARD_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openMediaDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(MEDIA_DB_NAME, MEDIA_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(MEDIA_STORE)) {
        db.createObjectStore(MEDIA_STORE, { keyPath: "sha" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const codec = createMediaCodec();
/** Safari antigo não guarda Blob no IndexedDB; cai para ArrayBuffer uma vez e segue. */
let storeBlobs = typeof Blob !== "undefined";

/**
 * why: o GC (exclusivo) nunca roda no meio de um save (compartilhado) noutra aba —
 *      senão apagaria um arquivo que o registro que está sendo gravado acabou de citar.
 */
function withMediaLock(mode, fn) {
  const locks = typeof navigator !== "undefined" ? navigator.locks : null;
  if (!locks?.request) return mode === "exclusive" ? Promise.resolve(null) : fn();
  return locks.request(MEDIA_LOCK, { mode }, fn);
}

function mediaRowFor(sha, entry) {
  const bytes = entry.bytes || dataUrlToBytes(entry.dataUrl).bytes;
  const data = storeBlobs ? new Blob([bytes], { type: entry.mime }) : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return storeBlobs
    ? { sha, mime: entry.mime, size: entry.size, blob: data, storedAt: Date.now() }
    : { sha, mime: entry.mime, size: entry.size, bytes: data, storedAt: Date.now() };
}

/** Grava os arquivos que ainda não existem (getKey antes do put: não regrava a cada autosave). */
async function putMediaFiles(blobs) {
  if (!blobs || !blobs.size) return;
  const attempt = () =>
    openMediaDb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(MEDIA_STORE, "readwrite");
          const store = tx.objectStore(MEDIA_STORE);
          for (const [sha, entry] of blobs) {
            const probe = typeof store.getKey === "function" ? store.getKey(sha) : store.count(sha);
            probe.onsuccess = () => {
              const exists = typeof store.getKey === "function" ? probe.result !== undefined : probe.result > 0;
              if (exists) return;
              try {
                store.put(mediaRowFor(sha, entry));
              } catch (err) {
                tx.abort();
                reject(err);
              }
            };
          }
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error || new Error("IndexedDB error"));
          };
          tx.onabort = () => {
            db.close();
            reject(tx.error || new Error("IndexedDB abort"));
          };
        })
    );
  try {
    await attempt();
  } catch (err) {
    if (!storeBlobs) throw err;
    storeBlobs = false;
    await attempt();
  }
}

async function loadMediaFiles(shas) {
  const rows = new Map();
  if (!shas.length) return rows;
  const db = await openMediaDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(MEDIA_STORE, "readonly");
    const store = tx.objectStore(MEDIA_STORE);
    for (const sha of shas) {
      const req = store.get(sha);
      req.onsuccess = () => {
        if (req.result) rows.set(sha, req.result);
      };
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("IndexedDB error"));
    tx.onabort = () => reject(tx.error || new Error("IndexedDB abort"));
  }).finally(() => db.close());
  return rows;
}

async function hydrate(record) {
  if (!record) return record;
  const { value } = await internalizeMedia(record, codec, loadMediaFiles);
  return value;
}

/** Arquivos primeiro, registro depois: um registro gravado nunca cita arquivo que não existe. */
async function externalizeForDisk(values, writeRecords) {
  return withMediaLock("shared", async () => {
    const out = [];
    const blobs = new Map();
    for (const value of values) {
      if (value == null) {
        out.push(value);
        continue;
      }
      const ext = await externalizeMedia(value, codec);
      for (const [sha, entry] of ext.blobs) if (!blobs.has(sha)) blobs.set(sha, entry);
      out.push(ext.value);
    }
    await putMediaFiles(blobs);
    return writeRecords(out);
  });
}

/**
 * Apaga arquivos que nenhum projeto, histórico ou área de transferência cita.
 * @returns {Promise<{removed:number, kept:number}|null>} null quando não deu para travar com segurança
 */
export async function collectMediaGarbage({ unlocked = false } = {}) {
  const run = async () => {
    const refs = new Map();
    const db = await openDb();
    try {
      for (const name of [STORE, HISTORY_STORE, CLIPBOARD_STORE]) {
        if (!db.objectStoreNames.contains(name)) continue;
        const rows = await new Promise((resolve, reject) => {
          const req = db.transaction(name, "readonly").objectStore(name).getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error);
        });
        for (const row of rows) collectMediaRefs(row, refs);
      }
    } finally {
      db.close();
    }
    const mediaDb = await openMediaDb();
    let removed = 0;
    let kept = 0;
    await new Promise((resolve, reject) => {
      const tx = mediaDb.transaction(MEDIA_STORE, "readwrite");
      const store = tx.objectStore(MEDIA_STORE);
      const req = store.getAllKeys();
      req.onsuccess = () => {
        for (const sha of req.result || []) {
          if (refs.has(sha)) kept += 1;
          else {
            store.delete(sha);
            removed += 1;
          }
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("IndexedDB error"));
      tx.onabort = () => reject(tx.error || new Error("IndexedDB abort"));
    }).finally(() => mediaDb.close());
    return { removed, kept };
  };
  // why: sem Web Locks não há como saber se outra aba está no meio de um save; os testes pedem unlocked
  return unlocked ? run() : withMediaLock("exclusive", run);
}

let gcTimer = null;
function scheduleMediaGarbage(delay = 4000) {
  if (typeof setTimeout === "undefined") return;
  clearTimeout(gcTimer);
  gcTimer = setTimeout(() => {
    gcTimer = null;
    collectMediaGarbage().catch((err) => console.warn("media gc", err));
  }, delay);
  gcTimer?.unref?.();
}

/**
 * Executa operações IDB sem `await` no meio da transaction
 * (evita auto-commit prematuro em Chrome/Safari).
 * `fn(store)` deve apenas disparar requests síncronamente e
 * devolver o IDBRequest principal (ou void).
 */
function withStore(mode, fn, storeName = STORE) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        let primaryReq = null;
        try {
          primaryReq = fn(store) || null;
        } catch (err) {
          db.close();
          reject(err);
          return;
        }
        tx.oncomplete = () => {
          const value = primaryReq ? primaryReq.result : undefined;
          db.close();
          resolve(value);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error || new Error("IndexedDB error"));
        };
        tx.onabort = () => {
          db.close();
          reject(tx.error || new Error("IndexedDB abort"));
        };
      })
  );
}

/** why: a sincronização do Pro ouve as gravações locais; o que ela mesma grava vem com { silent: true } */
const changeListeners = new Set();

export function onLocalProjectChange(listener) {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

function emitChange(event) {
  for (const listener of changeListeners) {
    try {
      listener(event);
    } catch (err) {
      console.error(err);
    }
  }
}

export function createProjectId() {
  return "proj-" + Math.random().toString(36).slice(2, 10);
}

/** Grava um ou mais passos para colar noutra aba do mesmo origin. */
export async function putStepClipboard(entry) {
  const steps = Array.isArray(entry?.steps)
    ? entry.steps.filter(Boolean)
    : entry?.step
      ? [entry.step]
      : [];
  const record = {
    id: CLIPBOARD_KEY,
    updatedAt: Date.now(),
    step: steps[0] || null,
    steps,
    images: entry?.images || {},
  };
  await withStore("readwrite", (store) => store.put(record), CLIPBOARD_STORE);
  return record;
}

export async function getStepClipboard() {
  const record = await withStore("readonly", (store) => store.get(CLIPBOARD_KEY), CLIPBOARD_STORE);
  const steps = Array.isArray(record?.steps) && record.steps.length
    ? record.steps
    : record?.step
      ? [record.step]
      : [];
  if (!steps.length) return null;
  return { ...record, steps, step: steps[0], images: record.images || {} };
}

export function readIndex() {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) {
      return { activeProjectId: null, projects: [], customThemes: [], migrated: false, seedRevision: 0 };
    }
    const data = JSON.parse(raw);
    return {
      activeProjectId: data.activeProjectId || null,
      projects: Array.isArray(data.projects) ? data.projects : [],
      customThemes: Array.isArray(data.customThemes) ? data.customThemes : [],
      migrated: Boolean(data.migrated),
      seedRevision: Number(data.seedRevision) || 0,
    };
  } catch {
    return { activeProjectId: null, projects: [], customThemes: [], migrated: false, seedRevision: 0 };
  }
}

export function writeIndex(index) {
  localStorage.setItem(
    INDEX_KEY,
    JSON.stringify({
      activeProjectId: index.activeProjectId || null,
      projects: index.projects || [],
      customThemes: index.customThemes || [],
      migrated: Boolean(index.migrated),
      seedRevision: Number(index.seedRevision) || 0,
    })
  );
}

function coverSource(project) {
  const firstImage = (project.steps || []).find(
    (s) => s.type !== "slide" && s.image
  )?.image;
  if (!firstImage) return null;
  let src = firstImage;
  if (firstImage.startsWith("custom:")) {
    src = project.customImages?.[firstImage.slice(7)]?.dataUrl || "";
    if (!src) return null;
  }
  const token = parseMediaToken(src);
  if (token) return { kind: "media", sha: token.sha };
  if (src.startsWith("data:image/")) return { kind: "data", dataUrl: src };
  return { kind: "path", path: src };
}

function coverSignature(project) {
  const cover = coverSource(project);
  if (!cover) return "";
  if (cover.kind === "path") return `path:${cover.path}`;
  if (cover.kind === "media") return `media:${cover.sha}`;
  return `img:${thumbKey(cover.dataUrl)}:${cover.dataUrl.length}`;
}

async function libraryThumbFor(project) {
  const cover = coverSource(project);
  if (!cover) return null;
  if (cover.kind === "path") return cover.path;
  let dataUrl = cover.dataUrl;
  if (cover.kind === "media") {
    dataUrl = codec.cachedUrl(cover.sha);
    if (!dataUrl) {
      const { value } = await internalizeMedia(`\u0001gfm:${cover.sha}:0`, codec, loadMediaFiles);
      dataUrl = typeof value === "string" && value.startsWith("data:") ? value : "";
    }
  }
  if (!dataUrl) return null;
  return (await downscaleImageUrl(dataUrl, { maxEdge: 480, quality: 0.72 })) || null;
}

async function summarizeProject(project, previous) {
  const thumbSig = coverSignature(project);
  let thumb = null;
  const reusable =
    previous &&
    previous.thumbSig === thumbSig &&
    typeof previous.thumb === "string" &&
    previous.thumb &&
    !isHeavyDataUrl(previous.thumb);
  if (reusable) thumb = previous.thumb;
  else if (!thumbSig) thumb = null;
  else {
    try {
      thumb = await libraryThumbFor(project);
    } catch {
      thumb = null;
    }
  }

  return {
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    stepCount: Array.isArray(project.steps) ? project.steps.length : 0,
    sizeBytes: mediaFootprint(project).bytes,
    thumb,
    thumbSig,
    themePreview: themePreviewDots(project.theme),
    // why: a / só manda para o editor quem tem projeto próprio — o exemplo intocado não conta
    stock: isUntouchedStockDemo(project),
    // GUI-33: cliente/marca do projeto (opcional). Ausente = «Sem cliente».
    ...(typeof project.workspaceClientId === "string" && project.workspaceClientId
      ? { workspaceClientId: project.workspaceClientId }
      : {}),
    ...(project.createdBy?.kind === "agent"
      ? { agent: true, agentClient: String(project.createdBy.client || "").slice(0, 60) }
      : {}),
  };
}

async function upsertSummary(index, project) {
  const i = index.projects.findIndex((p) => p.id === project.id);
  const previous = i >= 0 ? index.projects[i] : null;
  const summary = await summarizeProject(project, previous);
  if (i >= 0) index.projects[i] = summary;
  else index.projects.unshift(summary);
  index.projects.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return index;
}

/** Registro como está no disco: mídia nova vem como ficha \u0001gfm:, antiga como data:. */
export async function getProjectRecord(id) {
  if (!id) return null;
  return withStore("readonly", (store) => store.get(id));
}

/** Projeto pronto para o editor/player: toda mídia volta como data URL. */
export async function getProject(id) {
  return hydrate(await getProjectRecord(id));
}

/**
 * Registros crus (para ids, nomes, links). hazard: a mídia pode vir como ficha;
 * quem precisa das imagens/áudio chama getProject(id).
 */
export async function listAllProjects() {
  const rows = await withStore("readonly", (store) => store.getAll());
  return Array.isArray(rows) ? rows : [];
}

export async function putProject(project, { silent = false, keepUpdatedAt = false } = {}) {
  const next = {
    ...project,
    updatedAt: keepUpdatedAt && project.updatedAt ? project.updatedAt : Date.now(),
  };
  const [record] = await externalizeForDisk([next], async ([rec]) => {
    await withStore("readwrite", (store) => store.put(rec));
    return [rec];
  });
  const index = readIndex();
  await upsertSummary(index, record);
  writeIndex(index);
  if (!silent) emitChange({ type: "put", id: next.id });
  return next;
}

export async function getProjectHistory(id) {
  if (!id) return null;
  const raw = await withStore("readonly", (store) => store.get(id), HISTORY_STORE);
  const row = await hydrate(raw);
  if (!row) return null;
  return {
    undo: Array.isArray(row.undo) ? row.undo : [],
    redo: Array.isArray(row.redo) ? row.redo : [],
    media: row.media && typeof row.media === "object" ? row.media : undefined,
  };
}

export async function putProjectAndHistory(project, stacks) {
  const next = {
    ...project,
    updatedAt: Date.now(),
  };
  const historyRow = {
    id: next.id,
    undo: Array.isArray(stacks?.undo) ? stacks.undo : [],
    redo: Array.isArray(stacks?.redo) ? stacks.redo : [],
    media: stacks?.media && typeof stacks.media === "object" ? stacks.media : {},
  };
  const [record] = await externalizeForDisk([next, historyRow], ([rec, hist]) =>
    openDb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction([STORE, HISTORY_STORE], "readwrite");
          tx.objectStore(STORE).put(rec);
          tx.objectStore(HISTORY_STORE).put(hist);
          tx.oncomplete = () => {
            db.close();
            resolve([rec, hist]);
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error || new Error("IndexedDB error"));
          };
          tx.onabort = () => {
            db.close();
            reject(tx.error || new Error("IndexedDB abort"));
          };
        })
    )
  );
  const index = readIndex();
  await upsertSummary(index, record);
  writeIndex(index);
  emitChange({ type: "put", id: next.id });
  return next;
}

export async function deleteProject(id, { silent = false } = {}) {
  await openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const names = db.objectStoreNames.contains(HISTORY_STORE)
          ? [STORE, HISTORY_STORE]
          : [STORE];
        const tx = db.transaction(names, "readwrite");
        tx.objectStore(STORE).delete(id);
        if (names.includes(HISTORY_STORE)) tx.objectStore(HISTORY_STORE).delete(id);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error || new Error("IndexedDB error"));
        };
        tx.onabort = () => {
          db.close();
          reject(tx.error || new Error("IndexedDB abort"));
        };
      })
  );
  const index = readIndex();
  index.projects = index.projects.filter((p) => p.id !== id);
  if (index.activeProjectId === id) index.activeProjectId = null;
  writeIndex(index);
  if (!silent) emitChange({ type: "delete", id });
  scheduleMediaGarbage();
}

export async function setActiveProjectId(id) {
  const index = readIndex();
  index.activeProjectId = id || null;
  writeIndex(index);
}

export function getCustomThemes() {
  return readIndex().customThemes || [];
}

export function saveCustomThemes(themes, { silent = false } = {}) {
  const index = readIndex();
  index.customThemes = themes;
  writeIndex(index);
  if (!silent) emitChange({ type: "settings" });
}

export function createEmptyProject({ name, theme } = {}) {
  const now = Date.now();
  return {
    id: createProjectId(),
    name: (name || t("default.newProject")).trim() || t("default.newProject"),
    createdAt: now,
    updatedAt: now,
    theme: theme ? cloneTheme(theme) : defaultTheme(),
    customImages: {},
    steps: [],
    sceneLabels: { "1": "Cena 1" },
    playback: defaultPlayback(),
    narration: defaultNarration(),
  };
}

export function projectToDemoPayload(project) {
  const payload = {
    name: project.name,
    theme: project.theme,
    customImages: project.customImages || {},
    steps: project.steps || [],
    sceneLabels: project.sceneLabels || {},
    playback: project.playback || defaultPlayback(),
    narration: project.narration || defaultNarration(),
  };
  // why: só entra quando escolhida, para não mudar o hash de links já publicados
  if (project.coverStepId) payload.coverStepId = String(project.coverStepId);
  // why: link permanente sai sem marca por padrão; só o pedido de crédito vai no payload (hash estável)
  if (project.removeBranding === false) payload.removeBranding = false;
  Object.assign(payload, fixedStepsForPayload(project));
  // why: conteúdo multi-idioma só entra quando existe (hash estável para projetos antigos)
  if (project.i18n && typeof project.i18n === "object") payload.i18n = project.i18n;
  if (project.i18nProject && typeof project.i18nProject === "object") payload.i18nProject = project.i18nProject;
  ensurePlayback(payload);
  ensureNarration(payload);
  return payload;
}

export function demoPayloadToProject(data, { name, id } = {}) {
  const now = Date.now();
  const theme = data.theme ? cloneTheme(data.theme, {
    presetId: data.theme.presetId,
    customId: data.theme.customId,
  }) : defaultTheme();
  const project = {
    id: id || createProjectId(),
    name: name || data.name || t("default.importedProject"),
    createdAt: now,
    updatedAt: now,
    theme,
    customImages: data.customImages || {},
    steps: Array.isArray(data.steps) ? data.steps : [],
    sceneLabels: data.sceneLabels || {},
    playback: data.playback || defaultPlayback(),
    narration: data.narration || defaultNarration(),
  };
  if (typeof data.coverStepId === "string" && data.coverStepId) project.coverStepId = data.coverStepId;
  if (data.removeBranding === false) project.removeBranding = false;
  // why: passos fixos só existem no payload quando ligados; desligado = ausente
  if (data.startStep && typeof data.startStep === "object") project.startStep = normalizeStartStep(data.startStep);
  if (data.endStep && typeof data.endStep === "object") project.endStep = normalizeEndStep(data.endStep);
  if (data.i18n && typeof data.i18n === "object") project.i18n = data.i18n;
  if (data.i18nProject && typeof data.i18nProject === "object") project.i18nProject = data.i18nProject;
  ensurePlayback(project);
  ensureNarration(project);
  return project;
}

export async function duplicateProject(id) {
  // why: o registro cru já cita os arquivos por sha; a cópia não duplica nenhum byte
  const project = await getProjectRecord(id);
  if (!project) throw new Error(t("err.projectNotFound"));
  const copy = {
    ...structuredClone(project),
    id: createProjectId(),
    name: t("default.projectCopy", { name: project.name }),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  delete copy.share;
  delete copy.cloudShare;
  await putProject(copy);
  return copy;
}

/** Coloca o projeto num cliente (ou tira, com null). O vínculo sobe no sync do Pro. */
export async function setProjectClient(id, clientId) {
  const project = await getProjectRecord(id);
  if (!project) throw new Error(t("err.projectNotFound"));
  if (clientId) project.workspaceClientId = String(clientId);
  else delete project.workspaceClientId;
  return putProject(project);
}

export async function renameProject(id, name) {
  const project = await getProjectRecord(id);
  if (!project) throw new Error(t("err.projectNotFound"));
  project.name = (name || "").trim() || project.name;
  return putProject(project);
}

function loadLegacyLocalStorage() {
  for (const key of LEGACY_KEYS) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const data = JSON.parse(raw);
      if (data?.steps?.length) return { data, key };
    } catch {
      /* ignore */
    }
  }
  return null;
}

async function fetchDefaultDemo() {
  const res = await fetch(DEFAULT_JSON_URL, { cache: "no-cache" });
  if (!res.ok) throw new Error("Não foi possível carregar data/demo.json");
  return res.json();
}

/** Reconstrói o índice a partir do que ainda existe no IndexedDB. */
async function reconcileIndexFromIdb() {
  const stored = await listAllProjects();
  const index = readIndex();
  const byId = new Map(stored.filter((p) => p?.id).map((p) => [p.id, p]));

  // Remove fantasmas do índice (sumário sem registro no IDB)
  index.projects = (index.projects || []).filter((summary) => byId.has(summary.id));

  // Inclui projetos que estão no IDB mas sumiram do índice
  for (const project of byId.values()) {
    await upsertSummary(index, project);
  }

  if (index.activeProjectId && !byId.has(index.activeProjectId)) {
    index.activeProjectId = null;
  }

  writeIndex(index);
  return { index, stored };
}

/**
 * Tour de exemplo que o usuário ainda não mexeu: fica só neste navegador.
 * why: subir o exemplo intocado criaria a mesma cópia na conta de todo mundo; editado, ele vira do usuário e sincroniza.
 */
export function isUntouchedStockDemo(project) {
  return Boolean(project && project.name === STOCK_DEMO_NAME && !project.stockEdited);
}

async function seedDefaultDemoProject({ replaceExisting = false, keepEdited = false } = {}) {
  let legacy = loadLegacyLocalStorage();
  let data = legacy?.data || null;
  let fromLegacy = Boolean(data?.steps?.length);

  if (!fromLegacy) {
    data = await fetchDefaultDemo();
  }

  if (!data?.steps?.length) {
    throw new Error("Demo padrão sem passos");
  }

  const stockName = data.name || STOCK_DEMO_NAME;
  const index = readIndex();
  const existingSummary = (index.projects || []).find((p) => p.name === stockName || p.name === STOCK_DEMO_NAME);
  const prev = existingSummary && replaceExisting ? await getProjectRecord(existingSummary.id) : null;
  // why: a atualização automática do exemplo não apaga o que o usuário editou nele
  if (keepEdited && prev?.stockEdited) {
    const kept = readIndex();
    kept.seedRevision = SEED_REVISION;
    kept.migrated = true;
    writeIndex(kept);
    return prev;
  }

  const project = demoPayloadToProject(data, {
    name: stockName,
    id: prev?.id,
  });
  if (prev?.createdAt) project.createdAt = prev.createdAt;
  project.sceneLabels = {
    ...(data.sceneLabels && Object.keys(data.sceneLabels).length
      ? data.sceneLabels
      : DEFAULT_SCENE_LABELS),
  };
  if (!project.theme.presetId) {
    project.theme.presetId = THEME_PRESETS[0].id;
  }
  await putProject(project);

  if (fromLegacy && legacy?.key) {
    try {
      localStorage.removeItem(legacy.key);
    } catch {
      /* ignore */
    }
  }

  const nextIndex = readIndex();
  nextIndex.activeProjectId = nextIndex.activeProjectId || project.id;
  nextIndex.migrated = true;
  nextIndex.seedRevision = SEED_REVISION;
  writeIndex(nextIndex);
  return project;
}

/**
 * Garante biblioteca utilizável:
 * - reconcilia IndexedDB ↔ índice
 * - se não houver nenhum projeto, reinstala a demo padrão
 * - se o seed mudou, atualiza o tour de exemplo (mesmo nome)
 * @returns {{ index: object, seeded: boolean }}
 */
export async function ensureMigrated() {
  await reconcileIndexFromIdb();

  let index = readIndex();
  let seeded = false;

  // Biblioteca vazia → sempre reinstala a demo (mesmo se migrated=true)
  if (!(index.projects || []).length) {
    try {
      await seedDefaultDemoProject();
      index = readIndex();
      seeded = true;
    } catch (err) {
      console.warn("Falha ao restaurar demo padrão", err);
      index.migrated = false;
      writeIndex(index);
      throw err;
    }
  } else if ((index.seedRevision || 0) < SEED_REVISION) {
    try {
      await seedDefaultDemoProject({ replaceExisting: true, keepEdited: true });
      index = readIndex();
    } catch (err) {
      console.warn("Falha ao atualizar demo padrão", err);
    }
  } else if (!index.migrated) {
    index.migrated = true;
    writeIndex(index);
  }

  // why: arquivos de projetos apagados (ou trocados por versões otimizadas) saem do disco
  scheduleMediaGarbage(15000);
  return { index, seeded };
}

/** Força reinstalação da demo embutida a partir de data/demo.json. */
export async function restoreDefaultDemo() {
  return seedDefaultDemoProject({ replaceExisting: true });
}

export { DEFAULT_SCENE_LABELS };
