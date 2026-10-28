import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mirrorState, mobileBarVisible, publishState, PUBLISH_ITEMS, SHEET_SECTIONS } from "./mobileBar.js";
import { catalogs, SUPPORTED_LOCALES } from "./i18n.js";

test("barra mobile só aparece no editor, no toque compacto e fora da apresentação", () => {
  assert.equal(mobileBarVisible({ compact: true, view: "editor", presenting: false }), true);
  assert.equal(mobileBarVisible({ compact: false, view: "editor", presenting: false }), false);
  assert.equal(mobileBarVisible({ compact: true, view: "library", presenting: false }), false);
  assert.equal(mobileBarVisible({ compact: true, view: "editor", presenting: true }), false);
});

test("folha abre as seções de texto e narração do painel", () => {
  assert.deepEqual(SHEET_SECTIONS, { text: "texts", narration: "narration" });
  const html = readFileSync(new URL("../editor.html", import.meta.url), "utf8");
  assert.match(html, /data-sec="texts"/);
  assert.match(html, /data-sec="narration"/);
  for (const a of ["undo", "redo", "add", "text", "narration", "publish", "settings"]) assert.match(html, new RegExp(`data-mbar="${a}"`));
});

test("botão de áudio espelha oculto, desativado e o selo Pro do original", () => {
  const badge = { hidden: false };
  const src = { hidden: false, disabled: true, getAttribute: () => "Gerar áudio", querySelector: () => badge };
  assert.deepEqual(mirrorState(src), { hidden: false, disabled: true, label: "Gerar áudio", pro: true });
  badge.hidden = true;
  assert.equal(mirrorState(src).pro, false);
  assert.equal(mirrorState(null).hidden, true);
});

test("GUI-32: Publicar abre Captura, Compartilhar e Resultados, nessa ordem", () => {
  assert.deepEqual([...PUBLISH_ITEMS], ["capture", "share", "results"]);
  const html = readFileSync(new URL("../editor.html", import.meta.url), "utf8");
  const bar = html.slice(html.indexOf('id="mobile-bar"'), html.indexOf("</nav>", html.indexOf('id="mobile-bar"')));
  assert.match(bar, /data-mbar="publish"[^>]*aria-haspopup="menu"[^>]*aria-controls="mobile-publish"[^>]*aria-expanded="false"/);
  assert.ok(bar.indexOf('data-mbar="publish"') < bar.indexOf('data-mbar="settings"'));
  const at = html.indexOf('id="mobile-publish"');
  const sheet = html.slice(at, html.indexOf("\n  </div>", at));
  assert.match(html.slice(html.lastIndexOf("<div", at), at + 200), /role="menu"[^>]*data-i18n-aria="mbar\.publish"[^>]*hidden/);
  let cursor = 0;
  for (const k of PUBLISH_ITEMS) {
    const i = sheet.indexOf(`data-publish="${k}"`);
    assert.ok(i > cursor, k);
    cursor = i;
  }
  for (const loc of SUPPORTED_LOCALES) {
    for (const key of ["mbar.publish", "mbar.publishTitle", "mbar.publishCaptureHint", "mbar.publishShareHint", "mbar.publishResultsHint"]) {
      assert.ok(catalogs[loc][key]?.trim(), `${loc} ${key}`);
    }
  }
  assert.equal(catalogs.en["mbar.publish"], "Publish");
});

test("GUI-32: itens de Publicar seguem os botões do cabeçalho (oculto, desativado, Pro, desatualizado)", () => {
  const capture = { hidden: false, disabled: true };
  const results = { hidden: true, disabled: false };
  const share = {};
  let st = publishState({ capture, share, results, resultsBadge: { hidden: false }, staleDot: { hidden: true } });
  assert.deepEqual(st.capture, { hidden: false, disabled: true });
  assert.equal(st.results.hidden, true);
  assert.equal(st.results.pro, true);
  assert.equal(st.share.stale, false);
  results.hidden = false;
  st = publishState({ capture, share, results, resultsBadge: { hidden: true }, staleDot: { hidden: false } });
  assert.equal(st.results.hidden, false);
  assert.equal(st.results.pro, false);
  assert.equal(st.share.stale, true);
  st = publishState({});
  assert.equal(st.capture.hidden, true);
  assert.equal(st.share.hidden, true);
  assert.equal(st.results.hidden, true);
});
