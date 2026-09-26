/**
 * why: a chave LLM fica num banco só dela; o JSON do projeto é exportável e não a inclui.
 */

import {
  defaultLlmSettings,
  isPlausibleLlmKey,
  maskLlmKey,
  normalizeBaseUrl,
  resolveProvider,
  LLM_DEFAULT_MODEL,
  LLM_DEFAULT_PROVIDER,
} from "./llm.js";

const DB_NAME = "demo-studio-secrets";
const DB_VERSION = 1;
const STORE = "secrets";
const RECORD_ID = "llm";

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

function normalizeSettings(row) {
  const defaults = defaultLlmSettings();
  const provider = String(row?.provider || defaults.provider || LLM_DEFAULT_PROVIDER);
  const resolved = resolveProvider(provider, row?.baseUrl || "");
  return {
    provider: resolved.id,
    baseUrl: resolved.baseUrl || normalizeBaseUrl(row?.baseUrl) || defaults.baseUrl,
    model: String(row?.model || defaults.model || LLM_DEFAULT_MODEL).trim() || LLM_DEFAULT_MODEL,
    apiKey: typeof row?.apiKey === "string" ? row.apiKey : "",
  };
}

export function putLlmSettings(settings) {
  const next = normalizeSettings(settings);
  return withStore("readwrite", (store) =>
    store.put({
      id: RECORD_ID,
      provider: next.provider,
      baseUrl: next.baseUrl,
      model: next.model,
      apiKey: String(next.apiKey || ""),
    })
  );
}

export function readLlmSettings() {
  return withStore("readonly", (store) => store.get(RECORD_ID)).then((row) =>
    row ? normalizeSettings(row) : defaultLlmSettings()
  );
}

export function deleteLlmSettings() {
  return withStore("readwrite", (store) => store.delete(RECORD_ID));
}

export async function llmSettingsStatus() {
  const settings = await readLlmSettings();
  const configured = isPlausibleLlmKey(settings.apiKey) && !!normalizeBaseUrl(settings.baseUrl) && !!settings.model;
  return {
    configured,
    masked: maskLlmKey(settings.apiKey),
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    model: settings.model,
  };
}
