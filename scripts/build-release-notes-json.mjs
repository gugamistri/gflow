/**
 * Gera release-notes.json a partir de js/releaseNotes.js + js/i18n.js (a mesma fonte do pop-up do editor).
 * Uso: node scripts/build-release-notes-json.mjs
 * why: a extensão lê esse arquivo em guiaflow.pro; o teste confere se o JSON commitado está em dia.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { catalogs } from "../js/i18n.js";
import { buildReleaseNotesFeed } from "../js/releaseNotes.js";

export const RELEASE_NOTES_JSON_PATH = "release-notes.json";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export function releaseNotesJson(texts = catalogs) {
  const feed = buildReleaseNotesFeed(texts);
  if (!feed) throw new Error("feed de novidades inválido");
  return `${JSON.stringify(feed, null, 2)}\n`;
}

export function writeReleaseNotesJson(root = repoRoot, texts = catalogs) {
  const path = join(root, RELEASE_NOTES_JSON_PATH);
  writeFileSync(path, releaseNotesJson(texts));
  return path;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(writeReleaseNotesJson());
}
