import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { LIBRARY_HYDRATE_MAX_MS, isLibrarySyncPending, shouldShowSyncingInLibrary } from "./libraryHydrate.js";

const base = {
  cloudEnabled: true,
  signedIn: true,
  email: "ana@example.com",
  billingStatus: "ready",
  entitlementActive: true,
  syncPhase: "syncing",
  firstSyncDone: false,
  elapsedMs: 100,
};

test("Pro/Team logado sem a primeira volta espera o sync; o plano ainda carregando também", () => {
  assert.equal(isLibrarySyncPending(base), true);
  assert.equal(isLibrarySyncPending({ ...base, billingStatus: "idle", entitlementActive: false, syncPhase: "off" }), true);
});

test("não espera quando não há sync: sem login, sem Pro, billing sem resposta ou primeira volta feita", () => {
  assert.equal(isLibrarySyncPending({ ...base, signedIn: false }), false);
  assert.equal(isLibrarySyncPending({ ...base, cloudEnabled: false }), false);
  assert.equal(isLibrarySyncPending({ ...base, email: "" }), false);
  assert.equal(isLibrarySyncPending({ ...base, billingStatus: "ready", entitlementActive: false }), false);
  assert.equal(isLibrarySyncPending({ ...base, billingStatus: "hidden" }), false);
  assert.equal(isLibrarySyncPending({ ...base, firstSyncDone: true }), false);
});

test("erro, offline ou plano inativo mostram a lista na hora; e há prazo máximo", () => {
  for (const syncPhase of ["error", "offline", "inactive"]) assert.equal(isLibrarySyncPending({ ...base, syncPhase }), false);
  assert.equal(isLibrarySyncPending({ ...base, elapsedMs: LIBRARY_HYDRATE_MAX_MS + 1 }), false);
});

test("só troca a lista por 'Sincronizando…' quando há apenas exemplos (ou nada)", () => {
  assert.equal(shouldShowSyncingInLibrary(true, []), true);
  assert.equal(shouldShowSyncingInLibrary(true, [{ stock: true }, { stock: true }]), true);
  assert.equal(shouldShowSyncingInLibrary(true, [{ stock: true }, { id: "meu" }]), false);
  assert.equal(shouldShowSyncingInLibrary(false, [{ stock: true }]), false);
});

test("a lista e o chip usam o estado de sincronização, com os textos nos três idiomas", () => {
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  assert.match(app, /shouldShowSyncingInLibrary\(libraryHydrating\(\), allProjects\)/);
  assert.match(app, /t\("sync\.syncing"\)/);
  assert.match(app, /project\.stockEdited = true;\s*\n\s*project\.cloudShare = \{/, "publicar marca o exemplo como editado");
  assert.match(app, /restoreLinks: async/);
  const i18n = readFileSync(new URL("./i18n.js", import.meta.url), "utf8");
  for (const [lang, text] of [["pt", "Sincronizando…"], ["en", "Syncing…"], ["es", "Sincronizando…"]]) {
    assert.ok(i18n.includes(`"sync.syncing": "${text}"`), lang);
  }
  for (const key of ["sync.errorProject", "sync.errorProjects", "sync.failedTip", "sync.reason.other", "sync.reason.local_media_ref"]) {
    assert.equal(i18n.split(`"${key}":`).length - 1, 3, `${key} nos 3 idiomas`);
  }
});
