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
  assert.equal(RELEASE_NOTES_VERSION, "0.5.0");
  assert.equal(
    shouldShowReleaseNotes({
      dismissedVersion: "0.4.0",
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
});

test("a versão das novidades espelha o package.json e o título do HTML", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.version, RELEASE_NOTES_VERSION);
  const html = readFileSync(new URL("../editor.html", import.meta.url), "utf8");
  assert.match(html, new RegExp(`Novidades da versão ${RELEASE_NOTES_VERSION.replace(/\./g, "\\.")} · outubro de 2026`));
});

test("0.5.0: novidades do dia 30/10 em pt, en e es, citando os rótulos da interface", () => {
  const html = readFileSync(new URL("../editor.html", import.meta.url), "utf8");
  const start = html.indexOf('class="release-notes-list"');
  const list = html.slice(start, html.indexOf("</ul>", start));
  const keys = [...list.matchAll(/data-i18n="(releaseNotes\.[a-zA-Z]+)">([^<]+)</g)];
  assert.deepEqual(
    keys.map((m) => m[1]),
    ["releaseNotes.stepVideo", "releaseNotes.narrationCaption", "releaseNotes.slideTitle", "releaseNotes.richText", "releaseNotes.gallery"]
  );
  for (const [, k, text] of keys) assert.equal(text, catalogs.pt[k], `HTML igual ao catálogo pt: ${k}`);
  for (const loc of SUPPORTED_LOCALES) {
    const c = catalogs[loc];
    for (const [, k] of keys) assert.ok(c[k], `${loc} ${k}`);
    assert.match(c["releaseNotes.stepVideo"], /YouTube[\s\S]*Vimeo/, `${loc} vídeo`);
    assert.ok(c["releaseNotes.narrationCaption"].includes(c["props.showCaption"]), `${loc} rótulo da legenda`);
    assert.ok(c["releaseNotes.narrationCaption"].includes(c["props.caption"]), `${loc} painel de Narração`);
    assert.ok(c["releaseNotes.slideTitle"].includes(c["player.scene"].replace("{n}", "X").toUpperCase()), `${loc} CENA X`);
    const gal = c["releaseNotes.gallery"];
    assert.ok(gal.includes(`⚙ → ${c["mode.label"]} → ${c["mode.gallery"]}`), `${loc} caminho do ajuste`);
    // a Galeria não é só para imóveis
    assert.equal((gal.match(/,/g) || []).length >= 4, true, `${loc} vários segmentos`);
    assert.doesNotMatch(c["mode.galleryHint"], /^[^:]*(bom para|ideal para|good for)/, `${loc} dica genérica`);
  }
});
