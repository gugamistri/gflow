import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { catalogs } from "./i18n.js";
import {
  CAPTURE_TABS,
  captureSaveKind,
  captureTabForShortcut,
  createFixedStepsEditor,
  nextCaptureTab,
} from "./fixedStepsEditor.js";

test("abas da captura: setas, Home e End", () => {
  assert.deepEqual(CAPTURE_TABS, ["form", "fields", "end", "consent"]);
  assert.equal(nextCaptureTab("form", "ArrowRight"), "fields");
  assert.equal(nextCaptureTab("fields", "ArrowDown"), "end");
  assert.equal(nextCaptureTab("consent", "ArrowRight"), "form");
  assert.equal(nextCaptureTab("form", "ArrowLeft"), "consent");
  assert.equal(nextCaptureTab("end", "ArrowUp"), "fields");
  assert.equal(nextCaptureTab("fields", "Home"), "form");
  assert.equal(nextCaptureTab("fields", "End"), "consent");
  assert.equal(nextCaptureTab("form", "Enter"), "form");
});

test("atalhos 📌 e o botão Captura abrem a aba certa", () => {
  assert.equal(captureTabForShortcut("start"), "form");
  assert.equal(captureTabForShortcut("end"), "end");
  assert.equal(captureTabForShortcut("fields"), "fields");
  assert.equal(captureTabForShortcut("consent"), "consent");
  assert.equal(captureTabForShortcut("capture"), "form");
  assert.equal(captureSaveKind(true, true), "both");
  assert.equal(captureSaveKind(true, false), "start");
  assert.equal(captureSaveKind(false, true), "end");
  assert.equal(captureSaveKind(false, false), "");
});

test("Captura fica antes de Resultados e Compartilhar, com abas acessíveis", () => {
  const html = readFileSync(new URL("../editor.html", import.meta.url), "utf8");
  const editor = readFileSync(new URL("./editor.js", import.meta.url), "utf8");
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  assert.ok(html.indexOf('id="btn-capture"') < html.indexOf('class="export-panel"'));
  assert.ok(html.indexOf('id="btn-capture"') < html.indexOf('id="btn-results"'));
  assert.match(html, /id="btn-capture"[^>]*aria-controls="modal-capture"/);
  const dialog = html.slice(html.indexOf('id="modal-capture"'), html.indexOf("</dialog>", html.indexOf('id="modal-capture"')));
  assert.match(dialog, /role="tablist"/);
  for (const [tab, pane] of [
    ["tab-capture-form", "pane-capture-form"],
    ["tab-capture-fields", "pane-capture-fields"],
    ["tab-capture-end", "pane-capture-end"],
    ["tab-capture-consent", "pane-capture-consent"],
  ]) {
    assert.match(dialog, new RegExp(`id="${tab}"[^>]*role="tab"|role="tab"[^>]*id="${tab}"`));
    assert.match(dialog, new RegExp(`id="${pane}"[^>]*role="tabpanel"|role="tabpanel"[^>]*id="${pane}"`));
    assert.match(dialog, new RegExp(`aria-controls="${pane}"`));
  }
  assert.match(dialog, /id="tab-capture-form"[^>]*aria-selected="true"/);
  assert.match(dialog, /id="tab-capture-fields"[^>]*aria-selected="false"[^>]*tabindex="-1"/);
  const formPane = dialog.slice(dialog.indexOf('id="pane-capture-form"'), dialog.indexOf('id="pane-capture-fields"'));
  const fieldsPane = dialog.slice(dialog.indexOf('id="pane-capture-fields"'), dialog.indexOf('id="pane-capture-end"'));
  const endPane = dialog.slice(dialog.indexOf('id="pane-capture-end"'), dialog.indexOf('id="pane-capture-consent"'));
  const consentPane = dialog.slice(dialog.indexOf('id="pane-capture-consent"'));
  assert.ok(formPane.includes('id="fixed-start-enabled"'));
  assert.ok(!formPane.includes('id="fixed-start-fields"'));
  assert.ok(!formPane.includes('id="fixed-start-consent"'));
  assert.ok(fieldsPane.includes('id="fixed-start-fields"'));
  assert.ok(endPane.includes('id="fixed-end-wa"') && endPane.includes('id="fixed-end-contact"') && endPane.includes('id="fixed-end-replay"'));
  assert.ok(!endPane.includes('id="fixed-end-consent"'));
  assert.ok(consentPane.includes('id="fixed-start-consent"') && consentPane.includes('id="fixed-end-consent"'));
  for (const pane of [formPane, fieldsPane, endPane, consentPane]) {
    assert.match(pane, /class="fixed-grid"/);
    assert.match(pane, /class="fixed-preview"/);
  }
  assert.match(dialog.slice(dialog.indexOf('id="tab-capture-form"'), dialog.indexOf('id="tab-capture-fields"')), /class="pro-badge"/);
  assert.match(dialog.slice(dialog.indexOf('id="tab-capture-fields"'), dialog.indexOf('id="tab-capture-end"')), /class="pro-badge"/);
  assert.match(dialog, /id="fixed-end-mode-form-wrap"[\s\S]*class="pro-badge"/);
  assert.equal(/campo personalizado|custom field/i.test(dialog), false);
  assert.match(editor, /onOpenFixedStep\?\.\(fixed\.dataset\.fixed\)/);
  assert.match(editor, /data-fixed="\$\{kind\}"/);
  const wired = app.slice(app.indexOf("const fixedStepsEditor"), app.indexOf("const leadsDialog"));
  assert.equal((wired.match(/onChange\(/g) || []).length, 1);
  assert.match(app, /btn-capture[\s\S]*openFixedStep\("capture"\)/);
});

test("textos da captura existem em pt, en e es", () => {
  for (const key of [
    "fixed.capture.button",
    "fixed.capture.tab.form",
    "fixed.capture.tab.fields",
    "fixed.capture.tab.end",
    "fixed.capture.tab.consent",
    "fixed.capture.saved",
  ]) {
    for (const loc of ["pt", "en", "es"]) assert.equal(typeof catalogs[loc][key], "string", `${loc} ${key}`);
  }
  assert.equal(/nstech/i.test(JSON.stringify(catalogs)), false);
});

test("prévia ao lado no desktop e abaixo no celular", () => {
  const css = readFileSync(new URL("../css/editor.css", import.meta.url), "utf8");
  assert.match(css, /\.fixed-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(0,\s*0\.82fr\)/);
  assert.match(css, /@media \(max-width:\s*720px\)\s*\{[^}]*\.fixed-grid\s*\{[^}]*grid-template-columns:\s*1fr/);
  assert.match(css, /\.capture-tablist\s*\{[^}]*flex-wrap:\s*wrap/);
});

class MiniEl {
  constructor(tag) {
    this.tagName = tag;
    this.childNodes = [];
    this.parentElement = null;
    this.attrs = {};
    this._data = {};
    this.listeners = {};
    this.hidden = false;
    this.checked = false;
    this.value = "";
    this.className = "";
    this.id = "";
    this.style = { setProperty() {} };
    this.classList = {
      toggle: (name, force) => {
        const has = this.className.split(/\s+/).includes(name);
        const on = force === undefined ? !has : Boolean(force);
        const parts = this.className.split(/\s+/).filter(Boolean).filter((part) => part !== name);
        if (on) parts.push(name);
        this.className = parts.join(" ");
        return on;
      },
      add: (name) => this.classList.toggle(name, true),
      remove: (name) => this.classList.toggle(name, false),
    };
  }

  get dataset() {
    return this._data;
  }

  get childElementCount() {
    return this.childNodes.length;
  }

  setAttribute(name, value) {
    this.attrs[name] = String(value);
    if (name.startsWith("data-")) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this._data[key] = String(value);
    }
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }

  removeAttribute(name) {
    delete this.attrs[name];
  }

  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }

  append(...nodes) {
    for (const node of nodes.flat()) {
      if (!node) continue;
      node.parentElement = this;
      this.childNodes.push(node);
    }
  }

  replaceChildren(...nodes) {
    for (const node of this.childNodes) node.parentElement = null;
    this.childNodes = [];
    this.append(...nodes);
  }

  querySelectorAll(sel) {
    const out = [];
    for (const node of this.childNodes) {
      if (matches(node, sel)) out.push(node);
      out.push(...node.querySelectorAll(sel));
    }
    return out;
  }

  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null;
  }

  closest(sel) {
    let node = this;
    while (node) {
      if (matches(node, sel)) return node;
      node = node.parentElement;
    }
    return null;
  }

  contains(node) {
    if (node === this) return true;
    return this.childNodes.some((child) => child.contains?.(node));
  }

  focus() {
    this.focused = true;
  }

  showModal() {
    this.open = true;
  }

  close() {
    this.open = false;
  }

  getBoundingClientRect() {
    return { top: 0, bottom: 40, left: 0, right: 200, width: 200, height: 40 };
  }
}

function matches(el, sel) {
  let rest = sel;
  const checked = rest.endsWith(":checked");
  if (checked) rest = rest.slice(0, -":checked".length);
  const tag = rest.match(/^[a-z]+/)?.[0] || "";
  if (tag && el.tagName !== tag) return false;
  rest = tag ? rest.slice(tag.length) : rest;
  const attrs = [...rest.matchAll(/\[([^\]=]+)(?:=["']([^"']*)["'])?\]/g)];
  if (!tag && !attrs.length && !checked) return false;
  for (const [, key, value] of attrs) {
    const actual = el.getAttribute(key);
    if (value === undefined) {
      if (actual === null) return false;
    } else if (actual !== value) return false;
  }
  if (checked && !el.checked) return false;
  return true;
}

function el(tag, props = {}, kids = []) {
  const node = document.createElement(tag);
  if (props.id) node.id = props.id;
  if (props.className) node.className = props.className;
  for (const [key, value] of Object.entries(props.attrs || {})) node.setAttribute(key, value);
  if (props.type) node.type = props.type;
  if (props.checked) node.checked = true;
  if (props.hidden) node.hidden = true;
  if (props.value != null) node.value = props.value;
  node.append(...kids);
  return node;
}

function box(field, prop, checked = false) {
  return el("input", { attrs: { "data-field": field, "data-prop": prop }, type: "checkbox", checked });
}

function mountCaptureDom() {
  const nodes = [];
  const prev = globalThis.document;
  globalThis.document = {
    createElement: (tag) => {
      const node = new MiniEl(tag);
      nodes.push(node);
      return node;
    },
    createElementNS: () => {
      const node = new MiniEl("svg");
      nodes.push(node);
      return node;
    },
    getElementById: (id) => nodes.find((node) => node.id === id) || null,
  };
  const close = el("button", { attrs: { "data-fixed-close": "" } });
  const tabs = ["form", "fields", "end", "consent"].map((name, i) =>
    el("button", {
      id: `tab-capture-${name}`,
      attrs: {
        "data-capture-tab": name,
        "aria-selected": i === 0 ? "true" : "false",
        "aria-controls": `pane-capture-${name}`,
        role: "tab",
      },
    })
  );
  const tablist = el("div", { id: "capture-tabs" }, tabs);
  const fields = el("div", { id: "fixed-start-fields" }, [
    box("name", "show", true), box("name", "required", true),
    box("email", "show", true), box("email", "required", true),
    box("phone", "show"), box("phone", "required"),
  ]);
  const linkRadio = el("input", { attrs: { name: "fixed-end-mode", value: "link" }, type: "radio", value: "link", checked: true });
  const formRadio = el("input", { attrs: { name: "fixed-end-mode", value: "form" }, type: "radio", value: "form" });
  const dialog = el("dialog", { id: "modal-capture" }, [
    el("form", { id: "capture-form" }, [
      close,
      tablist,
      el("div", { id: "pane-capture-form" }, [
        el("input", { id: "fixed-start-enabled", type: "checkbox" }),
        el("div", { id: "fixed-start-config" }, [
          el("input", { id: "fixed-start-title" }),
          el("textarea", { id: "fixed-start-body" }),
          el("input", { id: "fixed-start-submit" }),
          el("input", { id: "fixed-start-skip", type: "checkbox", checked: true }),
          el("label", { id: "fixed-start-skip-label-wrap" }, [el("input", { id: "fixed-start-skip-label" })]),
        ]),
        el("div", { id: "fixed-start-preview" }),
      ]),
      el("div", { id: "pane-capture-fields", hidden: true }, [
        el("div", { id: "fixed-fields-config" }, [
          fields,
          el("p", { id: "fixed-start-fields-error", hidden: true }),
        ]),
        el("div", { id: "fixed-fields-preview" }),
      ]),
      el("div", { id: "pane-capture-end", hidden: true }, [
        el("input", { id: "fixed-end-enabled", type: "checkbox" }),
        el("div", { id: "fixed-end-config" }, [
          el("input", { id: "fixed-end-title" }),
          el("textarea", { id: "fixed-end-body" }),
          el("input", { id: "fixed-end-wa", type: "checkbox" }),
          el("div", { id: "fixed-end-wa-fields" }, [
            el("button", { id: "fixed-end-wa-cc" }),
            el("span", { id: "fixed-end-wa-cc-flag" }),
            el("span", { id: "fixed-end-wa-cc-dial" }),
            el("input", { id: "fixed-end-wa-phone" }),
            el("div", { id: "fixed-end-wa-cc-pop", hidden: true }, [
              el("input", { id: "fixed-end-wa-cc-search" }),
              el("ul", { id: "fixed-end-wa-cc-list" }),
              el("p", { id: "fixed-end-wa-cc-empty", hidden: true }),
            ]),
            el("p", { id: "fixed-end-wa-error", hidden: true }),
            el("textarea", { id: "fixed-end-wa-message" }),
            el("input", { id: "fixed-end-wa-label" }),
          ]),
          el("input", { id: "fixed-end-contact", type: "checkbox" }),
          el("div", { id: "fixed-end-contact-fields" }, [
            el("div", { id: "fixed-end-mode" }, [linkRadio, formRadio]),
            el("div", { id: "fixed-end-link-fields" }, [
              el("input", { id: "fixed-end-url" }),
              el("p", { id: "fixed-end-url-error", hidden: true }),
            ]),
            el("div", { id: "fixed-end-form-fields", hidden: true }),
            el("input", { id: "fixed-end-contact-label" }),
          ]),
          el("input", { id: "fixed-end-replay", type: "checkbox", checked: true }),
        ]),
        el("div", { id: "fixed-end-preview" }),
      ]),
      el("div", { id: "pane-capture-consent", hidden: true }, [
        el("textarea", { id: "fixed-start-consent" }),
        el("textarea", { id: "fixed-end-consent" }),
        el("div", { id: "fixed-consent-preview" }),
      ]),
    ]),
  ]);
  return {
    dialog,
    tablist,
    byId: (id) => nodes.find((node) => node.id === id),
    restore() {
      if (prev === undefined) delete globalThis.document;
      else globalThis.document = prev;
    },
  };
}

function fire(node, type, event) {
  for (const fn of node.listeners[type] || []) fn(event);
}

test("salvar grava um passo por edição e os atalhos selecionam a aba", () => {
  const dom = mountCaptureDom();
  const saved = [];
  const gates = [];
  const project = { name: "Tour" };
  const editor = createFixedStepsEditor({
    getProject: () => project,
    viewerIsPro: () => true,
    permanentShare: () => true,
    openFeatureGate: (feature) => gates.push(feature),
    onSaved: (kind) => saved.push(kind),
  });
  try {
    assert.equal(editor.open("capture"), true);
    assert.equal(dom.dialog.open, true);
    assert.equal(dom.byId("tab-capture-form").getAttribute("aria-selected"), "true");
    assert.equal(dom.byId("pane-capture-end").hidden, true);
    fire(dom.byId("capture-form"), "submit", { preventDefault() {} });
    assert.deepEqual(saved, []);
    assert.equal(project.startStep, undefined);
    assert.equal(project.endStep, undefined);

    fire(dom.tablist, "keydown", { key: "ArrowRight", preventDefault() {} });
    assert.equal(dom.byId("tab-capture-fields").getAttribute("aria-selected"), "true");
    assert.equal(dom.byId("tab-capture-form").getAttribute("aria-selected"), "false");
    assert.equal(dom.byId("tab-capture-fields").tabIndex, 0);
    assert.equal(dom.byId("pane-capture-fields").hidden, false);
    fire(dom.tablist, "keydown", { key: "End", preventDefault() {} });
    assert.equal(dom.byId("tab-capture-consent").getAttribute("aria-selected"), "true");
    fire(dom.tablist, "keydown", { key: "Home", preventDefault() {} });
    assert.equal(dom.byId("tab-capture-form").getAttribute("aria-selected"), "true");

    dom.dialog.close();
    editor.open("end");
    assert.equal(dom.byId("tab-capture-end").getAttribute("aria-selected"), "true");
    assert.equal(dom.byId("fixed-end-enabled").checked, true);
    fire(dom.byId("capture-form"), "submit", { preventDefault() {} });
    assert.deepEqual(saved, ["end"]);
    assert.equal(project.endStep.enabled, true);
    assert.equal(project.startStep, undefined);

    dom.dialog.close();
    editor.open("start");
    assert.equal(dom.byId("tab-capture-form").getAttribute("aria-selected"), "true");
    assert.equal(dom.byId("fixed-start-enabled").checked, true);
    dom.byId("fixed-end-title").value = "Até logo";
    fire(dom.byId("capture-form"), "submit", { preventDefault() {} });
    assert.deepEqual(saved, ["end", "both"]);
    assert.equal(project.startStep.enabled, true);
    assert.equal(project.endStep.title, "Até logo");
    assert.equal(gates.length, 0);
  } finally {
    dom.restore();
  }
});

test("formulário inicial Pro e Enviar contato como formulário abrem o upgrade", () => {
  const dom = mountCaptureDom();
  const gates = [];
  const project = { name: "Tour", endStep: { enabled: true, title: "Fim" } };
  const editor = createFixedStepsEditor({
    getProject: () => project,
    viewerIsPro: () => false,
    permanentShare: () => false,
    openFeatureGate: (feature) => gates.push(feature),
    onNeedsCloud: () => gates.push("cloud"),
    onSaved: () => gates.push("saved"),
  });
  try {
    editor.open("start");
    assert.equal(dom.byId("tab-capture-form").getAttribute("aria-selected"), "true");
    assert.equal(dom.byId("fixed-start-enabled").checked, false);
    const toggle = dom.byId("fixed-start-enabled");
    toggle.checked = true;
    fire(dom.byId("capture-form"), "change", { target: toggle, preventDefault() {} });
    assert.equal(toggle.checked, false);
    assert.equal(gates.at(-1), "leads");

    const formRadio = dom.byId("capture-form").querySelector('input[name="fixed-end-mode"][value="form"]');
    formRadio.checked = true;
    const linkRadio = dom.byId("capture-form").querySelectorAll('input[name="fixed-end-mode"]')[0];
    linkRadio.checked = false;
    fire(dom.byId("capture-form"), "change", { target: { name: "fixed-end-mode", value: "form" }, preventDefault() {} });
    assert.equal(formRadio.checked, false);
    assert.equal(gates.at(-1), "contactForm");
    assert.equal(project.startStep, undefined);
  } finally {
    dom.restore();
  }
});
