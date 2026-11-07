/**
 * Rascunho do assistente neste navegador (IndexedDB próprio). Sair e voltar não perde trabalho.
 * why: banco separado do de projetos — o rascunho não entra em sync, export nem link publicado.
 */
import { reviveDraft } from "./assistant.js";

const DB_NAME = "guiaflow-assistant";
const DB_VERSION = 1;
const STORE = "drafts";
const CURRENT = "current";

function openDb(idb = globalThis.indexedDB) {
  return new Promise((resolve, reject) => {
    if (!idb) {
      reject(new Error("indexeddb_unavailable"));
      return;
    }
    const req = idb.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run(mode, fn, idb) {
  return openDb(idb).then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const out = fn(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(out?.result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      })
  );
}

export async function loadDraft(idb) {
  try {
    const raw = await run("readonly", (s) => s.get(CURRENT), idb);
    return reviveDraft(raw);
  } catch {
    return null;
  }
}

export async function saveDraft(draft, idb) {
  try {
    await run("readwrite", (s) => s.put(JSON.parse(JSON.stringify(draft)), CURRENT), idb);
    return true;
  } catch {
    return false;
  }
}

export async function clearDraft(idb) {
  try {
    await run("readwrite", (s) => s.delete(CURRENT), idb);
    return true;
  } catch {
    return false;
  }
}
