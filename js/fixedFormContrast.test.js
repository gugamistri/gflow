import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { THEME_PRESETS, contrastRatio, fixedFormPalette, readableOn } from "./themes.js";

test("readableOn mantém a cor quando já tem contraste e corrige quando não tem", () => {
  assert.equal(readableOn("#1a1a1a", "#ffffff", 4.5), "#1a1a1a");
  const fixed = readableOn("#a1a1aa", "#ffffff", 4.5);
  assert.ok(contrastRatio(fixed, "#ffffff") >= 4.5);
  const onDark = readableOn("#2a9d8f", "#303030", 4.5);
  assert.ok(contrastRatio(onDark, "#303030") >= 4.5);
});

test("campos do passo inicial ficam legíveis em todos os temas (texto, placeholder, rótulo, foco)", () => {
  const extremos = [
    { popoverBg: "#ffffff", text: "#f0f0f0", accent: "#ffee00", button: "#ffee00" },
    { popoverBg: "#111111", text: "#222222", accent: "#000080", button: "#222222" },
    { popoverBg: "#7a7a7a", text: "#808080", accent: "#7f7f7f", button: "#7a7a7a" },
  ];
  for (const theme of [...THEME_PRESETS.map((p) => p.colors), ...extremos]) {
    const pal = fixedFormPalette(theme);
    const bg = theme.popoverBg;
    assert.ok(contrastRatio(pal["--demo-field-ink"], pal["--demo-field-bg"]) >= 7, `texto ${bg}`);
    assert.ok(contrastRatio(pal["--demo-field-placeholder"], pal["--demo-field-bg"]) >= 4.5, `placeholder ${bg}`);
    assert.ok(contrastRatio(pal["--demo-form-ink"], bg) >= 4.5, `rótulo ${bg}`);
    assert.ok(contrastRatio(pal["--demo-form-link"], bg) >= 4.5, `pular ${bg}`);
    assert.ok(contrastRatio(pal["--demo-form-focus"], bg) >= 3, `foco ${bg}`);
    assert.ok(contrastRatio(pal["--demo-button-ink"], theme.button) >= 3, `botão ${bg}`);
  }
});

test("diálogos dos passos fixos: só o miolo rola e as ações ficam sempre visíveis", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  for (const id of ["modal-fixed-start", "modal-fixed-end"]) {
    const start = html.indexOf(`id="${id}"`);
    const dialog = html.slice(start, html.indexOf("</dialog>", start));
    const scroll = dialog.indexOf('class="fixed-dialog-scroll"');
    const actions = dialog.indexOf("studio-modal-actions fixed-actions");
    assert.ok(scroll > 0 && actions > scroll, id);
    assert.match(dialog, /<details class="fixed-more">/);
  }
});
