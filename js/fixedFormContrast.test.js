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
    assert.ok(contrastRatio(pal["--demo-form-focus"], bg) >= 3, `foco ${bg}`);
    assert.ok(contrastRatio(pal["--demo-field-border"], pal["--demo-field-bg"]) >= 1.5 || contrastRatio(pal["--demo-field-border"], bg) >= 3, `borda ${bg}`);
    assert.equal(pal["--demo-color-scheme"], contrastRatio(bg, "#000000") < contrastRatio(bg, "#ffffff") ? "dark" : "light", `scheme ${bg}`);
  }
});

const appCss = ["shell", "player", "editor"].map((n) => readFileSync(new URL(`../css/${n}.css`, import.meta.url), "utf8")).join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
function rule(selector) {
  for (const [, sel, body] of appCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (sel.split(",").map((s) => s.trim()).includes(selector)) return body;
  }
  assert.fail(`sem regra ${selector}`);
}
function prop(body, name) {
  const m = body.match(new RegExp(`(?:^|[;\\s])${name}\\s*:\\s*([^;]+);`));
  return m ? m[1].trim() : "";
}

test("passo inicial/final usam os mesmos tokens do balão do tour (fundo, texto, título, botão, raio, fonte)", () => {
  const theme = readFileSync(new URL("../css/theme.css", import.meta.url), "utf8");
  const bubble = theme.match(/\.driver-popover\.demo-popover \{([^}]*)\}/)[1];
  const next = theme.match(/\.driver-popover\.demo-popover \.driver-popover-next-btn \{([^}]*)\}/)[1];
  const card = rule(".fixed-card");
  assert.equal(prop(card, "background"), "var(--demo-popover-bg)");
  assert.equal(prop(card, "color"), "var(--demo-popover-text)");
  assert.equal(prop(card, "border-radius"), prop(bubble, "border-radius"));
  assert.equal(prop(card, "font-family"), prop(bubble, "font-family"));
  assert.equal(prop(rule(".fixed-card-title"), "color"), "var(--demo-popover-title)");
  for (const sel of [".fixed-card-body", ".fixed-card .fixed-field label", ".fixed-card .fixed-consent label", ".fixed-privacy"]) {
    assert.equal(prop(rule(sel), "color"), "var(--demo-popover-text)", sel);
  }
  const btn = rule(".fixed-card-btn");
  assert.equal(prop(btn, "background"), prop(next, "background").replace(/\s*!important/, ""));
  assert.equal(prop(btn, "color"), prop(next, "color").replace(/\s*!important/, ""));
  assert.equal(prop(btn, "border-radius"), prop(next, "border-radius"));
  assert.equal(prop(rule(".fixed-card-btn:hover"), "background"), "var(--demo-accent-dark)");
  assert.equal(prop(rule(".fixed-card-replay"), "color"), "var(--demo-popover-title)");
  assert.equal(prop(rule(".fixed-card-btn.fixed-card-contact"), "color"), "var(--demo-popover-title)");
  // Nada do cartão cai nas cores do app.
  const cardCss = [...appCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, sel]) => /\.fixed-(card|form|consent|field|privacy)/.test(sel) && !/fixed-card-wa/.test(sel));
  for (const [sel, , body] of cardCss.map(([a, b, c]) => [b.trim(), a, c])) {
    assert.equal(/(?:^|[;\s])(color|background(?:-color)?|border(?:-color)?)\s*:[^;]*var\(--ns-(?!button-text|font)/.test(body), false, sel);
    assert.equal(/--demo-(form-ink|form-link|button-ink)/.test(body), false, sel);
  }
});

test("caixa de consentimento: sem preenchimento escuro nativo; desmarcada como os campos, marcada no destaque", () => {
  const box = rule('.fixed-card .fixed-consent input[type="checkbox"]');
  assert.equal(prop(box, "appearance"), "none");
  assert.match(prop(box, "background"), /^var\(--demo-field-bg/);
  assert.match(prop(box, "border"), /var\(--demo-field-border/);
  assert.equal(prop(box, "accent-color"), "var(--demo-accent)");
  const checked = rule('.fixed-card .fixed-consent input[type="checkbox"]:checked');
  assert.equal(prop(checked, "background-color"), "var(--demo-accent)");
  assert.match(prop(checked, "background-image"), /^url\("data:image\/svg\+xml/);
  assert.match(prop(rule('.fixed-card .fixed-consent input[type="checkbox"]:focus-visible'), "outline"), /2px solid var\(--demo-form-focus\)/);
  assert.equal(prop(rule(".fixed-card"), "color-scheme"), "var(--demo-color-scheme, light)");
});

test("diálogo da captura: só o miolo rola e as ações ficam sempre visíveis", () => {
  const html = readFileSync(new URL("../editor.html", import.meta.url), "utf8");
  const start = html.indexOf('id="modal-capture"');
  const dialog = html.slice(start, html.indexOf("</dialog>", start));
  const scroll = dialog.indexOf('class="fixed-dialog-scroll"');
  const actions = dialog.indexOf("studio-modal-actions fixed-actions");
  assert.ok(scroll > 0 && actions > scroll);
  assert.match(dialog, /<details class="fixed-more">/);
  assert.equal(html.includes('id="modal-fixed-start"'), false);
  assert.equal(html.includes('id="modal-fixed-end"'), false);
});
