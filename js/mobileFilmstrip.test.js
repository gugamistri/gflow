import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = ["shell", "player", "editor"]
  .map((n) => readFileSync(new URL(`../css/${n}.css`, import.meta.url), "utf8"))
  .join("\n");
const editor = readFileSync(new URL("./editor.js", import.meta.url), "utf8");

test("celular: o cartão do passo não gasta uma linha com setas e ×; a ação fica no ⋯", () => {
  assert.match(editor, /class="film-action-menu" data-action="menu"/);
  assert.match(css, /body\.has-mobile-bar \.film-action-menu\s*\{[^}]*width:\s*28px;[^}]*height:\s*28px;/);
  assert.match(
    css,
    /body\.has-mobile-bar \.film-item \.film-action-move,\s*body\.has-mobile-bar \.film-item \.film-action-close\s*\{\s*display:\s*none;\s*\}/
  );
  assert.match(css, /body\.has-mobile-bar \.film-item:not\(\.is-active\) \.film-action-menu\s*\{\s*display:\s*none;/);
});

test("celular: «Sincronizado» em repouso não ocupa faixa; offline/erro ainda avisa", () => {
  assert.match(
    css,
    /body\.has-mobile-bar \.filmstrip-notices:has\(> \.sync-status\[data-phase="synced"\]/
  );
  assert.match(
    css,
    /body\.has-mobile-bar \.filmstrip-notices:has\(> \.sync-status\[data-phase="syncing"\]/
  );
  // offline e erro continuam na faixa: nenhuma regra some com eles
  assert.equal(/data-phase="offline"\][^{]*\{[^}]*display:\s*none/.test(css), false);
  assert.equal(/data-phase="error"\][^{]*\{[^}]*display:\s*none/.test(css), false);
});

test("celular: segurar o cartão e arrastar reordena, como as setas faziam", () => {
  assert.match(editor, /TOUCH_DRAG_HOLD_MS/);
  assert.match(editor, /pointerType === "mouse" \|\| !isCompactTouch\(\)/);
  assert.match(editor, /reorderStepGroup\(\[drag\.from\], insertBefore, drag\.target\.scene\)/);
  assert.match(css, /body\.has-mobile-bar \.film-item\.is-touch-dragging/);
  assert.match(css, /body\.is-film-dragging \.filmstrip\s*\{\s*scroll-snap-type:\s*none;/);
});

test("celular: o menu do cartão vira folha colada na barra de baixo, com alvo de 44px", () => {
  assert.match(editor, /menu\.classList\.add\("is-sheet"\)/);
  assert.match(css, /\.film-context-menu\.is-sheet\s*\{[^}]*max-height:\s*60dvh;/);
  assert.match(css, /\.film-context-menu\.is-sheet button\s*\{\s*min-height:\s*44px;/);
});

test("celular: o cartão Início/Fim tem a mesma largura dos passos e recorta o texto", () => {
  assert.match(css, /body\.has-mobile-bar \.film-item\s*\{[^}]*width:\s*104px;/);
  assert.match(css, /body\.has-mobile-bar \.film-fixed\s*\{[^}]*width:\s*104px;/);
  assert.match(css, /body\.has-mobile-bar \.film-fixed-icon\s*\{[^}]*height:\s*56px;/);
  assert.match(css, /body\.has-mobile-bar \.film-item img,\s*body\.has-mobile-bar \.film-item \.film-thumb-slide\s*\{\s*width:\s*100%;\s*height:\s*56px;/);
  assert.match(css, /body\.has-mobile-bar \.film-fixed-text strong\s*\{[^}]*text-overflow:\s*ellipsis;/);
  assert.match(css, /body\.has-mobile-bar \.film-fixed-text small\s*\{\s*display:\s*none;/);
});

test("celular: o rótulo vertical da cena não passa da altura do cartão", () => {
  assert.match(css, /body\.has-mobile-bar \.film-scene\s*\{[^}]*max-height:\s*85px;/);
  assert.equal(/body\.has-mobile-bar \.film-scene\s*\{[^}]*max-height:\s*120px;/.test(css), false);
});
