import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { catalogs, SUPPORTED_LOCALES } from "./i18n.js";
import {
  RELEASE_NOTES_VERSION,
  releaseNotesMonth,
  shouldShowReleaseNotes,
} from "./releaseNotes.js";

test("mostra o aviso quando nunca dispensou ou a versão mudou", () => {
  assert.equal(
    shouldShowReleaseNotes({
      dismissedVersion: null,
      currentVersion: RELEASE_NOTES_VERSION,
    }),
    true
  );
  assert.equal(
    shouldShowReleaseNotes({
      dismissedVersion: "0.1.0",
      currentVersion: RELEASE_NOTES_VERSION,
    }),
    true
  );
});

test("esconde o aviso quando a versão atual já foi dispensada", () => {
  assert.equal(
    shouldShowReleaseNotes({
      dismissedVersion: RELEASE_NOTES_VERSION,
      currentVersion: RELEASE_NOTES_VERSION,
    }),
    false
  );
});

test("não mostra sem versão atual", () => {
  assert.equal(shouldShowReleaseNotes({ dismissedVersion: null, currentVersion: "" }), false);
  assert.equal(shouldShowReleaseNotes({}), false);
});

test("dispensar a versão anterior ainda mostra esta", () => {
  assert.equal(RELEASE_NOTES_VERSION, "0.6.0");
  assert.equal(
    shouldShowReleaseNotes({
      dismissedVersion: "0.5.0",
      currentVersion: RELEASE_NOTES_VERSION,
    }),
    true
  );
  assert.equal(
    shouldShowReleaseNotes({
      dismissedVersion: "1",
      currentVersion: RELEASE_NOTES_VERSION,
    }),
    true
  );
});

test("o mês da versão segue o idioma", () => {
  assert.equal(releaseNotesMonth("pt", "2026-10-08"), "outubro de 2026");
  assert.equal(releaseNotesMonth("es", "2026-10-08"), "octubre de 2026");
  assert.equal(releaseNotesMonth("en", "2026-10-08"), "October 2026");
  assert.equal(releaseNotesMonth("pt", "2026-11-09"), "novembro de 2026");
  assert.equal(releaseNotesMonth("es", "2026-11-09"), "noviembre de 2026");
  assert.equal(releaseNotesMonth("en", "2026-11-09"), "November 2026");
});

test("a versão das novidades espelha o package.json e o título do HTML", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.version, RELEASE_NOTES_VERSION);
  const html = readFileSync(new URL("../editor.html", import.meta.url), "utf8");
  assert.match(
    html,
    new RegExp(`Novidades da versão ${RELEASE_NOTES_VERSION.replace(/\./g, "\\.")} · ${releaseNotesMonth("pt")}`)
  );
});

test("0.6.0: novidades de 2–9/11 em pt, en e es, citando os rótulos da interface", () => {
  const html = readFileSync(new URL("../editor.html", import.meta.url), "utf8");
  const start = html.indexOf('class="release-notes-list"');
  const list = html.slice(start, html.indexOf("</ul>", start));
  const keys = [...list.matchAll(/data-i18n="(releaseNotes\.[a-zA-Z]+)">([^<]+)</g)];
  assert.deepEqual(
    keys.map((m) => m[1]),
    ["releaseNotes.createHelp", "releaseNotes.agentConnect", "releaseNotes.showBalloon"]
  );
  for (const [, k, text] of keys) assert.equal(text, catalogs.pt[k], `HTML igual ao catálogo pt: ${k}`);
  for (const loc of SUPPORTED_LOCALES) {
    const c = catalogs[loc];
    for (const [, k] of keys) assert.ok(c[k], `${loc} ${k}`);
    assert.ok(c["releaseNotes.createHelp"].includes(c["assistant.entry"]), `${loc} rótulo Criar com ajuda`);
    assert.ok(c["releaseNotes.agentConnect"].includes(c["agentConnect.card"]), `${loc} rótulo agente`);
    assert.ok(c["releaseNotes.showBalloon"].includes(c["props.showPopover"]), `${loc} rótulo Mostrar balão`);
    assert.match(c["releaseNotes.createHelp"], /Grátis|Gratis|Free/, `${loc} grátis`);
    assert.match(c["releaseNotes.agentConnect"], /Claude/, `${loc} Claude`);
    assert.match(c["releaseNotes.agentConnect"], /Cursor/, `${loc} Cursor`);
  }
});

test("fonte única: o pop-up do editor lista os itens de RELEASE_NOTE_ENTRIES desta versão", async () => {
  const { RELEASE_NOTE_ENTRIES, editorReleaseNotes, splitReleaseNote, RELEASE_NOTE_TAGS } = await import("./releaseNotes.js");
  const html = readFileSync(new URL("../editor.html", import.meta.url), "utf8");
  const start = html.indexOf('class="release-notes-list"');
  const list = html.slice(start, html.indexOf("</ul>", start));
  const keys = [...list.matchAll(/data-i18n="releaseNotes\.([a-zA-Z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(keys, editorReleaseNotes().map((e) => e.key));
  for (const e of RELEASE_NOTE_ENTRIES) {
    assert.ok(RELEASE_NOTE_TAGS.includes(e.tag), e.key);
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/);
    for (const loc of SUPPORTED_LOCALES) assert.ok(splitReleaseNote(catalogs[loc][`releaseNotes.${e.key}`]).desc, `${loc} ${e.key}`);
  }
});
