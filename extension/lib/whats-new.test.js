import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  BADGE_NEW_COLOR,
  WHATS_NEW_PREVIEW,
  badgeFor,
  compareVersions,
  popupEntries,
  stateAfterInstall,
  stateAfterSeen,
  unseenEntries,
} from "./whats-new.js";
import { RELEASE_NOTE_ENTRIES, splitReleaseNote, releaseNoteHelpUrl } from "./releaseNotes.js";
import { catalogs, SUPPORTED_LOCALES } from "./i18n.js";

const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const ENTRIES = [
  { key: "a", tag: "fix", date: "2026-10-30", ext: "0.3.0" },
  { key: "b", tag: "new", date: "2026-11-01", ext: "0.3.0" },
  { key: "c", tag: "new", date: "2026-12-01", ext: "0.4.0" },
];

test("atualização com novidade acende o selo; patch sem item novo, não", () => {
  assert.deepEqual(stateAfterInstall({ reason: "update", previousVersion: "0.2.1", current: "0.3.0", entries: ENTRIES }), { lastSeen: "0.2.1", pending: true });
  // já viu a 0.3.0 e chegou a 0.3.1 sem itens
  assert.deepEqual(stateAfterInstall({ reason: "update", previousVersion: "0.3.0", current: "0.3.1", stored: { lastSeen: "0.3.0", pending: false }, entries: ENTRIES }), { lastSeen: "0.3.0", pending: false });
  // pulou de 0.2.1 direto para 0.4.0: tudo novo
  assert.equal(unseenEntries("0.2.1", "0.4.0", ENTRIES).length, 3);
  assert.deepEqual(unseenEntries("0.3.0", "0.4.0", ENTRIES).map((e) => e.key), ["c"]);
  assert.equal(unseenEntries("0.2.1", "0.3.0", ENTRIES).some((e) => e.key === "c"), false, "item de versão futura não conta");
});

test("instalação nova não mostra selo; atualização do Chrome mantém o estado", () => {
  assert.deepEqual(stateAfterInstall({ reason: "install", current: "0.3.0", entries: ENTRIES }), { lastSeen: "0.3.0", pending: false });
  const stored = { lastSeen: "0.2.1", pending: true };
  assert.equal(stateAfterInstall({ reason: "chrome_update", current: "0.3.0", stored, entries: ENTRIES }), stored);
  assert.deepEqual(stateAfterSeen("0.3.0"), { lastSeen: "0.3.0", pending: false });
});

test("selo: contador da captura vence; NOVO cabe em 4 letras", () => {
  assert.deepEqual(badgeFor({ count: 3, pending: true }), { text: "3", color: "#1A4D6D" });
  assert.deepEqual(badgeFor({ pending: true, newLabel: "NOVO" }), { text: "NOVO", color: BADGE_NEW_COLOR });
  assert.equal(badgeFor({}).text, "");
  for (const loc of SUPPORTED_LOCALES) assert.ok(catalogs[loc]["ext.news.badge"].length <= 4, loc);
});

test("popup: mais novo primeiro, NOVO antes de CORREÇÃO no mesmo dia, 2 à mostra", () => {
  assert.deepEqual(popupEntries(ENTRIES).map((e) => e.key), ["c", "b", "a"]);
  assert.equal(WHATS_NEW_PREVIEW, 2);
  const real = popupEntries();
  assert.equal(real[0].key, "extensionNews");
  assert.equal(real[1].key, "gallery");
});

test("itens reais: versão da extensão = manifest, texto Título: descrição nos 3 idiomas, ajuda em guiaflow.pro", () => {
  assert.equal(compareVersions(manifest.version, "0.2.1") > 0, true, "acima da versão da loja (0.2.1)");
  const latest = RELEASE_NOTE_ENTRIES.map((e) => e.ext).filter(Boolean).sort(compareVersions).at(-1);
  assert.equal(latest, manifest.version, "o item mais novo é desta versão");
  for (const loc of SUPPORTED_LOCALES) {
    const c = catalogs[loc];
    for (const tag of ["new", "feature", "fix"]) assert.ok(c[`releaseNotes.tag.${tag}`], `${loc} tag ${tag}`);
    for (const e of RELEASE_NOTE_ENTRIES) {
      const { title, desc } = splitReleaseNote(c[`releaseNotes.${e.key}`]);
      assert.ok(title && desc, `${loc} ${e.key} tem título e descrição`);
      assert.ok(title.length <= 40, `${loc} ${e.key} título curto`);
      assert.match(releaseNoteHelpUrl(loc, e.help), /^https:\/\/guiaflow\.pro\/(ajuda|en\/help|es\/ayuda)#[a-z]+$/);
    }
  }
});

test("manifest: nenhuma permissão nova para o selo", () => {
  assert.deepEqual(manifest.permissions, ["activeTab", "tabs", "scripting", "storage", "unlimitedStorage"]);
});
