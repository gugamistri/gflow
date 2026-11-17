import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  createLandingPosthog,
  ctaFromElement,
  ctaKind,
  isLandingPath,
  LANDING_SDK_EVENTS,
  landingBeforeSend,
  landingInitOptions,
  sectionOf,
  signupFromCta,
  wireLanding,
} from "./posthogLanding.js";

// chave fictícia no formato phc_ (nunca a do projeto)
const KEY = "phc_test0000000000000000000000000000";
const HOST = "https://us.i.posthog.com";
const CONFIG = { key: KEY, host: HOST };
const ROOT = new URL("..", import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), "utf8");

/* DOM mínimo: o suficiente para closest(), atributos e eventos. */
function matchOne(el, sel) {
  const m = sel.trim().match(/^([a-z]+)?((?:\.[\w-]+)*)((?:\[[^\]]+\])*)$/i);
  if (!m) throw new Error(`seletor não suportado: ${sel}`);
  const [, tag, classes, attrs] = m;
  if (tag && el.tag !== tag) return false;
  for (const c of classes.split(".").filter(Boolean)) if (!String(el.className || "").split(/\s+/).includes(c)) return false;
  for (const a of attrs.match(/\[[^\]]+\]/g) || []) {
    const am = a.match(/^\[([\w-]+)(?:([\^*]?=)"([^"]*)")?\]$/);
    const v = el.getAttribute(am[1]);
    if (v == null) return false;
    if (am[2] === "^=" && !v.startsWith(am[3])) return false;
    if (am[2] === "*=" && !v.includes(am[3])) return false;
    if (am[2] === "=" && v !== am[3]) return false;
  }
  return true;
}
function el(tag, { attrs = {}, className = "", id = "", text = "", parent = null } = {}) {
  const node = {
    tag, className, id, textContent: text, parent,
    getAttribute: (k) => (k === "id" ? id || null : k in attrs ? attrs[k] : null),
    closest(selector) {
      for (let n = node; n; n = n.parent) if (selector.split(",").some((s) => matchOne(n, s))) return n;
      return null;
    },
  };
  return node;
}

test("landing: só nas páginas do site; editor, player e exemplos ficam de fora", () => {
  for (const p of ["/", "/en", "/es", "/ajuda", "/en/help", "/integracoes/leads", "/cortesia", "/privacidade", "/alternativa-getdemo", "/para-agencias"]) {
    assert.equal(isLandingPath(p), true, p);
  }
  for (const p of ["/editor", "/editor.html", "/p/abc-123", "/v/xyz", "/exemplos/guia", "/en/exemplos/galeria", "/auth/callback", "/view"]) {
    assert.equal(isLandingPath(p), false, p);
  }
});

test("landing: nada carrega no /editor nem no /p (o SDK nem é baixado)", async () => {
  let loads = 0;
  const loadSdk = async () => { loads += 1; return { default: { init() {}, register() {}, capture() {} } }; };
  for (const pathname of ["/editor", "/p/tour-1", "/v/tmp", "/exemplos/guia"]) {
    const ph = createLandingPosthog({ pathname, fetchConfig: async () => CONFIG, loadSdk });
    assert.equal(await ph.ready, false, pathname);
  }
  // sem config ou com GPC também não
  assert.equal(await createLandingPosthog({ pathname: "/", fetchConfig: async () => null, loadSdk }).ready, false);
  assert.equal(await createLandingPosthog({ pathname: "/", fetchConfig: async () => CONFIG, loadSdk, privacy: { gpc: true } }).ready, false);
  assert.equal(loads, 0);
});

test("landing: init com as opções da especificação e register só de product", async () => {
  const calls = [];
  const sdk = { init: (...a) => calls.push(["init", ...a]), register: (p) => calls.push(["register", p]), capture: (...a) => calls.push(["capture", ...a]) };
  const ph = createLandingPosthog({ pathname: "/", fetchConfig: async () => CONFIG, loadSdk: async () => ({ default: sdk }) });
  ph.capture("cta_click", { cta_id: "hero_start" }); // antes do SDK: fila
  assert.equal(await ph.ready, true);
  const [, key, o] = calls[0];
  assert.equal(key, KEY);
  assert.equal(o.api_host, HOST);
  assert.equal(o.capture_pageview, "history_change");
  assert.equal(o.capture_pageleave, true);
  assert.equal(o.mask_all_text, true);
  assert.equal(o.mask_all_element_attributes, true);
  assert.deepEqual(o.autocapture, { capture_copied_text: false });
  assert.equal(o.person_profiles, "identified_only");
  assert.equal(o.persistence, "localStorage");
  assert.equal(o.disable_session_recording, true);
  assert.equal(o.disable_external_dependency_loading, true);
  assert.equal(o.before_send, landingBeforeSend);
  // surface fica fora do register (persistido e lido pelo editor na mesma origem); entra pelo before_send
  assert.deepEqual(calls[1], ["register", { product: "guiaflow" }]);
  assert.deepEqual(calls[2], ["capture", "cta_click", { cta_id: "hero_start" }]);
  // eventos fora da lista não saem nem pela API do módulo
  ph.capture("landing_view", {});
  ph.capture("tour_viewed", {});
  assert.equal(calls.length, 3);
  assert.equal(landingInitOptions(CONFIG).api_host, HOST);
});

test("landing before_send: $geoip_disable, product e surface em todo evento; sem PII; fora da lista é descartado", () => {
  for (const event of LANDING_SDK_EVENTS) {
    const out = landingBeforeSend({ event, properties: { $current_url: "https://guiaflow.pro/?utm_source=x&email=ana@example.com", $geoip_disable: false } });
    assert.equal(out.properties.$geoip_disable, true, event);
    assert.equal(out.properties.product, "guiaflow", event);
    assert.equal(out.properties.surface, "landing", event);
    assert.equal(out.properties.$current_url, "https://guiaflow.pro/", event);
  }
  const ev = landingBeforeSend({ event: "$autocapture", properties: { email: "ana@example.com", $elements: [{ tag_name: "a", $el_text: "ana@example.com" }] }, $set: { name: "Ana" } });
  assert.equal(ev.properties.email, undefined);
  assert.deepEqual(ev.properties.$elements, [{ tag_name: "a" }]);
  assert.deepEqual(ev.$set, {});
  for (const event of ["landing_view", "$identify", "$exception", "tour_viewed", "$snapshot"]) assert.equal(landingBeforeSend({ event, properties: {} }), null, event);
});

test("landing: cta_click com cta_id por seção e destino; signup_started só no checkout Pro", () => {
  const header = el("header");
  const navBtn = el("a", { className: "btn btn-primary btn-sm", attrs: { href: "/editor" }, text: " Abrir editor ", parent: header });
  assert.deepEqual(ctaFromElement(navBtn), { cta_id: "nav_start", cta_text: "Abrir editor", section: "nav", destination_url: "https://guiaflow.pro/editor" });

  const hero = el("section", { className: "hero" });
  const heroBtn = el("a", { className: "btn btn-primary btn-lg", attrs: { href: "/editor" }, text: "Criar grátis", parent: hero });
  const span = el("span", { parent: heroBtn, text: "Criar grátis" });
  assert.equal(ctaFromElement(span).cta_id, "hero_start");

  const pricing = el("section", { className: "pricing", id: "precos" });
  const proBtn = el("a", { className: "btn btn-primary btn-block", attrs: { href: "/editor?pro=1" }, text: "Assinar Pro", parent: pricing });
  const pro = ctaFromElement(proBtn);
  assert.equal(pro.cta_id, "pricing_pro");
  assert.equal(pro.destination_url, "https://guiaflow.pro/editor");
  assert.deepEqual(signupFromCta(pro, "/editor?pro=1"), { method: "checkout", source_cta_id: "pricing_pro" });
  assert.equal(signupFromCta(ctaFromElement(heroBtn), "/editor"), null);

  const ext = el("a", { attrs: { href: "https://chromewebstore.google.com/detail/x" }, text: "Extensão", parent: el("section", { id: "como-funciona" }) });
  assert.equal(ctaFromElement(ext).cta_id, "how_extension");
  assert.equal(ctaFromElement(el("a", { attrs: { href: "#precos" }, parent: header })), null); // link de âncora do menu não é CTA
  assert.equal(ctaFromElement(el("a", { attrs: { href: "/editor", "data-cta-id": "custom_x" } })).cta_id, "custom_x");
  // nada dentro de ph-no-capture
  const form = el("form", { className: "ph-no-capture" });
  assert.equal(ctaFromElement(el("button", { className: "btn", parent: form, text: "Enviar" })), null);
  // texto com cara de dado pessoal não sai
  assert.equal(ctaFromElement(el("a", { className: "btn", attrs: { href: "/editor" }, text: "ana@example.com" })).cta_text, "");
  assert.equal(sectionOf(el("a", { parent: el("footer") })), "footer");
  assert.equal(ctaKind("/editor?novo=ajuda"), "assist");
  assert.equal(ctaKind("/exemplos/galeria?lang=en"), "gallery");
  assert.equal(ctaKind("/exemplos/guia"), "example");
});

test("landing: wireLanding manda cta_click, signup_started, pricing_viewed e demo_play", () => {
  const sent = [];
  const ph = { capture: (e, p) => sent.push([e, p]) };
  const listeners = {};
  const winListeners = {};
  let observerCb = null;
  const pricing = el("section", { className: "pricing", id: "precos" });
  const planPro = el("article", { className: "card plan plan-pro", parent: pricing });
  pricing.querySelector = (s) => (s === ".plan-pro" ? planPro : null);
  const iframe = el("iframe");
  iframe.tagName = "IFRAME";
  const frame = { contains: (n) => n === iframe, getAttribute: () => null };
  const doc = {
    activeElement: null,
    addEventListener: (type, fn) => { listeners[type] = fn; },
    querySelector: (s) => (s.includes("pricing") ? pricing : null),
    getElementById: (id) => (id === "demo-frame" ? frame : null),
  };
  class IO { constructor(cb) { observerCb = cb; } observe() {} disconnect() { observerCb = null; } }
  const timers = [];
  const win = { location: { origin: "https://guiaflow.pro" }, IntersectionObserver: IO, addEventListener: (t, fn) => { winListeners[t] = fn; } };
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => timers.push(fn);
  try {
    wireLanding(doc, win, ph);
    listeners.click({ target: el("a", { className: "btn", attrs: { href: "/editor?pro=1" }, text: "Assinar Pro", parent: pricing }) });
    listeners.submit({ target: { id: "courtesy-form" } });
    observerCb([{ isIntersecting: true }]);
    assert.equal(observerCb, null); // uma vez só
    doc.activeElement = iframe;
    winListeners.blur();
    winListeners.blur();
    timers.forEach((fn) => fn());
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
  assert.deepEqual(sent, [
    ["cta_click", { cta_id: "pricing_pro", cta_text: "Assinar Pro", section: "pricing", destination_url: "https://guiaflow.pro/editor" }],
    ["signup_started", { method: "checkout", source_cta_id: "pricing_pro" }],
    ["signup_started", { method: "cortesia_request", source_cta_id: "cortesia_form" }],
    ["pricing_viewed", { plan_highlighted: "pro" }],
    ["demo_play", { demo_id: "guia" }],
  ]);
});

test("landing: o script entra nas páginas do site e nunca no editor ou no player", () => {
  const TAG = /<script type="module" src="\/a\/\d+\/js\/landingAnalytics\.js"><\/script>/;
  const site = [
    "index.html", "en.html", "es.html", "ajuda.html", "ajuda/api.html", "integracoes.html", "integracoes/leads.html",
    "integracoes/leadpronto.html", "privacidade.html", "termos.html", "cortesia.html", "alternativa-getdemo.html", "para-agencias.html",
    "en/help.html", "en/integrations.html", "en/privacy.html", "en/terms.html", "es/ayuda.html", "es/privacidad.html", "es/terminos.html",
  ];
  for (const f of site) assert.match(read(f), TAG, f);
  for (const f of ["editor.html", "view.html", "auth/callback.html"]) assert.doesNotMatch(read(f), /landingAnalytics/, f);
  assert.doesNotMatch(read("api/lib/view-shell.cjs"), /landingAnalytics/);
  // formulário com dado pessoal fora do autocapture
  assert.match(read("cortesia.html"), /<form class="[^"]*\bph-no-capture\b[^"]*" id="courtesy-form"/);
});
