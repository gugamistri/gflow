/**
 * why: a chave fica num banco só dela; o JSON do projeto é exportável e não a inclui.
 */

import { isPlausibleApiKey, maskApiKey } from "./cartesia.js";

const DB_NAME = "demo-studio-secrets";
const DB_VERSION = 1;
const STORE = "secrets";
const RECORD_ID = "cartesia";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function withStore(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        let primary = null;
        try {
          primary = fn(store) || null;
        } catch (err) {
          db.close();
          reject(err);
          return;
        }
        tx.oncomplete = () => {
          const value = primary ? primary.result : undefined;
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

export function putCartesiaKey(apiKey) {
  return withStore("readwrite", (store) => store.put({ id: RECORD_ID, apiKey: String(apiKey) }));
}

export function readCartesiaKey() {
  return withStore("readonly", (store) => store.get(RECORD_ID)).then((row) =>
    typeof row?.apiKey === "string" ? row.apiKey : ""
  );
}

export function deleteCartesiaKey() {
  return withStore("readwrite", (store) => store.delete(RECORD_ID));
}

export async function cartesiaKeyStatus() {
  const apiKey = await readCartesiaKey();
  return {
    configured: isPlausibleApiKey(apiKey),
    masked: maskApiKey(apiKey),
  };
}
