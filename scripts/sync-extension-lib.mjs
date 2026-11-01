/**
 * Copia para extension/lib os módulos que a extensão usa do editor (o Chrome só carrega arquivos do pacote).
 * why: i18n e novidades têm uma fonte só (js/); o teste extension-lib-sync.test.js confere as cópias.
 */
import { copyFileSync } from "node:fs";

export const EXTENSION_LIB_FILES = [
  "i18n.js",
  "collabI18n.js",
  "commentsI18n.js",
  "settingsI18n.js",
  "videoI18n.js",
  "releaseNotes.js",
];

export function syncExtensionLib(root = ".") {
  for (const f of EXTENSION_LIB_FILES) copyFileSync(`${root}/js/${f}`, `${root}/extension/lib/${f}`);
  return EXTENSION_LIB_FILES;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`extension/lib: ${syncExtensionLib().join(", ")}`);
}
