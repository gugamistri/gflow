import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { resolvePlayerLangs } from "./langMenu.js";
import { resolvePlayerUiLocale } from "./i18n.js";
import { resolveContent } from "./tour-schema/i18n.js";
import {
  PACKAGED_EXAMPLES,
  landingExampleHref,
  parseExampleRoute,
  packagedExampleUrl,
} from "./exampleTours.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadExample(id) {
  const url = packagedExampleUrl(id);
  assert.ok(url.startsWith("/"), id);
  const file = join(root, url.slice(1));
  assert.equal(existsSync(file), true, file);
  return JSON.parse(readFileSync(file, "utf8"));
}

test("parseExampleRoute só aceita ids empacotados, com locale opcional no caminho", () => {
  assert.deepEqual(parseExampleRoute("/exemplos/guia"), { kind: "example", id: "guia", pathLocale: null });
  assert.deepEqual(parseExampleRoute("/en/exemplos/galeria"), { kind: "example", id: "galeria", pathLocale: "en" });
  assert.equal(parseExampleRoute("/p/guia"), null);
  assert.equal(parseExampleRoute("/exemplos/colchao"), null);
  assert.equal(parseExampleRoute("/exemplos/"), null);
});

test("landingExampleHref: ?lang= segue o locale da página; ids inválidos ficam vazios", () => {
  assert.equal(landingExampleHref("guia"), "/exemplos/guia");
  assert.equal(landingExampleHref("guia", { locale: "en", embed: true }), "/exemplos/guia?lang=en&embed=1");
  assert.equal(landingExampleHref("galeria", { locale: "es" }), "/exemplos/galeria?lang=es");
  assert.equal(landingExampleHref("nao-existe"), "");
});

test("os exemplos empacotados têm conteúdo em pt, en e es, e o player segue ?lang=", () => {
  assert.equal(PACKAGED_EXAMPLES.guia.mode, "guided");
  assert.equal(PACKAGED_EXAMPLES.galeria.mode, "gallery");
  assert.equal(PACKAGED_EXAMPLES.processo.mode, "guided");
  for (const id of Object.keys(PACKAGED_EXAMPLES)) {
    const project = loadExample(id);
    assert.ok(project.steps?.length, `${id}: passos`);
    assert.equal(project.i18n?.defaultLang, "pt-BR", id);
    const langs = (project.i18n?.langs || []).map((l) => l.lang);
    assert.ok(langs.includes("en"), `${id}: en`);
    assert.ok(langs.includes("es"), `${id}: es`);
    const withText = project.steps.filter((s) => String(s.popover?.title || s.caption || "").trim());
    assert.ok(withText.length, `${id}: texto`);
    for (const step of withText) {
      assert.ok(String(step.i18n?.en?.title || step.i18n?.en?.caption || "").trim(), `${id} ${step.id} en`);
      assert.ok(String(step.i18n?.es?.title || step.i18n?.es?.caption || "").trim(), `${id} ${step.id} es`);
    }
    const ptTitle = withText[0].popover?.title || withText[0].caption;
    const enView = resolveContent(project, "en");
    const esView = resolveContent(project, "es");
    const enTitle = enView.steps[0].popover?.title || enView.steps[0].caption;
    const esTitle = esView.steps[0].popover?.title || esView.steps[0].caption;
    assert.notEqual(enTitle, ptTitle, `${id}: en traduzido`);
    assert.notEqual(esTitle, ptTitle, `${id}: es traduzido`);

    const state = resolvePlayerLangs(project, { search: "?lang=en", languages: ["pt-BR"] });
    assert.equal(state?.text, "en", `${id}: ?lang=en vence o navegador`);
    const ui = resolvePlayerUiLocale({ search: "?lang=es", language: "pt-BR" });
    assert.equal(ui, "es", `${id}: chrome do player em es`);
  }
  const gallery = loadExample("galeria");
  assert.equal(gallery.playback?.mode, "gallery");
  const en = resolveContent(gallery, "en");
  assert.equal(en.name, "Arco Liana table lamp");
  assert.equal(en.sceneLabels["1"], "Overview");
  for (const step of gallery.steps) {
    const file = join(root, String(step.image).replace(/^\//, ""));
    assert.equal(existsSync(file), true, step.image);
  }
  const processo = loadExample("processo");
  assert.equal(processo.steps.length, 6);
  assert.equal(resolveContent(processo, "en").name, "How to request a reimbursement");
  for (const step of processo.steps) {
    const file = join(root, String(step.image).replace(/^\//, ""));
    assert.equal(existsSync(file), true, step.image);
  }
});
