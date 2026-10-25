import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { catalogs, SUPPORTED_LOCALES } from "./i18n.js";
import { CAPTURE_TABS, captureChanges, captureTabForShortcut, nextCaptureTab } from "./fixedStepsEditor.js";

const html = readFileSync(new URL("../editor.html", import.meta.url), "utf8");
const editorJs = readFileSync(new URL("./fixedStepsEditor.js", import.meta.url), "utf8");
const appJs = readFileSync(new URL("./app.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../css/editor.css", import.meta.url), "utf8");

function dialogHtml() {
  const start = html.indexOf('id="modal-capture"');
  assert.ok(start > 0);
  return html.slice(start, html.indexOf("</dialog>", start));
}

test("botão Captura fica na barra antes de Compartilhar e Resultados", () => {
  const bar = html.slice(html.indexOf('id="topbar-actions-editor"'), html.indexOf('id="share-card"'));
  const capture = bar.indexOf('id="btn-capture"');
  const results = bar.indexOf('id="btn-results"');
  const share = bar.indexOf('class="export-panel"');
  assert.ok(capture >= 0 && capture < results && capture < share);
  assert.match(bar, /id="btn-capture"[^>]*aria-haspopup="dialog"/);
  assert.match(bar, /data-i18n="capture\.button">Captura/);
});

test("abas da Captura: papéis, aria-selected e painéis", () => {
  const dialog = dialogHtml();
  assert.match(dialog, /role="tablist"/);
  assert.equal((dialog.match(/role="tab"/g) || []).length, 4);
  assert.equal((dialog.match(/role="tabpanel"/g) || []).length, 4);
  const tabs = [...dialog.matchAll(/id="(tab-capture-[a-z]+)"[^>]*data-capture-tab="([a-z]+)"[^>]*aria-controls="(pane-capture-[a-z]+)"/g)];
  assert.deepEqual(tabs.map((m) => m[2]), [...CAPTURE_TABS]);
  for (const [, id, name, pane] of tabs) {
    assert.equal(pane, `pane-capture-${name}`);
    assert.match(dialog, new RegExp(`id="${pane}"[^>]*aria-labelledby="${id}"|aria-labelledby="${id}"[^>]*id="${pane}"`));
  }
  assert.equal((dialog.match(/aria-selected="true"/g) || []).length, 1);
  assert.match(dialog, /id="tab-capture-form"[^>]*aria-selected="true"/);
  assert.match(dialog, /id="capture-form-pro-badge"/);
  assert.match(dialog, /id="fixed-end-mode-form-wrap"[\s\S]*class="pro-badge"/);
  assert.ok(dialog.indexOf('class="capture-panes"') < dialog.indexOf('class="fixed-preview-wrap"'));
  assert.match(dialog, /class="fixed-grid capture-grid"/);
});

test("setas, Home e End mudam a aba e o atalho 📌 abre a aba certa", () => {
  assert.deepEqual(
    ["ArrowRight", "ArrowRight", "ArrowRight", "ArrowRight"].reduce((tab, key) => nextCaptureTab(tab, key), "form"),
    "form",
  );
  assert.equal(nextCaptureTab("form", "ArrowLeft"), "consent");
  assert.equal(nextCaptureTab("fields", "Home"), "form");
  assert.equal(nextCaptureTab("form", "End"), "consent");
  assert.equal(nextCaptureTab("end", "ArrowRight"), "consent");
  assert.equal(nextCaptureTab("consent", "ArrowLeft"), "end");
  assert.equal(nextCaptureTab("end", "ArrowLeft", ["form", "end"]), "form");
  assert.equal(nextCaptureTab("form", "End", ["form", "end"]), "end");
  assert.equal(captureTabForShortcut("start"), "form");
  assert.equal(captureTabForShortcut("end"), "end");
  assert.equal(captureTabForShortcut("fields"), "fields");
  assert.equal(captureTabForShortcut("consent"), "consent");
  assert.match(editorJs, /ArrowRight" && e\.key !== "ArrowLeft" && e\.key !== "Home" && e\.key !== "End"/);
  assert.match(editorJs, /selectTab\(nextCaptureTab\(selected, e\.key, names\), \{ focus: true \}\)/);
  assert.match(editorJs, /tab\.setAttribute\("aria-selected", on \? "true" : "false"\)/);
  assert.match(appJs, /fixedStepsEditor\.open\(kind\)/);
  assert.match(appJs, /btn-capture"\)\?\.addEventListener\("click", \(\) => openFixedStep\("form"\)\)/);
});

test("um salvamento compara os dois lados e o app grava um passo de histórico", () => {
  const before = { start: { enabled: false, title: "" }, end: { enabled: false, title: "Fim" } };
  assert.deepEqual(captureChanges(before, { ...before }), { start: false, end: false });
  assert.deepEqual(captureChanges(before, { start: { enabled: true, title: "" }, end: before.end }), { start: true, end: false });
  assert.deepEqual(
    captureChanges(before, { start: { enabled: true, title: "A" }, end: { enabled: true, title: "B" } }),
    { start: true, end: true },
  );
  const saved = appJs.slice(appJs.indexOf("onSaved: (kind) =>"), appJs.indexOf("const leadsDialog"));
  assert.equal((saved.match(/onChange\(\)/g) || []).length, 1);
  assert.match(saved, /kind === "start" \? "fixed\.start\.saved" : kind === "end" \? "fixed\.saved" : "capture\.saved"/);
});

test("prévia ao lado no desktop e abaixo no celular; textos da Captura em pt, en e es", () => {
  assert.match(css, /\.fixed-grid \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) minmax\(0, 0\.82fr\)/);
  const narrow = css.slice(css.indexOf("@media (max-width: 720px)"));
  assert.match(narrow, /\.fixed-grid \{[\s\S]*?grid-template-columns: 1fr/);
  assert.match(css, /@media \(min-width: 900px\) \{[\s\S]*?\.capture-end-split \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/);
  const keys = [
    "capture.button", "capture.title", "capture.dialogTitle", "capture.tabsAria",
    "capture.tab.form", "capture.tab.fields", "capture.tab.end", "capture.tab.consent",
    "capture.saved", "capture.fieldsOff", "capture.consentStart", "capture.consentEnd", "capture.consentEndHint",
  ];
  for (const loc of SUPPORTED_LOCALES) {
    for (const key of keys) {
      assert.equal(typeof catalogs[loc][key], "string", `${loc} ${key}`);
      assert.ok(catalogs[loc][key].trim(), `${loc} ${key}`);
    }
  }
  assert.equal(catalogs.pt["capture.tab.form"], "Formulário inicial");
  assert.equal(catalogs.en["capture.tab.fields"], "Fields");
  assert.equal(catalogs.es["capture.tab.consent"], "Consentimiento");
});
