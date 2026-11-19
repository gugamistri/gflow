/**
 * Originais dos prints desfocados — SÓ neste navegador (IndexedDB "guiaflow-blur").
 * why: mover ou remover um retângulo precisa do print sem desfoque. Ele nunca entra no projeto:
 *      não vai para o sync do Pro, colaboração, /p, /v, embed, export, API nem MCP.
 *      Outro aparelho (ou colaborador) vê a imagem já borrada e só pode desfocar mais.
 * Apagar o projeto apaga os originais dele.
 */

const DB_NAME = "guiaflow-blur";
const STORE = "originals";

function idb() {
  return typeof indexedDB !== "undefined" ? indexedDB : null;
}

function openDb() {
  const factory = idb();
  if (!factory) return Promise.reject(new Error("indexeddb_unavailable"));
  return new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE);
        store.createIndex("projectId", "projectId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("indexeddb_error"));
  });
}

function run(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        let out;
        Promise.resolve(fn(tx.objectStore(STORE), (v) => (out = v))).catch(reject);
        tx.oncomplete = () => {
          db.close();
          resolve(out);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error || new Error("indexeddb_error"));
        };
        tx.onabort = () => {
          db.close();
          reject(tx.error || new Error("indexeddb_abort"));
        };
      })
  );
}

/** Guarda o original (bytes + mime) sob o id da ficha `step.blur.id`. */
export function putBlurOriginal(id, { bytes, mime, projectId = "" }) {
  const value = { bytes: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), mime: String(mime || ""), projectId: String(projectId || ""), savedAt: Date.now() };
  return run("readwrite", (store) => {
    store.put(value, id);
  });
}

/** `{ bytes, mime, projectId }` ou null. */
export function getBlurOriginal(id) {
  return run("readonly", (store, set) => {
    const req = store.get(id);
    req.onsuccess = () => set(req.result || null);
  });
}

export function deleteBlurOriginal(id) {
  return run("readwrite", (store) => {
    store.delete(id);
  });
}

/** Apaga todos os originais de um projeto. Devolve quantos apagou. */
export function deleteBlurOriginalsForProject(projectId) {
  if (!projectId) return Promise.resolve(0);
  return run("readwrite", (store, set) => {
    let n = 0;
    const req = store.index("projectId").openCursor(IDBKeyRange.only(String(projectId)));
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return set(n);
      cur.delete();
      n += 1;
      cur.continue();
    };
  });
}
