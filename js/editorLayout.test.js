import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PROPS_PANEL_STORAGE_KEY,
  boxesOverlap,
  isPropsPanelShortcut,
  placeFloatToolbarBox,
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

test("a barra flutuante fica acima do destaque quando cabe", () => {
  const box = placeFloatToolbarBox(
    { left: 300, top: 200, width: 100, height: 40 },
    { width: 200, height: 36 },
    { width: 800, height: 500 }
  );
  assert.equal(box.placement, "above");
  assert.equal(box.left, 250);
  assert.ok(box.top + 36 <= 200);
});

test("sem espaço em cima, a barra vai para baixo e respeita as bordas", () => {
  const box = placeFloatToolbarBox(
    { left: 700, top: 10, width: 90, height: 40 },
    { width: 200, height: 36 },
    { width: 800, height: 500 }
  );
  assert.equal(box.placement, "below");
  assert.equal(box.top, 60);
  assert.equal(box.left, 800 - 200 - 4);
});

test("a barra não cobre o balão: desce para depois dele", () => {
  const anchor = { left: 300, top: 10, width: 100, height: 40 };
  const popover = { left: 230, top: 60, width: 240, height: 120 };
  const box = placeFloatToolbarBox(anchor, { width: 200, height: 36 }, { width: 800, height: 500 }, popover);
  assert.equal(boxesOverlap({ left: box.left, top: box.top, width: 200, height: 36 }, popover), false);
  assert.ok(box.top >= popover.top + popover.height);
});

test("boxesOverlap ignora caixas encostadas", () => {
  assert.equal(boxesOverlap({ left: 0, top: 0, width: 10, height: 10 }, { left: 10, top: 0, width: 5, height: 5 }), false);
  assert.equal(boxesOverlap({ left: 0, top: 0, width: 10, height: 10 }, { left: 9, top: 9, width: 5, height: 5 }), true);
  assert.equal(boxesOverlap(null, { left: 0, top: 0, width: 1, height: 1 }), false);
});

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

function block(startNeedle, endNeedle) {
  const start = html.indexOf(startNeedle);
  const end = html.indexOf(endNeedle, start);
  assert.ok(start > 0 && end > start, `${startNeedle} … ${endNeedle}`);
  return html.slice(start, end);
}

test("+ Passo, + Slide e + Cena são só ícone, com tooltip e aria-label", () => {
  const toolbar = block('class="canvas-toolbar"', 'id="canvas-titlebar"');
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
  assert.equal(/Este passo/i.test(toolbar), false);
});

test("o header não tem mais o ícone de relógio do Preview automático", () => {
  const header = block("<header", "</header>");
  assert.equal(header.includes("btn-watch-from"), false);
  assert.match(header, /id="btn-play-from"/);
  assert.match(header, /id="preview-panel"/);
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

test("barra de narração fora do painel com os controles de áudio", () => {
  const bar = block('id="narration-bar"', "</section>");
  for (const id of ["caption-player", "btn-generate-caption", "pro-badge-audio", "btn-upload-caption", "btn-clear-caption-audio", "prop-show-caption", "caption-audio-status"]) {
    assert.match(bar, new RegExp(`id="${id}"`), id);
  }
  const panel = block('id="props-panel"', "</aside>");
  assert.equal(panel.includes('id="caption-player"'), false);
  assert.match(panel, /id="prop-caption"/);
});

test("barra flutuante e título acima da imagem existem com Pro no Gerar textos", () => {
  const title = block('id="canvas-titlebar"', 'id="present-chrome"');
  assert.match(title, /id="canvas-step-title"[^>]*data-inline="title"/);
  assert.match(title, /id="pro-badge-copy-title"/);
  assert.match(title, /id="title-type"/);
  const ftb = block('id="float-toolbar"', 'id="ph-caption"');
  for (const id of ["ftb-side", "ftb-align", "ftb-simulate", "ftb-zoom", "ftb-hold", "ftb-more"]) {
    assert.match(ftb, new RegExp(`id="${id}"`), id);
  }
});

test("textos novos do layout existem em pt, es e en, sem falar em nuvem", () => {
  const keys = Object.keys(catalogs.pt).filter((k) =>
    /^(file|prefs|preview|panel|ftb|narrbar)\./.test(k) ||
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
    assert.equal(typeof catalogs.pt[key], "string", `index.html usa ${key}`);
  }
});
