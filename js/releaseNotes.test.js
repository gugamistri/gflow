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
  assert.equal(RELEASE_NOTES_VERSION, "0.4.0");
  assert.equal(
    shouldShowReleaseNotes({
      dismissedVersion: "0.3.1",
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

test("GUI-32: novidades avisam que as integrações mudaram de lugar, em pt, en e es", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.version, RELEASE_NOTES_VERSION, "a versão das novidades espelha o package.json");
  const html = readFileSync(new URL("../editor.html", import.meta.url), "utf8");
  const list = html.slice(html.indexOf('class="release-notes-list"'), html.indexOf("</ul>", html.indexOf('class="release-notes-list"')));
  assert.match(list, /data-i18n="releaseNotes\.integrationsMoved">Mudou de lugar/);
  assert.match(list, /data-i18n="releaseNotes\.menus"/);
  const where = { pt: /Resultados › Envio automático[\s\S]*Configurações › Conexões/, es: /Resultados › Envío automático[\s\S]*Configuración › Conexiones/, en: /Results › Automatic delivery[\s\S]*Settings › Connections/ };
  for (const loc of SUPPORTED_LOCALES) {
    const moved = catalogs[loc]["releaseNotes.integrationsMoved"];
    assert.match(moved, where[loc], loc);
    // os nomes dos lugares batem com os rótulos da interface
    assert.ok(moved.includes(catalogs[loc]["results.tab.delivery"]), `${loc} aba Envio`);
    assert.ok(moved.includes(catalogs[loc]["settings.tab.connections"]), `${loc} aba Conexões`);
    assert.ok(catalogs[loc]["releaseNotes.menus"].includes(catalogs[loc]["mbar.publish"]), `${loc} Publicar`);
  }
});

test("0.4.0: novidades citam os lugares com os rótulos da interface, em pt, en e es", () => {
  const html = readFileSync(new URL("../editor.html", import.meta.url), "utf8");
  const start = html.indexOf('class="release-notes-list"');
  const list = html.slice(start, html.indexOf("</ul>", start));
  const keys = [...list.matchAll(/data-i18n="(releaseNotes\.[a-zA-Z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(keys, [
    "releaseNotes.menus",
    "releaseNotes.settings",
    "releaseNotes.clients",
    "releaseNotes.leads",
    "releaseNotes.integrationsMoved",
    "releaseNotes.publish",
    "releaseNotes.video",
  ]);
  assert.ok(keys.length <= 7, "no máximo 7 itens no aviso");
  for (const loc of SUPPORTED_LOCALES) {
    const c = catalogs[loc];
    for (const k of keys) assert.ok(c[k], `${loc} ${k}`);
    for (const tab of ["account", "plan", "team", "clients", "connections", "api"]) {
      assert.ok(c["releaseNotes.settings"].includes(c[`settings.tab.${tab}`]), `${loc} aba ${tab}`);
    }
    assert.ok(c["releaseNotes.clients"].includes(c["clients.moveTitle"]), `${loc} Mover para cliente`);
    assert.ok(c["releaseNotes.publish"].includes(c["topbar.share"]), `${loc} Compartilhar`);
    assert.ok(c["releaseNotes.publish"].includes(c["results.button"]), `${loc} Resultados`);
    // LeadPronto vem antes dos outros destinos, como nos cartões de Envio automático
    const leads = c["releaseNotes.leads"];
    assert.ok(leads.indexOf("LeadPronto") >= 0 && leads.indexOf("LeadPronto") < leads.indexOf("RD Station"), `${loc} LeadPronto primeiro`);
    assert.ok(leads.indexOf("RD Station") < leads.indexOf("HubSpot"), `${loc} RD antes do HubSpot`);
    assert.match(c["releaseNotes.video"], /4K/, `${loc} vídeo até 4K`);
  }
});
