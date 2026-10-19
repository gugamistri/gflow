import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../editor.html", import.meta.url), "utf8");
const theme = readFileSync(new URL("../css/theme.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../css/app.css", import.meta.url), "utf8");

test("a seta anterior do cartão tem contorno visível e não usa a cor da barra", () => {
  const start = theme.indexOf(".driver-popover.demo-popover .driver-popover-prev-btn {");
  const block = theme.slice(start, theme.indexOf(".driver-popover.demo-popover .driver-popover-prev-btn svg"));
  assert.match(block, /color:\s*var\(--demo-popover-title\)/);
  assert.match(block, /border:\s*1\.5px solid/);
  assert.equal(block.includes("var(--ns-ink)"), false);
  assert.match(theme, /\.driver-popover-prev-btn:disabled[\s\S]*opacity:\s*0\.45/);
});

test("o link do painel tem Copiar no campo e não mostra hora", () => {
  const start = html.indexOf('id="share-link-actions"');
  const end = html.indexOf('id="cloud-share-block"');
  const block = html.slice(start, end);
  assert.equal(block.includes("share-link-status"), false);
  assert.equal(block.includes("Atualizado agora"), false);
  assert.match(block, /class="share-link-field"[\s\S]*id="share-link-url"[\s\S]*id="btn-share-copy"/);
  assert.match(block, /id="btn-share-republish"/);
  assert.match(block, /id="share-stale"/);
});

test("o ponto de desatualizado fica na borda do botão, não por cima do ícone", () => {
  const start = app.indexOf(".share-stale-dot {");
  const block = app.slice(start, app.indexOf(".share-stale-dot[hidden]"));
  assert.match(block, /top:\s*-3px/);
  assert.match(block, /right:\s*-3px/);
  assert.match(block, /box-shadow:\s*0 0 0 2px var\(--ns-topbar\)/);
  assert.match(app, /summary\.share-menu[\s\S]*overflow:\s*visible/);
});

test("Compartilhar em abas: Link, Incorporar e Baixar, com ids e ARIA de abas", () => {
  const html = readFileSync(new URL("../editor.html", import.meta.url), "utf8");
  const card = html.slice(html.indexOf('id="share-card"'), html.indexOf("</details>", html.indexOf('id="share-card"')));
  assert.match(card, /role="tablist"/);
  for (const [tab, pane] of [["tab-share-link", "pane-share-link"], ["btn-share-embed", "pane-share-embed"], ["tab-share-export", "pane-share-export"]]) {
    assert.match(card, new RegExp(`id="${tab}"[^>]*role="tab"|role="tab"[^>]*id="${tab}"`));
    assert.match(card, new RegExp(`role="tabpanel" id="${pane}"`));
    assert.match(card, new RegExp(`aria-controls="${pane}"`));
  }
  const inPane = (pane, id) => {
    const start = card.indexOf(`id="${pane}"`);
    const rest = card.slice(start + 1);
    const next = rest.search(/id="pane-share-/);
    const chunk = next < 0 ? rest : rest.slice(0, next);
    return chunk.includes(`id="${id}"`);
  };
  assert.ok(inPane("pane-share-link", "btn-share-publish"));
  assert.ok(inPane("pane-share-embed", "embed-code"));
  assert.ok(inPane("pane-share-export", "btn-export-video"));
  assert.ok(inPane("pane-share-export", "export-video-quality"));
});

test("aba Equipe: botões, painel e host presentes; ativar/gerenciar preservam ids", () => {
  const html = readFileSync(new URL("../editor.html", import.meta.url), "utf8");
  assert.match(html, /data-share-tab="team"[^>]*aria-controls="pane-share-team"/);
  assert.match(html, /role="tabpanel" id="pane-share-team"/);
  for (const id of ["share-team-host", "share-team-off", "btn-share-collab", "btn-team-seats"]) assert.ok(html.includes(`id="${id}"`), id);
  const pane = html.slice(html.indexOf('id="pane-share-link"'), html.indexOf('id="pane-share-team"'));
  assert.ok(!pane.includes('id="btn-share-collab"'), "ativar colaboração saiu da aba Link");
});
