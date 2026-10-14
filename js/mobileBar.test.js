import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mirrorState, mobileBarVisible, SHEET_SECTIONS } from "./mobileBar.js";

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
  for (const a of ["undo", "redo", "add", "text", "narration", "settings"]) assert.match(html, new RegExp(`data-mbar="${a}"`));
});

test("botão de áudio espelha oculto, desativado e o selo Pro do original", () => {
  const badge = { hidden: false };
  const src = { hidden: false, disabled: true, getAttribute: () => "Gerar áudio", querySelector: () => badge };
  assert.deepEqual(mirrorState(src), { hidden: false, disabled: true, label: "Gerar áudio", pro: true });
  badge.hidden = true;
  assert.equal(mirrorState(src).pro, false);
  assert.equal(mirrorState(null).hidden, true);
});
