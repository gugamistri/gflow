import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  BADGE_NEW_COLOR,
  PROD_RELEASE_NOTES_URL,
  WHATS_NEW_PREVIEW,
  badgeFor,
  compareVersions,
  feedCacheIsFresh,
  fetchReleaseNotesFeed,
  loadPreferredFeed,
  popupEntries,
  preferredFeed,
  stateAfterFeed,
  stateAfterInstall,
  stateAfterSeen,
  unseenEntries,
} from "./whats-new.js";
import { RELEASE_NOTE_ENTRIES, RELEASE_NOTES_VERSION, buildReleaseNotesFeed, parseReleaseNotesFeed, releaseNotesFeedUrl, splitReleaseNote, releaseNoteHelpUrl } from "./releaseNotes.js";
import { catalogs, SUPPORTED_LOCALES } from "./i18n.js";

const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const ENTRIES = [
  { key: "a", tag: "fix", date: "2026-10-30", ext: "0.3.0" },
  { key: "b", tag: "new", date: "2026-11-01", ext: "0.3.0" },
  { key: "c", tag: "new", date: "2026-12-01", ext: "0.4.0" },
];

test("atualização com novidade acende o selo; patch sem item novo, não", () => {
  assert.deepEqual(stateAfterInstall({ reason: "update", previousVersion: "0.2.1", current: "0.3.0", entries: ENTRIES }), {
    lastSeen: "0.2.1",
    lastSeenNotes: "",
    pending: true,
  });
  // já viu a 0.3.0 e chegou a 0.3.1 sem itens
  assert.deepEqual(
    stateAfterInstall({
      reason: "update",
      previousVersion: "0.3.0",
      current: "0.3.1",
      stored: { lastSeen: "0.3.0", lastSeenNotes: "0.7.0", pending: false },
      notesVersion: "0.7.0",
      entries: ENTRIES,
    }),
    { lastSeen: "0.3.0", lastSeenNotes: "0.7.0", pending: false }
  );
  // pulou de 0.2.1 direto para 0.4.0: tudo novo
  assert.equal(unseenEntries("0.2.1", "0.4.0", ENTRIES).length, 3);
  assert.deepEqual(unseenEntries("0.3.0", "0.4.0", ENTRIES).map((e) => e.key), ["c"]);
  assert.equal(unseenEntries("0.2.1", "0.3.0", ENTRIES).some((e) => e.key === "c"), false, "item de versão futura não conta");
});

test("instalação nova não mostra selo; atualização do Chrome mantém o estado", () => {
  assert.deepEqual(stateAfterInstall({ reason: "install", current: "0.3.1", notesVersion: "0.7.0", entries: ENTRIES }), {
    lastSeen: "0.3.1",
    lastSeenNotes: "0.7.0",
    pending: false,
  });
  const stored = { lastSeen: "0.2.1", lastSeenNotes: "", pending: true };
  assert.equal(stateAfterInstall({ reason: "chrome_update", current: "0.3.1", stored, entries: ENTRIES }), stored);
  assert.deepEqual(stateAfterSeen("0.3.1", "0.7.0"), { lastSeen: "0.3.1", lastSeenNotes: "0.7.0", pending: false });
});

test("selo acende quando o site publica novidades do editor, mesmo sem atualizar a extensão", () => {
  const stored = { lastSeen: "0.3.0", lastSeenNotes: "0.5.0", pending: false };
  assert.deepEqual(stateAfterFeed({ stored, current: "0.3.0", notesVersion: "0.7.0" }), {
    lastSeen: "0.3.0",
    lastSeenNotes: "0.5.0",
    pending: true,
  });
  assert.equal(stateAfterFeed({ stored: { lastSeen: "0.3.0", lastSeenNotes: "0.7.0", pending: false }, current: "0.3.0", notesVersion: "0.7.0" }).pending, false);
  // quem veio da 0.3.0 sem lastSeenNotes vê as novidades 0.6/0.7 na primeira atualização da extensão
  assert.equal(
    stateAfterInstall({ reason: "update", previousVersion: "0.3.0", current: "0.3.1", stored: { lastSeen: "0.3.0", pending: false }, notesVersion: "0.7.0" }).pending,
    true
  );
});

test("selo: contador da captura vence; NOVO cabe em 4 letras", () => {
  assert.deepEqual(badgeFor({ count: 3, pending: true }), { text: "3", color: "#1A4D6D" });
  assert.deepEqual(badgeFor({ pending: true, newLabel: "NOVO" }), { text: "NOVO", color: BADGE_NEW_COLOR });
  assert.equal(badgeFor({}).text, "");
  for (const loc of SUPPORTED_LOCALES) assert.ok(catalogs[loc]["ext.news.badge"].length <= 4, loc);
});

test("popup: novidades do editor e da extensão, mais novo primeiro, 2 à mostra", () => {
  assert.deepEqual(popupEntries(ENTRIES).map((e) => e.key), ["c", "b", "a"]);
  assert.equal(WHATS_NEW_PREVIEW, 2);
  const real = popupEntries();
  assert.deepEqual(
    real.map((e) => e.key),
    ["onboarding", "projectsFirst", "paths", "zoomHighlight", "extNewsFeed", "planSwitch", "areaBlur", "crop", "wakeLock", "createHelp", "agentConnect", "showBalloon", "extensionNews", "gallery", "stepVideo", "richText", "narrationCaption", "slideTitle"]
  );
  assert.ok(real.some((e) => e.editor === "0.8.0") && real.some((e) => e.editor === "0.7.0") && real.some((e) => e.editor === "0.6.0"));
  assert.equal(real.filter((e) => e.editor === RELEASE_NOTES_VERSION).length, 5);
});

test("itens reais: texto Título: descrição nos 3 idiomas, ajuda em guiaflow.pro", () => {
  assert.equal(compareVersions(manifest.version, "0.2.1") > 0, true, "acima da versão da loja (0.2.1)");
  const feed = buildReleaseNotesFeed(catalogs);
  assert.ok(feed);
  assert.equal(feed.version, RELEASE_NOTES_VERSION);
  for (const loc of SUPPORTED_LOCALES) {
    const c = catalogs[loc];
    for (const tag of ["new", "feature", "fix"]) assert.ok(c[`releaseNotes.tag.${tag}`], `${loc} tag ${tag}`);
    for (const e of RELEASE_NOTE_ENTRIES) {
      const { title, desc } = splitReleaseNote(feed.entries.find((item) => item.key === e.key).text[loc]);
      assert.ok(title && desc, `${loc} ${e.key} tem título e descrição`);
      assert.ok(title.length <= 40, `${loc} ${e.key} título curto`);
      assert.match(releaseNoteHelpUrl(loc, e.help), /^https:\/\/guiaflow\.pro\/(ajuda|en\/help|es\/ayuda)#[a-z]+$/);
    }
  }
});

test("feed: URL canônica, JSON válido, lixo ou texto vazio é rejeitado", () => {
  assert.equal(PROD_RELEASE_NOTES_URL, "https://guiaflow.pro/release-notes.json");
  assert.equal(releaseNotesFeedUrl("https://guiaflow.pro/editor"), "https://guiaflow.pro/release-notes.json");
  assert.equal(releaseNotesFeedUrl("http://localhost:4173"), "http://localhost:4173/release-notes.json");
  assert.equal(releaseNotesFeedUrl("not a url"), "https://guiaflow.pro/release-notes.json");
  const valid = buildReleaseNotesFeed(catalogs);
  assert.equal(parseReleaseNotesFeed(valid).version, RELEASE_NOTES_VERSION);
  assert.equal(parseReleaseNotesFeed({ ...valid, version: "nope" }), null);
  assert.equal(parseReleaseNotesFeed({ ...valid, entries: [] }), null);
  assert.equal(parseReleaseNotesFeed({ ...valid, entries: [{ ...valid.entries[0], tag: "oops" }] }), null);
  assert.equal(parseReleaseNotesFeed({ ...valid, entries: [valid.entries[0], valid.entries[0]] }), null);
  assert.equal(parseReleaseNotesFeed({ ...valid, entries: [{ ...valid.entries[0], key: "bad-key" }] }), null);
  assert.equal(parseReleaseNotesFeed({ ...valid, entries: [{ ...valid.entries[0], text: { pt: "ok", en: "ok", es: "" } }] }), null);
  const older = parseReleaseNotesFeed({ ...valid, version: "0.6.0" });
  const newer = parseReleaseNotesFeed({ ...valid, version: "0.8.0" });
  assert.equal(preferredFeed(valid, older), valid);
  assert.equal(preferredFeed(valid, newer), newer);
  assert.equal(preferredFeed(valid, null), valid);
  assert.equal(feedCacheIsFresh(Date.now() - 1000), true);
  assert.equal(feedCacheIsFresh(Date.now() - 7 * 60 * 60 * 1000), false);
});

test("fetch: usa o JSON remoto quando é válido; cai no pacote se a rede falha", async () => {
  const bundled = buildReleaseNotesFeed(catalogs);
  const remote = parseReleaseNotesFeed({ ...bundled, version: "0.8.0" });
  const ok = await fetchReleaseNotesFeed("https://guiaflow.pro/release-notes.json", async () => ({
    ok: true,
    json: async () => remote,
  }));
  assert.equal(ok.version, "0.8.0");
  assert.equal(await fetchReleaseNotesFeed("https://guiaflow.pro/release-notes.json", async () => ({ ok: false })), null);
  assert.equal(await fetchReleaseNotesFeed("https://guiaflow.pro/release-notes.json", async () => { throw new Error("offline"); }), null);
  const loaded = await loadPreferredFeed({
    bundled,
    editorOrigin: "http://localhost:4173",
    prodUrl: "https://guiaflow.pro/release-notes.json",
    fetchImpl: async (url) => {
      if (String(url).startsWith("http://localhost:4173")) return { ok: false };
      return { ok: true, json: async () => remote };
    },
  });
  assert.equal(loaded.version, "0.8.0");
});

test("manifest: nenhuma permissão nova para o selo ou o feed", () => {
  assert.deepEqual(manifest.permissions, ["activeTab", "tabs", "scripting", "storage", "unlimitedStorage"]);
  assert.ok(manifest.host_permissions.includes("https://guiaflow.pro/*"));
  assert.equal(manifest.content_security_policy, undefined);
});
