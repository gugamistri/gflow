import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../editor.html", import.meta.url), "utf8");
const editor = readFileSync(new URL("./editor.js", import.meta.url), "utf8");
const i18n = readFileSync(new URL("./i18n.js", import.meta.url), "utf8");

test("menu do Preview tem item Preview automático com dica Shift+P", () => {
  const m = html.match(/<button[^>]*id="btn-preview-auto"[\s\S]*?<\/button>/)?.[0] || "";
  assert.match(m, /role="menuitem"/);
  assert.match(m, /data-i18n="toolbar\.autoPreview"/);
  assert.match(m, /data-i18n="shortcuts\.autoPreviewChord"/);
  assert.match(m, /aria-keyshortcuts="Shift\+P"/);
});

test("item do menu e Shift+P iniciam com autoplay (watchFromSelected)", () => {
  assert.match(editor, /btn-preview-auto"\)\?\.addEventListener\("click", \(\) => \{[\s\S]*?watchFromSelected\(\)/);
  assert.match(editor, /function watchFromSelected\(\) \{\s*playFromSelected\(\{ autoplay: true \}\)/);
  assert.match(editor, /if \(e\.shiftKey\) watchFromSelected\(\)/);
});

test("Shift+P ignora campos de texto", () => {
  const i = editor.indexOf("if (isTypingTarget(e.target)) return;", editor.indexOf("window.addEventListener(\"keydown\", (e) => {", 330000 > editor.length ? 0 : editor.indexOf("btn-empty-step") - 6000));
  assert.ok(i > 0);
});

test("rótulos e atalho existem em pt, es e en", () => {
  for (const k of ["toolbar.autoPreview", "shortcuts.autoPreviewChord"]) {
    assert.equal(i18n.split(`"${k}"`).length - 1, 3, k);
  }
});
