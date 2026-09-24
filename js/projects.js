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

const DB_NAME = "demo-studio";
const DB_VERSION = 2;
const STORE = "projects";
const HISTORY_STORE = "history";
const INDEX_KEY = "demo-studio-index-v2";
const LEGACY_KEYS = ["interactive-demo-v1"];
const DEFAULT_JSON_URL = "data/demo.json";
/** Bump when data/demo.json muda — reinstala o tour de exemplo sem apagar outros projetos. */
const SEED_REVISION = 2;
const STOCK_DEMO_NAME = "Como usar o Guia";

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
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
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

export function createProjectId() {
  return "proj-" + Math.random().toString(36).slice(2, 10);
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

function summarizeProject(project) {
  const firstImage = (project.steps || []).find(
    (s) => s.type !== "slide" && s.image
  )?.image;
  let thumb = null;
  if (firstImage?.startsWith("custom:")) {
    const id = firstImage.slice(7);
    thumb = project.customImages?.[id]?.dataUrl || null;
  } else if (firstImage && !firstImage.startsWith("data:")) {
    thumb = firstImage;
  } else if (firstImage?.startsWith("data:")) {
    thumb = firstImage;
  }

  return {
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    stepCount: Array.isArray(project.steps) ? project.steps.length : 0,
    thumb,
    themePreview: themePreviewDots(project.theme),
  };
}

function upsertSummary(index, project) {
  const summary = summarizeProject(project);
  const i = index.projects.findIndex((p) => p.id === project.id);
  if (i >= 0) index.projects[i] = summary;
  else index.projects.unshift(summary);
  index.projects.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return index;
}

export async function getProject(id) {
  if (!id) return null;
  return withStore("readonly", (store) => store.get(id));
}

export async function listAllProjects() {
  const rows = await withStore("readonly", (store) => store.getAll());
  return Array.isArray(rows) ? rows : [];
}

export async function putProject(project) {
  const next = {
    ...project,
    updatedAt: Date.now(),
  };
  await withStore("readwrite", (store) => store.put(next));
  const index = readIndex();
  upsertSummary(index, next);
  writeIndex(index);
  return next;
}

export async function getProjectHistory(id) {
  if (!id) return null;
  const row = await withStore("readonly", (store) => store.get(id), HISTORY_STORE);
  if (!row) return null;
  return {
    undo: Array.isArray(row.undo) ? row.undo : [],
    redo: Array.isArray(row.redo) ? row.redo : [],
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
  };
  await openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction([STORE, HISTORY_STORE], "readwrite");
        tx.objectStore(STORE).put(next);
        tx.objectStore(HISTORY_STORE).put(historyRow);
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
  upsertSummary(index, next);
  writeIndex(index);
  return next;
}

export async function deleteProject(id) {
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
}

export async function setActiveProjectId(id) {
  const index = readIndex();
  index.activeProjectId = id || null;
  writeIndex(index);
}

export function getCustomThemes() {
  return readIndex().customThemes || [];
}

export function saveCustomThemes(themes) {
  const index = readIndex();
  index.customThemes = themes;
  writeIndex(index);
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
  ensurePlayback(project);
  ensureNarration(project);
  return project;
}

export async function duplicateProject(id) {
  const project = await getProject(id);
  if (!project) throw new Error(t("err.projectNotFound"));
  const copy = {
    ...structuredClone(project),
    id: createProjectId(),
    name: t("default.projectCopy", { name: project.name }),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await putProject(copy);
  return copy;
}

export async function renameProject(id, name) {
  const project = await getProject(id);
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
    upsertSummary(index, project);
  }

  if (index.activeProjectId && !byId.has(index.activeProjectId)) {
    index.activeProjectId = null;
  }

  writeIndex(index);
  return { index, stored };
}

async function seedDefaultDemoProject({ replaceExisting = false } = {}) {
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
  const prev = existingSummary && replaceExisting ? await getProject(existingSummary.id) : null;

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
      await seedDefaultDemoProject({ replaceExisting: true });
      index = readIndex();
    } catch (err) {
      console.warn("Falha ao atualizar demo padrão", err);
    }
  } else if (!index.migrated) {
    index.migrated = true;
    writeIndex(index);
  }

  return { index, seeded };
}

/** Força reinstalação da demo embutida a partir de data/demo.json. */
export async function restoreDefaultDemo() {
  return seedDefaultDemoProject({ replaceExisting: true });
}

export { DEFAULT_SCENE_LABELS };
