// Formatação leve (**negrito**, *itálico*, ++sublinhado++, "- " lista): parser, render, strip, edição e fiação.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  activeFormats,
  hasRichFormatting,
  normalizeRichText,
  parseRichText,
  renderRichText,
  richTextHtml,
  richTextLength,
  stripRichText,
  toggleList,
  toggleWrap,
} from "./tour-schema/richText.js";
import { inlineRichTextBlock } from "../scripts/sync-rich-text.mjs";
import { applyFormatToText, shortcutFormat } from "./richTextEditor.js";
import { popoverBodyHtml } from "./htmlText.js";
import { stepImageAlt } from "./a11y.js";
import { parseCopyJson, buildStepContext, buildUserPrompt } from "./llm.js";
import { buildTranslateMessages } from "./tour-schema/translate.js";
import { applyAgentStepInput, endStepFromAgentInput } from "./tour-schema/agent.js";

const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");

/** DOM mínimo: só o que renderRichText pode usar. Sem innerHTML — se o render tentar, quebra. */
function fakeDoc() {
  const made = [];
  const node = (tag) => {
    const n = {
      tagName: tag.toUpperCase(),
      childNodes: [],
      className: "",
      get firstChild() {
        return this.childNodes[0] || null;
      },
      appendChild(c) {
        this.childNodes.push(c);
        return c;
      },
      removeChild(c) {
        this.childNodes.splice(this.childNodes.indexOf(c), 1);
        return c;
      },
    };
    Object.defineProperty(n, "innerHTML", {
      set() {
        throw new Error("innerHTML proibido");
      },
    });
    made.push(n.tagName);
    return n;
  };
  const doc = { createElement: node, createTextNode: (v) => ({ nodeType: 3, nodeValue: String(v) }) };
  return { doc, made };
}
function serialize(n) {
  if (n.nodeType === 3) return n.nodeValue;
  const kids = n.childNodes.map(serialize).join("");
  return n.tagName === "DIV" ? kids : `<${n.tagName.toLowerCase()}>${kids}</${n.tagName.toLowerCase()}>`;
}
function rendered(text) {
  const { doc, made } = fakeDoc();
  const root = doc.createElement("div");
  renderRichText(root, text, doc);
  return { html: serialize(root), made };
}

const PAYLOADS = [
  '<img src=x onerror="alert(1)">',
  "<script>alert(1)</script>",
  '"><svg onload=alert(1)>',
  '<a href="javascript:alert(1)">x</a>',
  "' onmouseover='alert(1)",
  "**<img src=x onerror=alert(1)>**",
  "- <script>alert(1)</script>\n- *<b onclick=alert(1)>x</b>*",
  "++<iframe src=javascript:alert(1)>++",
];

test("negrito, itálico, sublinhado e lista viram tags fixas", () => {
  assert.equal(richTextHtml("**a** *b* ++c++"), "<strong>a</strong> <em>b</em> <u>c</u>");
  assert.equal(richTextHtml("- um\n- dois"), '<ul class="gf-rt-list"><li>um</li><li>dois</li></ul>');
  assert.equal(richTextHtml("Antes\n- item\nDepois"), 'Antes<ul class="gf-rt-list"><li>item</li></ul>Depois');
  assert.equal(richTextHtml("  - recuado até 3 espaços"), '<ul class="gf-rt-list"><li>recuado até 3 espaços</li></ul>');
});

test("aninhamento", () => {
  assert.equal(richTextHtml("***ambos***"), "<strong><em>ambos</em></strong>");
  assert.equal(richTextHtml("*a **b** c*"), "<em>a <strong>b</strong> c</em>");
  assert.equal(richTextHtml("**a *b* c**"), "<strong>a <em>b</em> c</strong>");
  assert.equal(richTextHtml("*itálico **negrito***"), "<em>itálico <strong>negrito</strong></em>");
  assert.equal(richTextHtml("++**x** y++"), "<u><strong>x</strong> y</u>");
  assert.equal(richTextHtml("- **forte** e *leve*"), '<ul class="gf-rt-list"><li><strong>forte</strong> e <em>leve</em></li></ul>');
});

test("marcador sem par, asterisco solto e texto antigo ficam literais", () => {
  for (const s of [
    "*Imagens ilustrativas",
    "*Imagens ilustrativas. *Consulte condições",
    "5*10*2 = 100",
    "**não fecha",
    "fecha** sem abrir",
    "* lista com asterisco não é lista",
    "-10% de desconto",
    "C++ e C++",
    "a ** b ** c",
    "a * b * c",
    "++ ++",
    "****",
    "R$ 450 mil & condomínio 🙂",
  ]) {
    assert.equal(hasRichFormatting(s), false, s);
    assert.equal(stripRichText(s), s, s);
  }
  assert.equal(richTextHtml("*Imagens ilustrativas"), "*Imagens ilustrativas");
  // marcador não atravessa linha
  assert.equal(richTextHtml("**a\nb**"), "**a<br/>b**");
});

test("escape com barra mostra o marcador", () => {
  assert.equal(richTextHtml("\\*\\*literal\\*\\*"), "**literal**");
  assert.equal(richTextHtml("\\- não é item"), "- não é item");
  assert.equal(stripRichText("\\+\\+x\\+\\+"), "++x++");
  assert.equal(richTextHtml("C:\\pasta"), "C:\\pasta");
});

test("sem marcador fica igual ao balão antigo (escape + quebra de linha)", () => {
  for (const s of ["Clique em Salvar", "Linha 1\nLinha 2", "a\r\nb\rc", "a\n\nb", "Preço: R$ 450 mil & condomínio 🙂", ""]) {
    const old = String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/\r\n?/g, "\n").replace(/\n/g, "<br/>");
    assert.equal(richTextHtml(s), old, JSON.stringify(s));
    assert.equal(popoverBodyHtml(s), old);
  }
});

test("XSS: payloads ficam inertes no HTML do balão e no render em nós", () => {
  for (const p of PAYLOADS) {
    const html = richTextHtml(p);
    const tags = [...html.matchAll(/<\/?([a-z]+)/g)].map((m) => m[1]);
    for (const tag of tags) assert.ok(["strong", "em", "u", "ul", "li", "br"].includes(tag), `${tag} em ${html}`);
    assert.doesNotMatch(html.replace(/<\/?(strong|em|u|li|br\/?)>|<ul class="gf-rt-list">|<\/ul>/g, ""), /[<>"']/);
    const { made } = rendered(p);
    for (const tag of made) assert.ok(["DIV", "STRONG", "EM", "U", "UL", "LI", "BR"].includes(tag), tag);
  }
  assert.equal(rendered('**<img src=x onerror="alert(1)">**').html, '<strong><img src=x onerror="alert(1)"></strong>');
});

test("render em nós bate com o HTML", () => {
  assert.equal(rendered("Oi **você**\n- a\n- *b*\nfim").html, "Oi <strong>você</strong><ul><li>a</li><li><em>b</em></li></ul>fim");
  assert.equal(rendered("a\nb").html, "a<br></br>b");
  assert.equal(rendered("").html, "");
  assert.equal(rendered("- \n- x").html, "<ul><li>x</li></ul>");
});

test("strip: sem marcadores, para voz, legenda, IA, alt e contagem", () => {
  assert.equal(stripRichText("**Oi** *você* ++já++"), "Oi você já");
  assert.equal(stripRichText("Itens:\n- um\n- **dois**"), "Itens:\num\ndois");
  assert.equal(stripRichText("- um\n- dois", { bullet: "• " }), "• um\n• dois");
  assert.equal(stripRichText("Itens\n- um\n- dois", { sentences: true }), "Itens. um. dois");
  assert.equal(stripRichText("Só uma frase", { sentences: true }), "Só uma frase");
  assert.equal(richTextLength("**abc**"), 3);
  assert.equal(stripRichText(undefined), "");
});

test("parser aguenta texto grande e patológico rápido", () => {
  const nasty = "*a **b ++c ".repeat(400) + "\n" + "*".repeat(3000) + "\n" + "**x* ".repeat(500);
  const t0 = Date.now();
  parseRichText(nasty);
  richTextHtml(nasty);
  assert.ok(Date.now() - t0 < 1500, `levou ${Date.now() - t0} ms`);
});

test("normalizeRichText: IA/agente/colado → só o subconjunto", () => {
  assert.equal(normalizeRichText("<b>Oi</b> <em>x</em> <u>y</u>"), "**Oi** *x* ++y++");
  assert.equal(normalizeRichText("<ul><li>a</li><li>b</li></ul>"), "- a\n- b");
  assert.equal(normalizeRichText("* um\n• dois"), "- um\n- dois");
  assert.equal(normalizeRichText("## Título\ntexto"), "Título\ntexto");
  assert.equal(normalizeRichText("use <tab> e 3 < 4"), "use <tab> e 3 < 4");
  assert.equal(normalizeRichText("*Imagens ilustrativas"), "*Imagens ilustrativas");
});

test("barra: embrulha, desembrulha, cursor vazio e várias linhas", () => {
  const w = (v, s, e, m) => toggleWrap(v, s, e, m);
  assert.deepEqual(w("ola mundo", 4, 9, "**"), { value: "ola **mundo**", start: 4, end: 13 });
  assert.deepEqual(w("ola **mundo**", 6, 11, "**"), { value: "ola mundo", start: 4, end: 9 });
  assert.deepEqual(w("ola **mundo**", 4, 13, "**"), { value: "ola mundo", start: 4, end: 9 });
  assert.deepEqual(w("ola *mundo*", 5, 10, "*"), { value: "ola mundo", start: 4, end: 9 });
  assert.equal(w("ola **mundo**", 6, 11, "*").value, "ola ***mundo***");
  assert.equal(w("ola ***mundo***", 7, 12, "*").value, "ola **mundo**");
  assert.equal(w("ola ***mundo***", 7, 12, "**").value, "ola *mundo*");
  assert.deepEqual(w("ab", 1, 1, "++"), { value: "a++++b", start: 3, end: 3 });
  assert.equal(w("x mundo ", 2, 8, "*").value, "x *mundo* ");
  assert.equal(w("- a\n- b", 0, 7, "**").value, "- **a**\n- **b**");
  assert.deepEqual(toggleList("um\ndois", 0, 7), { value: "- um\n- dois", start: 0, end: 11 });
  assert.deepEqual(toggleList("- um\n- dois", 0, 11), { value: "um\ndois", start: 0, end: 7 });
  assert.equal(toggleList("a\nb", 3, 3).value, "a\n- b");
  assert.equal(toggleList("", 0, 0).value, "- ");
  assert.equal(applyFormatToText("x", 0, 1, "underline").value, "++x++");
  // o resultado da barra é sempre o que o parser lê
  assert.equal(richTextHtml(w("Veja isto", 5, 9, "**").value), "Veja <strong>isto</strong>");
});

test("estado dos botões (aria-pressed) no cursor", () => {
  assert.deepEqual(activeFormats("**ab** *c*", 3, 3), { bold: true, italic: false, underline: false, list: false });
  assert.deepEqual(activeFormats("**ab** *c*", 8, 8), { bold: false, italic: true, underline: false, list: false });
  assert.deepEqual(activeFormats("- ++x++", 5, 5), { bold: false, italic: false, underline: true, list: true });
});

test("atalhos: Ctrl/⌘+B, I, U e Ctrl/⌘+Shift+8", () => {
  const k = (o) => ({ ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, key: "", code: "", ...o });
  assert.equal(shortcutFormat(k({ ctrlKey: true, key: "b" }), false), "bold");
  assert.equal(shortcutFormat(k({ ctrlKey: true, key: "I" }), false), "italic");
  assert.equal(shortcutFormat(k({ metaKey: true, key: "u" }), true), "underline");
  assert.equal(shortcutFormat(k({ ctrlKey: true, shiftKey: true, key: "*", code: "Digit8" }), false), "list");
  assert.equal(shortcutFormat(k({ ctrlKey: true, key: "b" }), true), null);
  assert.equal(shortcutFormat(k({ key: "*" }), false), null);
  assert.equal(shortcutFormat(k({ ctrlKey: true, altKey: true, key: "b" }), false), null);
});

test("HTML offline: cópia inline idêntica ao módulo e mesmo resultado", () => {
  const mod = read("./tour-schema/richText.js");
  const src = read("./standalonePlayer.js");
  const block = inlineRichTextBlock(mod);
  assert.ok(src.includes(block), "rode node scripts/sync-rich-text.mjs");
  const gf = new Function(`${block}; return gfRichText;`)();
  for (const s of [...PAYLOADS, "**a** *b* ++c++\n- x\n- **y**", "*Imagens ilustrativas", "5*10*2"]) {
    assert.equal(gf.richTextHtml(s), richTextHtml(s));
  }
  assert.match(src, /gfRichText\.renderRichText\(els\.slideBody, step\.popover\?\.description \|\| ""\)/);
  assert.match(src, /description: gfRichText\.richTextHtml\(step\.popover\?\.description \|\| ""\)/);
  assert.doesNotMatch(src, /slideBody\.(innerHTML|textContent) = step\.popover/);
});

test("fiação: player, cartões inicial/final, editor e export usam o módulo", () => {
  const player = read("./player.js");
  assert.match(player, /renderRichText\(els\.slideBody, step\.popover\?\.description \|\| ""\)/);
  assert.match(player, /description: popoverBodyHtml\(step\.popover\?\.description \|\| ""\)/);
  assert.match(read("./htmlText.js"), /return richTextHtml\(text\);/);
  const view = read("./fixedStepsView.js");
  assert.equal((view.match(/append\(richBody\(bodyText\)\)/g) || []).length, 2);
  assert.doesNotMatch(view, /el\("p", "fixed-card-body"/);
  const editor = read("./editor.js");
  assert.match(editor, /createRichTextToolbar\(\{ isField: isRichField/);
  for (const id of ["prop-description", "fixed-start-body", "fixed-end-body"]) assert.ok(editor.includes(`el.id === "${id}"`), id);
  assert.match(editor, /el\.dataset\?\.inline === "description" && el\.isContentEditable/);
  assert.match(editor, /renderRichText\(el, value\)/);
  // título e narração continuam texto puro no palco
  assert.match(editor, /el\.dataset\.inline === "description" && hasRichFormatting\(value\)/);
  assert.match(read("./exportPack.js"), /stripRichText\(text \|\| "", \{ bullet: "• " \}\)/);
  assert.match(read("./exportPack.js"), /<div id="player-slide-body"><\/div>/);
  for (const f of ["../view.html", "../editor.html", "../api/lib/view-shell.cjs"]) assert.match(read(f), /<div id="canvas-slide-body"/, f);
});

test("alt, IA e tradução: sem marcadores onde é texto puro; tradução preserva", () => {
  assert.equal(stepImageAlt({ popover: { title: "Salvar", description: "Clique em **Salvar**\n- rápido" } }), "Salvar: Clique em Salvar. rápido");
  const ctx = buildStepContext([{ popover: { title: "A", description: "**Oi** *x*" } }, {}], 1);
  assert.equal(ctx[0].description, "Oi x");
  assert.match(buildUserPrompt({ draft: { description: "**x**" } }), /\*\*bold\*\*/);
  const parsed = parseCopyJson('{"title":"**T**","description":"Use <b>Salvar</b>\\n* um","narration":"Diga **isto**\\n- a","alt":"*Tela*"}');
  assert.deepEqual(parsed, { title: "T", description: "Use **Salvar**\n- um", narration: "Diga isto. a", alt: "Tela" });
  const sys = buildTranslateMessages({ items: [{ id: "a", max: 10, text: "**x**" }], source: "pt", target: "en" })[0].content;
  assert.match(sys, /Keep text formatting markers exactly/);
  assert.match(sys, /\+\+underline\+\+/);
});

test("agente (MCP/REST): text aceita marcadores e HTML vira marcador", () => {
  const r = applyAgentStepInput({ text: "<b>Salve</b> agora\n* item" });
  assert.equal(r.step?.popover?.description, "**Salve** agora\n- item");
  assert.equal(endStepFromAgentInput({ text: "Fale **já**\n• sem custo" }).step.body, "Fale **já**\n- sem custo");
});
