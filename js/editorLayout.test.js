import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PROPS_PANEL_STORAGE_KEY,
  isPropsPanelShortcut,
  planToolbarOverflow,
  readPropsPanelOpen,
  writePropsPanelOpen,
} from "./editorLayout.js";
import { catalogs, SUPPORTED_LOCALES } from "./i18n.js";

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v);
    },
  };
}

test("o painel começa aberto e lembra quando foi recolhido", () => {
  const storage = memoryStorage();
  assert.equal(readPropsPanelOpen(storage), true);
  writePropsPanelOpen(storage, false);
  assert.equal(storage.data[PROPS_PANEL_STORAGE_KEY], "0");
  assert.equal(readPropsPanelOpen(storage), false);
  writePropsPanelOpen(storage, true);
  assert.equal(readPropsPanelOpen(storage), true);
});

test("sem localStorage o painel fica aberto", () => {
  const broken = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };
  assert.equal(readPropsPanelOpen(broken), true);
  assert.doesNotThrow(() => writePropsPanelOpen(broken, false));
  assert.equal(readPropsPanelOpen(null), true);
});

test("Ctrl/⌘ + \\ alterna o painel, inclusive no ABNT2", () => {
  assert.equal(isPropsPanelShortcut({ ctrlKey: true, code: "Backslash", key: "\\" }), true);
  assert.equal(isPropsPanelShortcut({ metaKey: true, code: "Backslash", key: "\\" }), true);
  assert.equal(isPropsPanelShortcut({ ctrlKey: true, code: "IntlBackslash", key: "]" }), true);
  assert.equal(isPropsPanelShortcut({ ctrlKey: true, code: "KeyX", key: "\\" }), true);
  assert.equal(isPropsPanelShortcut({ code: "Backslash", key: "\\" }), false);
  assert.equal(isPropsPanelShortcut({ ctrlKey: true, altKey: true, code: "Backslash" }), false);
  assert.equal(isPropsPanelShortcut({ ctrlKey: true, shiftKey: true, code: "Backslash" }), false);
  assert.equal(isPropsPanelShortcut({ ctrlKey: true, code: "KeyP", key: "p" }), false);
});

test("a barra do passo cabe inteira quando há espaço", () => {
  assert.deepEqual([...planToolbarOverflow([80, 200, 120, 180], [4, 1, 2, 3], 700, 13)], []);
});

test("sem espaço, sai primeiro o grupo de menor prioridade", () => {
  // 80 + 200 + 120 + 180 + 3 separadores (13) = 619
  assert.deepEqual([...planToolbarOverflow([80, 200, 120, 180], [4, 1, 2, 3], 600, 13)], [1]);
  assert.deepEqual([...planToolbarOverflow([80, 200, 120, 180], [4, 1, 2, 3], 300, 13)].sort(), [1, 2]);
  assert.deepEqual([...planToolbarOverflow([80, 200, 120, 180], [4, 1, 2, 3], 90, 13)].sort(), [1, 2, 3]);
});

test("empate de prioridade: sai o grupo mais à direita; nada cabe → tudo no menu", () => {
  assert.deepEqual([...planToolbarOverflow([100, 100, 100], [1, 1, 1], 250, 0)], [2]);
  assert.equal(planToolbarOverflow([100, 100], [1, 2], 10, 0).size, 2);
});

const html = readFileSync(new URL("../editor.html", import.meta.url), "utf8");

function block(startNeedle, endNeedle) {
  const start = html.indexOf(startNeedle);
  const end = html.indexOf(endNeedle, start);
  assert.ok(start > 0 && end > start, `${startNeedle} … ${endNeedle}`);
  return html.slice(start, end);
}

test("+ Passo, + Slide e + Cena são só ícone, com tooltip e aria-label", () => {
  const toolbar = block('class="canvas-toolbar"', 'id="step-toolbar"');
  for (const [id, icon] of [
    ["btn-add-step", "i-plus"],
    ["btn-add-slide", "i-slide"],
    ["btn-add-scene", "i-layers"],
  ]) {
    const at = toolbar.indexOf(`id="${id}"`);
    assert.ok(at > 0, id);
    const tag = toolbar.slice(toolbar.lastIndexOf("<button", at), toolbar.indexOf("</button>", at));
    assert.match(tag, /btn-icon/, id);
    assert.match(tag, /data-i18n-title="/, id);
    assert.match(tag, /data-i18n-aria="/, id);
    assert.match(tag, new RegExp(`href="#${icon}"`), id);
    assert.equal(/<span/.test(tag), false, `${id} sem texto`);
  }
  assert.equal(toolbar.includes("btn-watch-from"), false);
  assert.equal(toolbar.includes("btn-add-images"), false);
  assert.equal(/>\s*Este passo\s*</i.test(toolbar), false);
});

test("o header não tem mais o ícone de relógio do Preview automático", () => {
  const header = block("<header", "</header>");
  assert.equal(header.includes("btn-watch-from"), false);
  // Preview e ⚙ moraram no cabeçalho; agora ficam na barra de botões (toolbar-tools-end)
  assert.equal(header.includes("btn-play-from"), false);
  assert.match(html, /id="btn-play-from"/);
  assert.match(html, /id="preview-panel"/);
  assert.match(header, /class="share-label" data-i18n="topbar.share">Compartilhar</);
  assert.match(header, /id="file-panel"/);
  for (const id of ["btn-file-new", "btn-file-open", "btn-file-import", "btn-export-json", "btn-file-rename", "btn-capture-desktop", "btn-file-delete"]) {
    assert.match(header, new RegExp(`id="${id}"`), id);
  }
  const prefs = block('id="prefs-panel"', 'id="preview-split"');
  assert.match(prefs, /id="theme-panel"/);
  assert.match(prefs, /id="narration-panel"/);
  const appMenu = block('id="more-panel"', "</details>\n    <div class=\"topbar-brand\">");
  assert.equal(appMenu.includes('id="theme-panel"'), false);
});

test("o painel recolhido mantém um trilho com as seções", () => {
  const panel = block('id="props-panel"', "</aside>");
  assert.match(panel, /id="btn-props-toggle"[^>]*aria-expanded="true"/);
  for (const sec of ["image", "texts", "narration", "playback", "position"]) {
    assert.match(panel, new RegExp(`data-rail="${sec}"`), sec);
    assert.match(panel, new RegExp(`data-sec="${sec}"`), sec);
  }
});

test("barra do passo fixa reúne todos os controles do passo", () => {
  const bar = block('id="step-toolbar"', 'id="present-chrome"');
  for (const id of [
    "stb-type",
    "stb-image",
    "stb-side",
    "stb-align",
    "stb-simulate",
    "stb-zoom",
    "stb-hold",
    "btn-step-generate-copy",
    "pro-badge-copy-title",
    "btn-generate-caption",
    "pro-badge-audio",
    "btn-upload-caption",
    "btn-clear-caption-audio",
    "prop-show-caption",
    "stb-more",
    "stb-open-panel",
  ]) {
    assert.match(bar, new RegExp(`id="${id}"`), id);
  }
  // Todo botão da barra tem tooltip e nome acessível (traduzidos).
  for (const m of bar.matchAll(/<button\b[^>]*>/g)) {
    const tag = m[0];
    if (/id="stb-open-panel"/.test(tag)) continue;
    if (/data-value="(start|center|end)"/.test(tag) && !/data-scope/.test(tag)) continue; // rótulo vem do JS
    assert.match(tag, /data-i18n-aria="/, tag);
    assert.match(tag, /data-i18n-title="/, tag);
  }
  assert.match(bar, /class="stb-btn stb-screen-only" id="stb-image"/);
  assert.match(bar, /id="stb-simulate"/);
  assert.equal((bar.match(/data-stb-group="/g) || []).length, 4);
});

test("sem barra flutuante nem título acima da imagem", () => {
  for (const id of ["float-toolbar", "canvas-titlebar", "canvas-step-title", "ftb-more"]) {
    assert.equal(html.includes(`id="${id}"`), false, id);
  }
});

test("barra de baixo é só o player do áudio", () => {
  const bar = block('id="narration-bar"', "</section>");
  for (const id of ["caption-player", "btn-caption-play", "caption-seek", "caption-time", "caption-duration", "btn-caption-rate"]) {
    assert.match(bar, new RegExp(`id="${id}"`), id);
  }
  for (const id of ["btn-generate-caption", "btn-upload-caption", "btn-clear-caption-audio", "prop-show-caption", "btn-narr-write"]) {
    assert.equal(bar.includes(`id="${id}"`), false, id);
  }
  assert.match(bar, /^id="narration-bar"[^>]*\shidden>/);
  const panel = block('id="props-panel"', "</aside>");
  assert.equal(panel.includes('id="caption-player"'), false);
  assert.match(panel, /id="prop-caption"/);
  assert.match(panel, /id="caption-audio-status"/);
});

test("textos novos do layout existem em pt, es e en, sem falar em nuvem", () => {
  const keys = Object.keys(catalogs.pt).filter((k) =>
    /^(file|prefs|preview|panel|stb|narrbar)\./.test(k) ||
    ["toolbar.addStep", "toolbar.addSlide", "toolbar.addScene", "toolbar.cut", "toolbar.cutTitle", "toolbar.delete", "toolbar.deleteTitle", "toolbar.pos", "canvas.changeImage", "filmstrip.addImagesTitle"].includes(k)
  );
  assert.ok(keys.length >= 30, `poucas chaves: ${keys.length}`);
  for (const loc of SUPPORTED_LOCALES) {
    for (const key of keys) {
      const value = catalogs[loc][key];
      assert.equal(typeof value, "string", `${loc} ${key}`);
      assert.ok(value.trim(), `${loc} ${key}`);
      assert.equal(/nuvem|nube|\bcloud\b/i.test(value), false, `${loc} ${key}: ${value}`);
    }
  }
  const usedInHtml = [...html.matchAll(/data-i18n(?:-title|-aria|-placeholder|-alt)?="([^"]+)"/g)].map((m) => m[1]);
  for (const key of usedInHtml) {
    assert.equal(typeof catalogs.pt[key], "string", `editor.html usa ${key}`);
  }
});

test("topo da filmstrip: só a duração, com ícone de relógio e tooltip traduzido", () => {
  assert.match(html, /<symbol id="i-clock"/);
  const editor = readFileSync(new URL("./editor.js", import.meta.url), "utf8");
  assert.match(editor, /#i-clock/);
  assert.match(editor, /editor\.durationTitle/);
  assert.match(editor, /editor\.durationAria/);
  for (const loc of SUPPORTED_LOCALES) {
    for (const key of ["editor.durationLabel", "editor.durationTitle", "editor.durationAria"]) {
      assert.equal(typeof catalogs[loc][key], "string", `${loc} ${key}`);
    }
    assert.match(catalogs[loc]["editor.durationAria"], /\{time\}/, loc);
  }
  assert.equal(catalogs.pt["editor.durationTitle"], "Duração total do tour");
});

test("Preview ocupa a tela toda mesmo com o painel recolhido (sem grade de 3 colunas)", () => {
  const css = ["shell", "player", "editor"].map((n) => readFileSync(new URL(`../css/${n}.css`, import.meta.url), "utf8")).join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
  const offenders = [];
  let presentingOneColumn = false;
  for (const [, selectorList, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const cols = body.match(/grid-template-columns\s*:\s*([^;]+)/);
    if (!cols) continue;
    for (const raw of selectorList.split(",")) {
      const sel = raw.trim();
      if (!/^\.view-editor(?![\w-])/.test(sel) || /\s/.test(sel)) continue;
      if (/\.is-presenting(?!\))/.test(sel) && cols[1].trim() === "1fr") presentingOneColumn = true;
      // .view-editor sozinho perde para .view-editor.is-presenting; qualquer modificador a mais
      // (ex.: .is-props-collapsed) empata em especificidade e, vindo depois, sobrescreve o Preview.
      // A exclusão vai dentro de :where() para não subir a especificidade e vencer a regra
      // de 1 coluna do celular (.view-editor:not(.is-presenting)).
      const extraClasses = (sel.replace(/:where\((?:[^()]|\([^()]*\))*\)|:not\([^)]*\)/g, "").match(/\.[\w-]+/g) || []).length - 1;
      const multiColumn = cols[1].trim().split(/\s+(?![^(]*\))/).length > 1;
      if (multiColumn && extraClasses > 0 && !sel.includes(":where(:not(.is-presenting))")) offenders.push(sel);
    }
  }
  assert.equal(presentingOneColumn, true);
  assert.deepEqual(offenders, []);
});

test("topo da filmstrip e barra do canvas têm a mesma altura (variável compartilhada)", () => {
  const css = ["shell", "player", "editor"].map((n) => readFileSync(new URL(`../css/${n}.css`, import.meta.url), "utf8")).join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({
    sels: sel.split(",").map((s) => s.trim()),
    body,
  }));
  const defs = rules.filter((r) => /--editor-bar-h\s*:/.test(r.body));
  assert.equal(defs.length, 1, "--editor-bar-h definida uma vez só");
  assert.deepEqual(defs[0].sels, [".view-editor"]);
  const shared = rules.find(
    (r) =>
      r.sels.includes(".filmstrip-header") &&
      r.sels.includes(".canvas-toolbar") &&
      /(^|[;\s])height\s*:\s*var\(--editor-bar-h\)/.test(r.body)
  );
  assert.ok(shared, "uma regra só dá height: var(--editor-bar-h) às duas barras");
  assert.match(shared.body, /min-height\s*:\s*var\(--editor-bar-h\)/);
  assert.match(shared.body, /box-sizing\s*:\s*border-box/);
  assert.match(shared.body, /border-bottom\s*:\s*1px solid/);
  // Nenhuma outra regra de desktop muda a altura de uma das duas sozinha.
  for (const r of rules) {
    if (r === shared) continue;
    const one = r.sels.filter((s) => s === ".filmstrip-header" || s === ".canvas-toolbar");
    if (!one.length) continue;
    assert.equal(/(^|[;\s])(min-)?height\s*:/.test(r.body) && !/height\s*:\s*auto/.test(r.body), false, `${r.sels} muda a altura`);
  }
  // O topo da filmstrip só tem a duração: avisos ficam fora da barra de altura fixa.
  const header = block('class="filmstrip-header"', "</div>");
  assert.match(header, /id="filmstrip-metrics"/);
  assert.equal(header.includes("local-save"), false);
  assert.equal(header.includes("filmstrip-multi-hint"), false);
  assert.match(html, /class="filmstrip-notices">\s*<p class="local-save" id="local-save-editor"/);
  // O rótulo "Duração" não usa o cinza apagado e a dica não é o title nativo (abria por cima dele).
  const label = rules.filter((r) => r.sels.includes(".filmstrip-metrics .metrics-label")).pop();
  assert.equal(/color\s*:\s*var\(--ns-muted\)/.test(label.body), false);
  const editor = readFileSync(new URL("./editor.js", import.meta.url), "utf8");
  assert.match(editor, /el\.dataset\.tip = t\("editor\.durationTitle"\)/);
  assert.equal(/el\.title = compact \? full : t\("editor\.durationTitle"\)/.test(editor), false);
});
