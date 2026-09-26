/**
 * why: o IndexedDB dos projetos é exportável; a chave fica cifrada num arquivo do app.
 */

const fs = require("fs");
const path = require("path");

function createKeyStore({ directory, encrypt, decrypt, fsImpl = fs, fileName = "cartesia-key.bin" }) {
  const file = path.join(directory, fileName);

  function exists() {
    return fsImpl.existsSync(file);
  }

  return {
    file,
    configured() {
      return exists();
    },
    save(apiKey) {
      fsImpl.mkdirSync(directory, { recursive: true });
      fsImpl.writeFileSync(file, encrypt(String(apiKey)));
    },
    /** Persiste um payload JSON cifrado (LLM: provider, baseUrl, model, apiKey). */
    savePayload(payload) {
      fsImpl.mkdirSync(directory, { recursive: true });
      fsImpl.writeFileSync(file, encrypt(JSON.stringify(payload)));
    },
    read() {
      if (!exists()) return "";
      return String(decrypt(fsImpl.readFileSync(file)) || "");
    },
    readPayload() {
      const raw = this.read();
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    },
    clear() {
      if (exists()) fsImpl.unlinkSync(file);
    },
  };
}

module.exports = { createKeyStore };
