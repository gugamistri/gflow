import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../editor.html", import.meta.url), "utf8");
const theme = readFileSync(new URL("../css/theme.css", import.meta.url), "utf8");
const app = ["shell", "player", "editor"].map((n) => readFileSync(new URL(`../css/${n}.css`, import.meta.url), "utf8")).join("\n");

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

test("Compartilhar em abas: Link, No site e Baixar, com ids e ARIA de abas", () => {
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
  const exportPane = card.slice(card.indexOf('id="pane-share-export"'));
  assert.ok(exportPane.indexOf('id="btn-export-html"') < exportPane.indexOf('id="btn-export-video"'));
  assert.ok(exportPane.indexOf('id="btn-export-video"') < exportPane.indexOf('id="btn-export-vtt"'));
  assert.match(exportPane, /id="export-quality-presets" hidden/);
  assert.match(html, /id="modal-link-copied"/);
  assert.match(html, /data-i18n="share\.tab\.team">Gerenciar Acessos/);
});

test("aba Equipe: botões, painel e host presentes; ativar/gerenciar preservam ids", () => {
  const html = readFileSync(new URL("../editor.html", import.meta.url), "utf8");
  assert.match(html, /data-share-tab="team"[^>]*aria-controls="pane-share-team"/);
  assert.match(html, /role="tabpanel" id="pane-share-team"/);
  for (const id of ["share-team-host", "share-team-off", "btn-share-collab", "btn-team-seats"]) assert.ok(html.includes(`id="${id}"`), id);
  const pane = html.slice(html.indexOf('id="pane-share-link"'), html.indexOf('id="pane-share-team"'));
  assert.ok(!pane.includes('id="btn-share-collab"'), "ativar colaboração saiu da aba Link");
});

test("Resultados: um diálogo com abas Contatos, Envio automático, Análise e Campanhas", () => {
  const h = readFileSync(new URL("../editor.html", import.meta.url), "utf8");
  const js = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../css/editor.css", import.meta.url), "utf8");
  assert.match(h, /id="btn-results"[^>]*aria-label="Resultados"/);
  assert.ok(h.indexOf('id="btn-results"') < h.indexOf('class="export-panel"'), "Resultados vem antes de Compartilhar");
  assert.match(h, /id="btn-menu-results"[\s\S]*data-i18n="results\.menuItem">Resultados: análise e contatos/);
  assert.equal((h.match(/<dialog\b[^>]*id="modal-results"/g) || []).length, 1);
  assert.ok(!h.includes('id="modal-leads"') && !h.includes('id="modal-analytics"'));
  assert.ok(!h.includes('id="btn-share-analytics"') && !h.includes('id="btn-share-leads"'));
  const order = ["leads", "delivery", "analytics", "campaigns"];
  let cursor = 0;
  for (const name of order) {
    const tabAt = h.indexOf(`data-results-tab="${name}"`, cursor);
    assert.ok(tabAt > cursor, name);
    assert.match(h.slice(tabAt, tabAt + 500), new RegExp(`aria-controls="results-pane-${name}"`));
    assert.match(h, new RegExp(`role="tabpanel" id="results-pane-${name}"`));
    assert.equal((h.match(new RegExp(`data-results-tab="${name}"`, "g")) || []).length, 1);
    cursor = tabAt + 1;
  }
  const tablist = h.slice(h.indexOf('class="share-tablist results-tablist"'), h.indexOf('class="results-panes"'));
  assert.equal((tablist.match(/class="pro-badge"/g) || []).length, 4);
  assert.match(tablist, /role="tablist"/);
  const contacts = h.slice(h.indexOf('id="results-pane-leads"'), h.indexOf('id="results-pane-delivery"'));
  assert.ok(!contacts.includes('id="leads-webhook"') && !contacts.includes('id="leads-hubspot"'));
  const delivery = h.slice(h.indexOf('id="results-pane-delivery"'), h.indexOf('id="results-pane-analytics"'));
  for (const id of ["leads-webhook", "leads-rd", "leads-hubspot", "leads-lp"]) {
    assert.ok(delivery.includes(`id="${id}"`), id);
  }
  assert.ok(delivery.indexOf('id="leads-webhook"') < delivery.indexOf('id="leads-rd"'));
  assert.ok(delivery.indexOf('id="leads-rd"') < delivery.indexOf('id="leads-hubspot"'));
  assert.ok(delivery.indexOf('id="leads-hubspot"') < delivery.indexOf('id="leads-lp"'));
  const campaigns = h.slice(h.indexOf('id="results-pane-campaigns"'), h.indexOf("</dialog>", h.indexOf('id="results-pane-campaigns"')));
  assert.ok(campaigns.includes('id="analytics-sources"'));
  assert.ok(campaigns.includes("analytics.sourcesTitle"));
  assert.ok(!h.slice(h.indexOf('id="results-pane-analytics"'), h.indexOf('id="results-pane-campaigns"')).includes('id="analytics-sources"'));
  assert.match(js, /consumeLeadProntoReturn\(\) \{[\s\S]*?openResults\("delivery"\)/);
  assert.match(js, /consumeHubspotReturn\(\) \{[\s\S]*?openResults\("delivery"\)/);
  assert.match(js, /ArrowRight[\s\S]*ArrowLeft[\s\S]*Home[\s\S]*End/);
  assert.match(js, /setAttribute\("aria-selected"/);
  assert.match(css, /dialog\.results-modal\[open\][\s\S]*max-height:\s*calc\(100dvh - 32px\)/);
  assert.match(css, /\.results-panes\s*\{[^}]*overflow:\s*auto/);
  assert.match(css, /\.results-pane\[hidden\]\s*\{[^}]*display:\s*none/);
});

test("cabeçalho: nome do tour é o botão do menu, Editando em na barra ao lado do refazer, Ajuda/Modo/Idioma no menu da Conta", () => {
  const h = readFileSync(new URL("../editor.html", import.meta.url), "utf8");
  const summary = h.slice(h.indexOf('id="btn-file-menu"'), h.indexOf("</summary>", h.indexOf('id="btn-file-menu"')));
  assert.ok(summary.includes('id="topbar-project"'));
  assert.ok(!h.includes('data-i18n="file.menu">Arquivo'));
  assert.ok(h.indexOf('id="btn-redo"') < h.indexOf('id="edit-lang-wrap"'), "Editando em depois de refazer");
  assert.ok(h.indexOf('id="edit-lang-wrap"') < h.indexOf('id="toolbar-pos"'), "dentro da barra de botões");
  assert.ok(!h.slice(0, h.indexOf('id="topbar-actions-editor"') + 400).includes('id="edit-lang-wrap"'));
  assert.ok(h.includes('id="btn-file-projects"'));
  assert.ok(h.includes('id="account-help-slot"') && h.includes('id="help-group"'));
});

test("Sem marca unificado: um só project.removeBranding para link e vídeo; abas com alvos de 44px no celular", () => {
  const h = readFileSync(new URL("../editor.html", import.meta.url), "utf8");
  const js = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  const css = ["shell", "player", "editor"].map((n) => readFileSync(new URL(`../css/${n}.css`, import.meta.url), "utf8")).join("\n");
  assert.ok(h.includes('id="share-remove-brand"') && h.includes('id="export-remove-brand"'));
  assert.match(js, /for \(const id of \["share-remove-brand", "export-remove-brand"\]\)/);
  assert.match(js, /const watermark = billingWatermark \|\| project\.removeBranding === false/);
  assert.match(js, /pro: !billingWatermark/);
  assert.match(css, /is-compact-touch \.share-tab \{ min-height: 48px/);
  for (const role of ["tablist", "tab", "tabpanel"]) assert.ok(h.includes(`role="${role}"`));
});

test("⚙ e Preview ficam na barra de botões, depois de desfazer/refazer e Editando em; celular os devolve ao cabeçalho", () => {
  const h = readFileSync(new URL("../editor.html", import.meta.url), "utf8");
  const js = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  const end = h.indexOf('id="toolbar-tools-end"');
  assert.ok(end > h.indexOf('id="btn-redo"') && end > h.indexOf('id="edit-lang-wrap"'));
  assert.ok(h.indexOf('id="prefs-panel"') > end && h.indexOf('id="preview-split"') > end);
  assert.ok(h.indexOf('id="preview-split"') < h.indexOf('id="toolbar-pos"'));
  assert.match(js, /function placeToolbarTools\(compact\)/);
  assert.match(js, /results\.before\(prefs, preview\)/);
});
