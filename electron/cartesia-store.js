/**
 * why: o IndexedDB dos projetos é exportável; a chave fica cifrada num arquivo do app.
 */

const fs = require("fs");
const path = require("path");

function createKeyStore({ directory, encrypt, decrypt, fsImpl = fs }) {
  const file = path.join(directory, "cartesia-key.bin");

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
    read() {
      if (!exists()) return "";
      return String(decrypt(fsImpl.readFileSync(file)) || "");
    },
    clear() {
      if (exists()) fsImpl.unlinkSync(file);
    },
  };
}

module.exports = { createKeyStore };
