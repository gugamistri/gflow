import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  GALLERY_CAPTION_MAX,
  clampGalleryPan,
  createGallery,
  galleryCaption,
  gallerySections,
  gallerySlideKind,
  galleryStep,
  sectionIndexAt,
  zoomAt,
} from "./gallery.js";
import { renderRichText, stripRichText } from "./tour-schema/richText.js";
import { inlineGalleryBlock, withGalleryBlock, BEGIN, END } from "../scripts/sync-gallery.mjs";
import { applyPlaybackMode, bindPlaybackModeControls, paintPlaybackMode } from "./playbackModeEditor.js";
import { catalogs, standaloneMessages } from "./i18n.js";

const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");

// ---- DOM mínimo: o que js/gallery.js usa. innerHTML só aceita os SVG fixos do próprio arquivo. ----
const htmlWrites = [];
function matches(n, sel) {
  return sel.split(",").some((part) => {
    const s = part.trim();
    const m = s.match(/^([a-z]+)?((?:\.[\w-]+)*)((?:\[[\w-]+(?:="[^"]*")?\])*)(:not\(\[([\w-]+)\]\))?$/);
    if (!m) throw new Error(`seletor não suportado no teste: ${s}`);
    const [, tag, classes, attrs, , notAttr] = m;
    if (tag && n.tagName !== tag.toUpperCase()) return false;
    for (const c of (classes || "").split(".").filter(Boolean)) if (!n.classList.contains(c)) return false;
    for (const a of (attrs || "").match(/\[[^\]]+\]/g) || []) {
      const [, k, v] = a.match(/\[([\w-]+)(?:="([^"]*)")?\]/);
      const got = n.getAttribute(k);
      if (got == null || (v != null && got !== v)) return false;
    }
    if (notAttr && n.getAttribute(notAttr) != null) return false;
    return true;
  });
}
function fakeDoc() {
  const listeners = [];
  const mk = (tag) => {
    const attrs = new Map();
    const classes = new Set();
    const on = {};
    const n = {
      nodeType: 1,
      tagName: tag.toUpperCase(),
      childNodes: [],
      parentElement: null,
      dataset: new Proxy(
        {},
        {
          get: (_, k) => attrs.get(`data-${String(k).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`),
          set: (_, k, v) => (attrs.set(`data-${String(k).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, String(v)), true),
          deleteProperty: (_, k) => (attrs.delete(`data-${String(k).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`), true),
        }
      ),
      style: {},
      offsetWidth: 0,
      offsetParent: null,
      disabled: false,
      title: "",
      alt: "",
      classList: {
        add: (...c) => c.forEach((x) => classes.add(x)),
        remove: (...c) => c.forEach((x) => classes.delete(x)),
        toggle: (c, f) => ((f ?? !classes.has(c)) ? (classes.add(c), true) : (classes.delete(c), false)),
        contains: (c) => classes.has(c),
      },
      get className() {
        return [...classes].join(" ");
      },
      set className(v) {
        classes.clear();
        String(v).split(/\s+/).filter(Boolean).forEach((c) => classes.add(c));
      },
      get hidden() {
        return attrs.has("hidden");
      },
      set hidden(v) {
        if (v) attrs.set("hidden", "");
        else attrs.delete("hidden");
      },
      get src() {
        return attrs.get("src") ?? "";
      },
      set src(v) {
        attrs.set("src", String(v));
      },
      get href() {
        return attrs.get("href") ?? "";
      },
      set href(v) {
        attrs.set("href", String(v));
      },
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
      removeAttribute: (k) => attrs.delete(k),
      get children() {
        return this.childNodes.filter((c) => c.nodeType === 1);
      },
      get childElementCount() {
        return this.children.length;
      },
      get firstChild() {
        return this.childNodes[0] || null;
      },
      appendChild(c) {
        c.parentElement = this;
        this.childNodes.push(c);
        return c;
      },
      append(...cs) {
        cs.forEach((c) => {
          if (c.parentElement) c.parentElement.removeChild(c);
          this.appendChild(c);
        });
      },
      removeChild(c) {
        this.childNodes.splice(this.childNodes.indexOf(c), 1);
        c.parentElement = null;
        return c;
      },
      replaceChildren(...cs) {
        this.childNodes.forEach((c) => (c.parentElement = null));
        this.childNodes = [];
        this.append(...cs);
      },
      get textContent() {
        return this.childNodes.map((c) => (c.nodeType === 3 ? c.nodeValue : c.textContent)).join("");
      },
      set textContent(v) {
        this.replaceChildren();
        if (String(v)) this.appendChild({ nodeType: 3, nodeValue: String(v) });
      },
      set innerHTML(v) {
        htmlWrites.push(String(v));
        if (!/^<svg [^]*<\/svg>$/.test(String(v))) throw new Error(`innerHTML fora dos ícones: ${v}`);
        this.childNodes = [];
      },
      addEventListener: (type, fn) => ((on[type] ||= []).push(fn)),
      fire(type, extra = {}) {
        const e = { type, target: n, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}, ...extra };
        (on[type] || []).forEach((fn) => fn(e));
      },
      focus() {
        doc.activeElement = n;
      },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
      closest: () => null,
      querySelectorAll(sel) {
        const out = [];
        const walk = (x) => x.children.forEach((c) => (matches(c, sel) && out.push(c), walk(c)));
        walk(this);
        return out;
      },
      querySelector(sel) {
        return this.querySelectorAll(sel)[0] || null;
      },
      contains(x) {
        for (let p = x; p; p = p.parentElement) if (p === n) return true;
        return false;
      },
    };
    return n;
  };
  const doc = {
    createElement: mk,
    createTextNode: (v) => ({ nodeType: 3, nodeValue: String(v) }),
    activeElement: null,
    defaultView: null,
    addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture }),
    key(key, extra = {}) {
      const e = { type: "keydown", key, target: doc.body, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, stopImmediatePropagation() {}, ...extra };
      listeners.filter((l) => l.type === "keydown").forEach((l) => l.fn(e));
      return e;
    },
  };
  doc.body = mk("body");
  doc.documentElement = mk("html");
  return doc;
}

function text(n) {
  return n?.textContent ?? "";
}

const TOUR = {
  name: "Residencial Exemplo",
  sceneLabels: { 1: "Fachada", 2: "Plantas" },
  steps: [
    { id: "a", type: "slide", scene: 1, popover: { title: "Bem-vindo", description: "Tour com **fotos**\n- 2 quartos" } },
    { id: "b", scene: 1, image: "img/a.jpg", popover: { title: "Fachada", description: "Vista. *Imagens ilustrativas" } },
    { id: "c", scene: 2, image: "img/b.jpg", popover: { title: "Planta 2Q", description: "" } },
    { id: "d", scene: 2, image: "img/c.jpg", video: { kind: "youtube", id: "aqz-KE-bpKQ" }, popover: { title: "Vídeo", description: "" } },
  ],
};

function setup(demo = TOUR, extra = {}) {
  const doc = fakeDoc();
  const calls = { change: [], finish: 0, close: [], mount: [], teardown: 0, cta: [] };
  const t = (k, v = {}) => `${k}${Object.keys(v).length ? ` ${JSON.stringify(v)}` : ""}`;
  const g = createGallery({
    doc,
    t,
    richText: { render: (el, s) => renderRichText(el, s, doc), strip: stripRichText },
    imageSrc: (step) => step.image || "",
    altOf: (step) => step.popover?.title || "",
    videoOf: (step) => step.video || null,
    mountVideo: (host, step, index) => {
      calls.mount.push(index);
      return { teardown: () => (calls.teardown += 1) };
    },
    renderCta: (slot, index) => calls.cta.push(index),
    onChange: (i) => calls.change.push(i),
    onFinish: () => (calls.finish += 1),
    onClose: (r) => calls.close.push(r),
    ...extra,
  });
  return { doc, g, calls };
}
const q = (g, sel) => g.root.querySelector(sel);

test("legenda de 1 linha: título; sem título, o texto sem marcadores (cortado); Detalhes quando há mais", () => {
  assert.deepEqual(galleryCaption({ popover: { title: "Fachada", description: "Vista **linda**" } }, stripRichText), { caption: "Fachada", details: "Vista **linda**", hasDetails: true });
  assert.deepEqual(galleryCaption({ popover: { title: "Só título" } }, stripRichText), { caption: "Só título", details: "", hasDetails: false });
  const short = galleryCaption({ popover: { description: "Sala ampla" } }, stripRichText);
  assert.equal(short.caption, "Sala ampla");
  assert.equal(short.hasDetails, false);
  const rich = galleryCaption({ popover: { description: "Sala **ampla**" } }, stripRichText);
  assert.equal(rich.caption, "Sala ampla");
  assert.equal(rich.hasDetails, true, "a versão formatada fica nos Detalhes");
  const long = galleryCaption({ popover: { description: "palavra ".repeat(60) } }, stripRichText);
  assert.ok(long.caption.length <= GALLERY_CAPTION_MAX && long.caption.endsWith("…"));
  assert.equal(galleryCaption({ label: "Rótulo" }).caption, "Rótulo");
});

test("seções vêm das cenas com nome; 1 seção ou nenhuma com nome = sem chips", () => {
  assert.deepEqual(gallerySections(TOUR), [
    { scene: 1, label: "Fachada", start: 0, count: 2 },
    { scene: 2, label: "Plantas", start: 2, count: 2 },
  ]);
  assert.deepEqual(gallerySections({ steps: [{ scene: 1 }, { scene: 1 }] }), []);
  assert.deepEqual(gallerySections({ steps: [{ scene: 1 }, { scene: 2 }] }), [], "cenas sem nome não viram chips");
  const s = gallerySections(TOUR);
  assert.equal(sectionIndexAt(s, 0), 0);
  assert.equal(sectionIndexAt(s, 3), 1);
  assert.equal(sectionIndexAt([], 2), -1);
});

test("navegação e zoom: sem dar a volta; pan preso à borda; zoom no ponto", () => {
  assert.equal(galleryStep(0, 5, -1), 0);
  assert.equal(galleryStep(4, 5, 1), 4);
  assert.equal(galleryStep(2, 5, 1), 3);
  assert.equal(galleryStep(9, 5, 0), 4);
  assert.equal(galleryStep(1, 0, 1), 0);
  assert.deepEqual(clampGalleryPan({ scale: 1, x: 50, y: 50 }, { width: 100, height: 100 }), { scale: 1, x: 0, y: 0 });
  assert.deepEqual(clampGalleryPan({ scale: 2, x: 500, y: -500 }, { width: 100, height: 80 }), { scale: 2, x: 50, y: -40 });
  assert.equal(clampGalleryPan({ scale: 99 }, { width: 1, height: 1 }).scale, 4);
  const z = zoomAt({ scale: 1, x: 0, y: 0 }, 2, 20, 10, { width: 200, height: 200 });
  assert.deepEqual(z, { scale: 2, x: -20, y: -10 }, "o ponto tocado fica parado");
  assert.equal(gallerySlideKind({ type: "slide" }, true), "card");
  assert.equal(gallerySlideKind({}, true), "video");
  assert.equal(gallerySlideKind({}, false), "photo");
});

test("abre no passo pedido, conta 'N de M', anuncia e reporta cada foto (step_view)", () => {
  const { g, calls, doc } = setup();
  assert.equal(g.open(TOUR, { from: 1 }), true);
  assert.equal(g.root.hidden, false);
  assert.equal(doc.documentElement.classList.contains("gf-gallery-open"), true);
  assert.deepEqual(calls.change, [1]);
  assert.match(text(q(g, ".gf-gal-counter-text")), /gallery\.counter \{"n":2,"total":4\}/);
  assert.match(text(q(g, ".gf-gal-live")), /gallery\.announce .*"n":2.*"section":", Fachada".*"caption":"Fachada"/);
  assert.equal(q(g, ".gf-gal-photo").getAttribute("src"), "img/a.jpg");
  assert.equal(q(g, ".gf-gal-photo").alt, "Fachada");
  assert.equal(g.root.getAttribute("role"), "region");
  assert.equal(q(g, ".gf-gal-chip").getAttribute("aria-current"), "true");
  assert.equal(doc.activeElement, g.root, "o foco vai para a galeria");
  g.next();
  g.prev();
  g.go(3);
  assert.deepEqual(calls.change, [1, 2, 1, 3]);
  assert.equal(q(g, '.gf-gal-chip[aria-current="true"]').textContent, "Plantas");
  assert.deepEqual(calls.cta, [1, 2, 1, 3], "o botão fixo do WhatsApp é recalculado a cada foto");
});

test("teclado: ← → Home End; no fim, → não conclui mas o botão 'Concluir' sim", () => {
  const { g, calls, doc } = setup();
  g.open(TOUR);
  assert.equal(doc.key("ArrowRight").defaultPrevented, true);
  doc.key("End");
  assert.equal(g.index(), 3);
  doc.key("ArrowRight");
  assert.equal(calls.finish, 0, "→ no fim não sai sem querer");
  assert.match(q(g, ".gf-gal-next").getAttribute("aria-label"), /gallery\.finish/);
  doc.key("Home");
  assert.equal(g.index(), 0);
  assert.equal(q(g, ".gf-gal-prev").disabled, true);
  assert.equal(doc.key("ArrowLeft", { target: { tagName: "INPUT" } }).defaultPrevented, false, "campos de texto ficam com as setas");
  g.go(3);
  q(g, ".gf-gal-next").fire("click");
  assert.equal(calls.finish, 1);
  assert.equal(g.isOpen(), false);
  assert.equal(g.root.hidden, true);
});

test("Esc fecha a camada de cima (Detalhes, grade) antes de sair; sair avisa o motivo", () => {
  const { g, calls, doc } = setup();
  g.open(TOUR, { from: 1 });
  const btn = q(g, ".gf-gal-details-btn");
  assert.equal(btn.hidden, false);
  assert.equal(btn.getAttribute("aria-controls"), q(g, ".gf-gal-details").getAttribute("id"));
  btn.fire("click");
  assert.equal(btn.getAttribute("aria-expanded"), "true");
  assert.equal(q(g, ".gf-gal-details").hidden, false);
  doc.key("Escape");
  assert.equal(q(g, ".gf-gal-details").hidden, true);
  assert.equal(g.isOpen(), true);
  q(g, ".gf-gal-counter").fire("click");
  assert.equal(g.root.classList.contains("is-grid-open"), true);
  assert.equal(g.closeLayer(), true);
  assert.equal(g.root.classList.contains("is-grid-open"), false);
  assert.equal(g.closeLayer(), false, "nada aberto: a página decide (sair)");
  doc.key("Escape");
  assert.deepEqual(calls.close, ["esc"]);
  assert.equal(g.isOpen(), false);
});

test("miniaturas só baixam quando a grade/fileira aparece (celular não gasta dados)", () => {
  const { g } = setup();
  g.open(TOUR);
  const imgs = g.root.querySelectorAll("img[data-src]");
  assert.equal(imgs.length, 3, "slide de texto não tem miniatura de imagem");
  assert.ok(imgs.every((i) => !i.getAttribute("src") && i.getAttribute("loading") === "lazy"));
  q(g, ".gf-gal-counter").fire("click");
  assert.ok(g.root.querySelectorAll("img").filter((i) => i.parentElement?.classList.contains("gf-gal-thumb")).every((i) => i.getAttribute("src")));
  const thumbs = g.root.querySelectorAll(".gf-gal-thumb");
  assert.equal(thumbs.length, 4);
  assert.equal(thumbs[0].getAttribute("aria-current"), "true");
  thumbs[2].fire("click");
  assert.equal(g.index(), 2);
  assert.equal(g.root.classList.contains("is-grid-open"), false, "escolher fecha a grade");
});

test("slide de texto vira cartão; vídeo vira fachada (montada e desmontada ao trocar); sem fachada, link", () => {
  const { g, calls } = setup();
  g.open(TOUR);
  assert.equal(g.root.dataset.kind, "card");
  assert.equal(text(q(g, ".gf-gal-card-title")), "Bem-vindo");
  assert.equal(q(g, ".gf-gal-card-body").querySelector("strong")?.textContent, "fotos");
  assert.equal(q(g, ".gf-gal-zoom").hidden, true, "sem zoom no cartão");
  g.go(3);
  assert.equal(g.root.dataset.kind, "video");
  assert.deepEqual(calls.mount, [3]);
  assert.ok(q(g, ".gf-gal-videohost"));
  g.go(2);
  assert.equal(calls.teardown, 1, "trocar de foto para o vídeo");
  const off = setup(TOUR, { mountVideo: () => null, videoLink: () => ({ href: "https://www.youtube.com/watch?v=aqz-KE-bpKQ", label: "Abrir no YouTube" }) });
  off.g.open(TOUR, { from: 3 });
  const a = q(off.g, ".gf-gal-videolink");
  assert.equal(a.getAttribute("href"), "https://www.youtube.com/watch?v=aqz-KE-bpKQ");
  assert.equal(a.getAttribute("rel"), "noopener noreferrer");
});

test("tour de 1 foto: sem contador, setas nem chips", () => {
  const { g } = setup();
  g.open({ name: "Uma", steps: [{ image: "x.jpg", popover: { title: "Única" } }] });
  assert.equal(q(g, ".gf-gal-counter").hidden, true);
  assert.equal(q(g, ".gf-gal-prev").hidden, true);
  assert.equal(q(g, ".gf-gal-next").hidden, true);
  assert.equal(q(g, ".gf-gal-chips").hidden, true);
  assert.equal(g.root.classList.contains("is-single"), true);
});

test("#174: texto do tour nunca vira HTML (título, legenda, Detalhes, cartão, cenas, nome)", () => {
  const evil = '<img src=x onerror="alert(1)">';
  const demo = {
    name: `${evil} tour`,
    sceneLabels: { 1: `<svg onload=alert(1)>`, 2: "B" },
    steps: [
      { type: "slide", scene: 1, popover: { title: evil, description: `**${evil}**\n- <script>alert(2)</script>` } },
      { scene: 2, image: "a.jpg", popover: { title: `"><script>alert(3)</script>`, description: `- ${evil}` } },
    ],
  };
  htmlWrites.length = 0;
  const { g } = setup(demo);
  g.open(demo);
  g.next();
  q(g, ".gf-gal-details-btn").fire("click");
  q(g, ".gf-gal-counter").fire("click");
  assert.ok(htmlWrites.length > 0);
  for (const h of htmlWrites) {
    assert.doesNotMatch(h, /onerror|onload|script|alert/, "innerHTML só recebe os ícones fixos");
  }
  assert.ok(text(q(g, ".gf-gal-title")).includes("<img src=x"), "o nome fica como texto");
  assert.ok(text(q(g, ".gf-gal-details")).includes("<img src=x"), "Detalhes formatado, mas o HTML fica literal");
  assert.equal(g.root.querySelectorAll("script").length, 0);
  assert.equal(g.root.querySelectorAll("svg").length, 0, "nenhum <svg> veio do texto");
});

test("cópia offline (standalonePlayer.js) é idêntica à galeria e é usada no modo Galeria", () => {
  const block = inlineGalleryBlock(read("./gallery.js"));
  const player = read("./standalonePlayer.js");
  assert.ok(player.includes(block), "rode: node scripts/sync-gallery.mjs");
  assert.equal(withGalleryBlock(player, block), player);
  assert.ok(player.indexOf(BEGIN) > player.indexOf("/* </gf-rich-text> */"), "a galeria usa o gfRichText de cima");
  assert.ok(player.indexOf(END) > player.indexOf(BEGIN));
  assert.match(player, /demo\.playback && demo\.playback\.mode === "gallery"/);
  assert.match(player, /gfGallery\.createGallery\(/);
  assert.match(player, /render: \(el, text\) => gfRichText\.renderRichText\(el, text, document\)/);
  assert.throws(() => inlineGalleryBlock('import x from "y";\n'), /imports/);
  const msgs = standaloneMessages("pt");
  for (const k of ["gallery.counter", "gallery.next", "gallery.finish", "gallery.details", "gallery.close", "gallery.zoomIn"]) assert.ok(msgs[k] && msgs[k] !== k, k);
});

test("player: modo Galeria delega para a galeria (prévia, /p, /v, embed) e o guiado continua igual", () => {
  const player = read("./player.js");
  assert.match(player, /if \(isGalleryMode\(getDemo\(\)\)\) \{[\s\S]*?return gallery\.play\(\{ from \}\);/);
  assert.match(player, /gallery\.stop\(\);\s*return buildAndDrive\(from, opts\);/);
  assert.match(player, /zoomOwnsTouch: \(x, y\) => galleryActive\(\) \|\|/, "na Galeria tocar na foto nunca é 'clique fora'");
  assert.match(player, /closeDetails: \(\) => \(galleryActive\(\) \? gallery\.closeLayer\(\)/);
  const glue = read("./galleryPlayer.js");
  assert.match(glue, /lifecycle\.step\(\{ index, stepId: safeStepId\(step\)/, "cada foto = step_view no analytics");
  assert.match(glue, /lifecycle\.complete\(\);\s*ctx\.onRequestExit\?\.\(\{ reason: "complete" \}\)/, "Concluir leva ao cartão final");
  assert.match(glue, /stickyWhatsAppAction\(demo, index, vars\)/);
  assert.match(glue, /createVideoStage\(\{\s*id: GALLERY_VIDEO_ID/);
  assert.doesNotMatch(glue, /speakText|playNarrationClips|armAutoplay/, "Galeria sem voz nem avanço sozinho");
  assert.match(read("./viewApp.js"), /focusOnOpen: !isEmbed/);
  assert.match(read("./videoStage.js"), /const stageId = opts\.id \|\| VIDEO_STAGE_ID;/);
});

test("CSS: tela cheia, foco visível, alvos de 44px, retrato/deitado e movimento reduzido", () => {
  const css = read("../css/player.css");
  assert.match(css, /\.gf-gallery \{[\s\S]*?position: fixed;[\s\S]*?inset: 0;/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(css, /\.gf-gallery :focus-visible \{/);
  assert.match(css, /\.gf-gal-btn \{[\s\S]*?width: 44px;[\s\S]*?height: 44px;/);
  assert.match(css, /@media \(max-width: 720px\), \(max-height: 520px\) \{[\s\S]*?\.gf-gallery:not\(\.is-grid-open\) \.gf-gal-thumbs \{\s*display: none;/);
  assert.match(css, /@media \(max-height: 520px\) and \(orientation: landscape\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.gf-gal-slide\.is-entering/);
  assert.match(css, /\.gf-gal-stage \* \{\s*touch-action: none;/);
});

test("editor: 'Modo de exibição' em ⚙ e no menu do Preview; trocar grava playback.mode", () => {
  const html = read("../editor.html");
  assert.match(html, /<fieldset class="mode-picker" id="playback-mode">\s*<legend data-i18n="mode.label">Modo de exibição<\/legend>/);
  assert.ok(html.indexOf('id="playback-mode"') < html.indexOf('id="theme-panel"'), "primeira coisa do ⚙");
  assert.match(html, /role="menuitemradio" aria-checked="true" data-playback-mode="guided"/);
  assert.match(html, /role="menuitemradio" aria-checked="false" data-playback-mode="gallery"/);
  assert.match(read("./editor.js"), /bindPlaybackModeControls\(document, \{/);
  for (const loc of ["pt", "es", "en"]) {
    for (const k of ["mode.label", "mode.guided", "mode.gallery", "mode.guidedHint", "mode.galleryHint", "mode.galleryNote", "mode.changed", "gallery.counter", "gallery.announce", "gallery.showAll"]) {
      assert.ok(catalogs[loc][k], `${loc}: ${k}`);
    }
  }
  const demo = { playback: { defaultHoldSeconds: 6 } };
  assert.equal(applyPlaybackMode(demo, "gallery"), true);
  assert.deepEqual(demo.playback, { defaultHoldSeconds: 6, mode: "gallery" });
  assert.equal(applyPlaybackMode(demo, "gallery"), false);
  assert.equal(applyPlaybackMode(demo, "guided"), true);
  assert.deepEqual(demo.playback, { defaultHoldSeconds: 6 });

  // os dois controles mostram o mesmo valor e um muda o outro
  const doc = fakeDoc();
  const radios = ["guided", "gallery"].map((v) => {
    const r = doc.createElement("input");
    r.setAttribute("name", "playback-mode");
    r.value = v;
    doc.body.append(r);
    return r;
  });
  const items = ["guided", "gallery"].map((v) => {
    const b = doc.createElement("button");
    b.dataset.playbackMode = v;
    doc.body.append(b);
    return b;
  });
  doc.querySelectorAll = (sel) => doc.body.querySelectorAll(sel.replace('input[name="playback-mode"]', 'input[name="playback-mode"]'));
  doc.getElementById = () => null;
  const tour = { playback: {} };
  const changed = [];
  paintPlaybackMode(doc, tour);
  assert.deepEqual(radios.map((r) => r.checked), [true, false]);
  bindPlaybackModeControls(doc, { getDemo: () => tour, onChanged: (m) => changed.push(m) });
  items[1].fire("click");
  assert.equal(tour.playback.mode, "gallery");
  assert.deepEqual(radios.map((r) => r.checked), [false, true]);
  assert.deepEqual(items.map((b) => b.getAttribute("aria-checked")), ["false", "true"]);
  radios[0].checked = true;
  radios[0].fire("change");
  assert.equal(tour.playback.mode, undefined);
  assert.deepEqual(changed, ["gallery", "guided"]);
});
