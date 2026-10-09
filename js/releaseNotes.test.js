import assert from "node:assert/strict";
import test from "node:test";
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
  assert.equal(RELEASE_NOTES_VERSION, "0.3.0");
  assert.equal(
    shouldShowReleaseNotes({
      dismissedVersion: "0.2.1",
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
