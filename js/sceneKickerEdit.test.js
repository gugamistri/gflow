import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = ["shell", "player", "editor"].map((n) => readFileSync(new URL(`../css/${n}.css`, import.meta.url), "utf8")).join("\n");
const editorJs = readFileSync(new URL("./editor.js", import.meta.url), "utf8");

function rule(selector) {
  const i = css.indexOf(`${selector} {`);
  assert.ok(i >= 0, `regra ${selector} não encontrada`);
  return css.slice(i, css.indexOf("}", i));
}

test("o campo de renomear a cena no slide fica na mesma linha de 'CENA N ·'", () => {
  const r = rule(".slide-kicker .inline-edit");
  assert.match(r, /display:\s*inline-block/);
  assert.match(r, /width:\s*auto/);
  assert.equal(/width:\s*100%/.test(r), false);
});

test("o campo de renomear a cena usa os tokens do tema do tour, não os do app escuro", () => {
  const r = rule(".slide-kicker .inline-edit");
  assert.match(r, /background:\s*var\(--demo-field-bg/);
  assert.match(r, /color:\s*var\(--demo-field-ink/);
  assert.match(r, /color-scheme:\s*var\(--demo-color-scheme/);
  assert.equal(r.includes("--ns-input-bg"), false);
  assert.equal(/color:\s*var\(--ns-ink\)/.test(r), false);
});

test("ao sair do campo (blur/Enter/Esc) o input é removido antes de repintar o rótulo", () => {
  const start = editorJs.indexOf("function renameSceneInline(");
  const body = editorJs.slice(start, editorJs.indexOf("function openSceneModal(", start));
  const finish = body.slice(body.indexOf("const finish ="), body.indexOf("input.addEventListener"));
  const teardown = finish.indexOf("host.textContent =");
  assert.ok(teardown > 0, "finish precisa trocar o input pelo texto");
  assert.ok(teardown < finish.indexOf("renderCanvas()"), "o input sai antes do renderCanvas");
});
