import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CLOUD_GLOBAL_KEY } from "./cloudConfig.js";
import {
  csvDate,
  csvFileName,
  createLeadsDialog,
  DELIVERY_ORDER,
  DELIVERY_TESTABLE,
  deliveryState,
} from "./leadsDialog.js";
import { catalogs, setLocale, SUPPORTED_LOCALES, t } from "./i18n.js";

const html = readFileSync(new URL("../editor.html", import.meta.url), "utf8");

function fakePat() {
  return ["pa" + "t", "n" + "a1", "11111111", "2222", "3333", "4444", "555555555555"].join("-");
}

function node() {
  const listeners = {};
  const classes = new Set();
  const attrs = {};
  return {
    hidden: false,
    value: "",
    textContent: "",
    disabled: false,
    checked: true,
    open: false,
    href: "",
    type: "password",
    classList: {
      add(...names) { for (const name of names) classes.add(name); },
      remove(...names) { for (const name of names) classes.delete(name); },
      toggle(name, on) {
        const next = on === undefined ? !classes.has(name) : Boolean(on);
        if (next) classes.add(name);
        else classes.delete(name);
        return next;
      },
      contains: (name) => classes.has(name),
    },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    click() { for (const fn of listeners.click || []) fn({ type: "click" }); },
    showModal() { this.open = true; },
    close() { this.open = false; },
    replaceChildren() {},
    append() {},
    focus() {},
    setAttribute(name, value) { attrs[name] = String(value); },
    getAttribute(name) { return Object.hasOwn(attrs, name) ? attrs[name] : null; },
  };
}

function installDom(nodes) {
  const prev = {
    document: globalThis.document,
    window: globalThis.window,
    fetch: globalThis.fetch,
    localStorage: globalThis.localStorage,
    location: globalThis.location,
    cloud: globalThis[CLOUD_GLOBAL_KEY],
  };
  globalThis.document = {
    documentElement: { lang: "pt-BR", getAttribute: () => null, setAttribute() {} },
    getElementById: (id) => nodes[id] || null,
    querySelector: (sel) => {
      const match = String(sel).match(/data-hubspot-field="([^"]+)"/);
      return match ? nodes[`field-${match[1]}`] || null : null;
    },
    querySelectorAll: () => [],
  };
  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
    confirm: () => false,
    open: () => ({ opener: null }),
  };
  globalThis.location = { assign() { throw new Error("não navegar"); } };
  const writes = [];
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { writes.push(String(value)); store.set(key, String(value)); },
    removeItem: (key) => store.delete(key),
  };
  globalThis[CLOUD_GLOBAL_KEY] = "https://cloud.test";
  return {
    writes,
    restore() {
      if (prev.document === undefined) delete globalThis.document;
      else globalThis.document = prev.document;
      if (prev.window === undefined) delete globalThis.window;
      else globalThis.window = prev.window;
      if (prev.fetch === undefined) delete globalThis.fetch;
      else globalThis.fetch = prev.fetch;
      if (prev.localStorage === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = prev.localStorage;
      if (prev.location === undefined) delete globalThis.location;
      else globalThis.location = prev.location;
      if (prev.cloud === undefined) delete globalThis[CLOUD_GLOBAL_KEY];
      else globalThis[CLOUD_GLOBAL_KEY] = prev.cloud;
    },
  };
}

function hubspotDom() {
  const ids = [
    "modal-results", "leads-meta", "leads-status", "leads-list",
    "btn-leads-csv", "btn-leads-refresh", "btn-results-close",
    "leads-hubspot-account", "leads-hubspot-enabled", "leads-hubspot-delivery", "leads-hubspot-status",
    "btn-leads-hubspot-connect", "btn-leads-hubspot-use-token", "leads-hubspot-token", "leads-hubspot-token-block",
    "btn-leads-hubspot-save", "btn-leads-hubspot-test", "btn-leads-hubspot-remove", "leads-hubspot-help",
  ];
  const nodes = Object.fromEntries(ids.map((id) => [id, node()]));
  nodes["btn-leads-hubspot-connect"].hidden = true;
  nodes["btn-leads-hubspot-use-token"].hidden = true;
  return { nodes, ...installDom(nodes) };
}

function json(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("CSV de contatos: data no fuso de Brasília e nome de arquivo seguro", () => {
  assert.equal(csvDate("2026-10-11T14:03:04.091Z"), "2026-10-11 11:03:04");
  assert.equal(csvDate(""), "");
  assert.equal(csvDate("x"), "");
  assert.equal(csvFileName("meu-tour-ab12", new Date("2026-10-11T12:00:00Z")), "contatos-meu-tour-ab12-2026-10-11.csv");
  assert.equal(csvFileName("../x?y", new Date("2026-10-11T12:00:00Z")), "contatos-xy-2026-10-11.csv");
});

test("HubSpot: PUT com token e a UI com oauthAvailable true e false", async () => {
  const token = fakePat();
  const dom = hubspotDom();
  const calls = [];
  let status = { oauthAvailable: false, hubspot: null };
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    const path = new URL(href).pathname;
    const method = init.method || "GET";
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ href, path, method, body });
    if (path.endsWith("/leads")) return json({ leads: [], title: "Tour" });
    if (path.endsWith("/hubspot") && method === "PUT") {
      const sent = String(body?.token || "");
      return json({
        oauthAvailable: status.oauthAvailable,
        hubspot: {
          connected: true,
          enabled: body?.enabled !== false,
          method: sent ? "private_app" : status.hubspot?.method || "",
          tokenLast4: sent ? sent.slice(-4) : status.hubspot?.tokenLast4 || "",
          oauthAvailable: status.oauthAvailable,
          hubDomain: "demo.hubspot.com",
        },
      });
    }
    if (path.endsWith("/hubspot")) return json(status);
    return json({});
  };
  try {
    const dialog = createLeadsDialog({ getSlug: () => "tour", toast() {} });
    const ui = dom.nodes;
    dialog.open();
    await flush();
    assert.equal(ui["btn-leads-hubspot-connect"].hidden, true);
    assert.equal(ui["btn-leads-hubspot-use-token"].hidden, true);
    assert.equal(ui["leads-hubspot-token-block"].hidden, false);
    assert.equal(ui["leads-hubspot-token"].type, "password");
    assert.equal(ui["leads-hubspot-account"].textContent.includes("HubSpot"), true);
    ui["btn-leads-hubspot-save"].click();
    await flush();
    assert.equal(calls.some((call) => call.method === "PUT"), false);

    ui["leads-hubspot-token"].value = "pat-nope";
    const before = calls.length;
    ui["btn-leads-hubspot-save"].click();
    await flush();
    assert.equal(calls.length, before);
    assert.equal(ui["leads-hubspot-token"].value, "pat-nope");
    assert.equal(ui["leads-hubspot-status"].textContent.includes(token), false);

    ui["leads-hubspot-token"].value = token;
    ui["btn-leads-hubspot-save"].click();
    await flush();
    const put = calls.filter((call) => call.method === "PUT" && call.path.endsWith("/hubspot"));
    assert.equal(put.length, 1);
    assert.equal(put[0].body.token === token, true);
    assert.equal(put[0].href.includes(token), false);
    assert.equal(Object.hasOwn(put[0].body, "accessToken"), false);
    assert.equal(ui["leads-hubspot-token"].value, "");
    assert.match(ui["leads-hubspot-account"].textContent, /Token ····5555/);
    assert.equal(ui["leads-hubspot-account"].textContent.includes(token), false);
    assert.equal(ui["leads-hubspot-status"].textContent.includes(token), false);
    assert.equal(ui["btn-leads-hubspot-connect"].hidden, true);
    assert.equal(dom.writes.some((value) => value.includes(token)), false);
    assert.equal([...dom.writes].join("\n").includes(token.slice(0, 12)), false);

    status = { oauthAvailable: true, hubspot: null };
    dialog.open();
    await flush();
    assert.equal(ui["btn-leads-hubspot-connect"].hidden, false);
    assert.equal(ui["btn-leads-hubspot-use-token"].hidden, false);
    assert.equal(ui["leads-hubspot-token-block"].hidden, true);
    assert.equal(ui["btn-leads-hubspot-connect"].textContent, "Connect with HubSpot");
    assert.equal(ui["btn-leads-hubspot-use-token"].textContent, "use a private app token");
    ui["btn-leads-hubspot-use-token"].click();
    assert.equal(ui["leads-hubspot-token-block"].hidden, false);
    assert.equal(ui["btn-leads-hubspot-connect"].hidden, false);

    status = {
      oauthAvailable: true,
      hubspot: {
        connected: true,
        method: "oauth",
        oauthAvailable: true,
        hubDomain: "demo.hubspot.com",
        tokenLast4: "abcd",
        enabled: true,
      },
    };
    dialog.open();
    await flush();
    assert.match(ui["leads-hubspot-account"].textContent, /OAuth/);
    assert.equal(ui["leads-hubspot-account"].textContent.includes("abcd"), false);
    assert.match(ui["leads-hubspot-account"].textContent, /demo\.hubspot\.com/);
    assert.equal(ui["btn-leads-hubspot-connect"].hidden, false);
    assert.equal(ui["btn-leads-hubspot-connect"].textContent, "Connect again");
    assert.equal(ui["leads-hubspot-token-block"].hidden, true);
    ui["btn-leads-hubspot-use-token"].click();
    ui["leads-hubspot-token"].value = token;
    ui["btn-leads-hubspot-save"].click();
    await flush();
    const replaced = calls.filter((call) => call.method === "PUT" && call.path.endsWith("/hubspot"));
    assert.equal(replaced.at(-1).body.token === token, true);
    assert.match(ui["leads-hubspot-account"].textContent, /Token ····5555/);
    assert.equal(ui["leads-hubspot-account"].textContent.includes("OAuth."), false);
    assert.equal(ui["leads-hubspot-token"].value, "");
    assert.equal(ui["btn-leads-hubspot-connect"].hidden, false);
    assert.equal(calls.every((call) => !call.href.includes(token)), true);
    assert.equal(dom.writes.every((value) => !value.includes(token)), true);
  } finally {
    dom.restore();
  }
});

/** DOM falso com todos os ids do editor.html real — a lista de cartões vem do markup. */
function deliveryDom() {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  const nodes = {};
  for (const id of ids) if (!nodes[id]) nodes[id] = node();
  nodes["delivery-list"].hidden = false;
  nodes["delivery-detail"].hidden = true;
  for (const id of DELIVERY_ORDER) nodes[`leads-${id}`].hidden = true;
  return { nodes, ...installDom(nodes) };
}

test("Envio automático: cartões fixos LeadPronto → Webhook → RD Station → HubSpot", () => {
  const start = html.indexOf('id="results-pane-delivery"');
  const end = html.indexOf('id="results-pane-analytics"');
  assert.ok(start > 0 && end > start, "painel de Envio automático encontrado");
  const pane = html.slice(start, end);

  const order = [...pane.matchAll(/data-delivery-card="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(order, ["lp", "webhook", "rd", "hubspot"]);
  assert.deepEqual(order, DELIVERY_ORDER);

  // LeadPronto em destaque no topo, mesmo sem conexão, com a etiqueta do fabricante.
  const lpCard = pane.slice(pane.indexOf('data-delivery-card="lp"'), pane.indexOf('data-delivery-card="webhook"'));
  assert.match(pane, /class="delivery-card is-featured" role="listitem" data-delivery-card="lp"/);
  assert.match(lpCard, /data-i18n="leads\.delivery\.maker"/);

  // Testar só nos destinos que têm rota de teste; LeadPronto é GET/PUT/DELETE.
  const testIds = [...pane.matchAll(/id="btn-delivery-test-([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...testIds].sort(), [...DELIVERY_TESTABLE].sort());
  assert.equal(testIds.includes("lp"), false);
  assert.equal(DELIVERY_TESTABLE.includes("lp"), false);

  // Cada cartão tem nível, estado e status; o detalhe tem Voltar e uma seção por destino.
  for (const id of DELIVERY_ORDER) {
    assert.match(pane, new RegExp(`id="delivery-level-${id}"`));
    assert.match(pane, new RegExp(`id="delivery-state-${id}"`));
    assert.match(pane, new RegExp(`id="delivery-status-${id}"`));
    assert.match(pane, new RegExp(`id="leads-${id}"[^>]*hidden`));
  }
  assert.match(pane, /id="delivery-detail"[^>]*hidden/);
  assert.match(pane, /id="btn-delivery-back"[\s\S]{0,200}data-i18n="leads\.delivery\.back"/);
  for (const key of ["stateOn", "stateOff", "stateFail", "levelAccount", "levelLink"]) {
    for (const locale of SUPPORTED_LOCALES) {
      assert.ok(String(catalogs[locale][`leads.delivery.${key}`]).trim(), `${locale} leads.delivery.${key}`);
    }
  }
});

test("Estado do cartão: falha vence conectado e desligado cobre o não configurado", () => {
  assert.equal(deliveryState({ configured: false, enabled: true }), "off");
  assert.equal(deliveryState({ configured: true, enabled: false }), "off");
  assert.equal(deliveryState(), "off");
  assert.equal(deliveryState({ configured: true, enabled: true }), "on");
  assert.equal(deliveryState({ configured: true, enabled: true, failures: 1 }), "fail");
  assert.equal(deliveryState({ configured: true, enabled: true, autoDisabled: true }), "fail");
  assert.equal(deliveryState({ configured: false, enabled: false, autoDisabled: true }), "fail");
});

test("Cartões: estado, nível, abrir detalhe, Voltar e Testar pelo cartão", async () => {
  const dom = deliveryDom();
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(String(url)).pathname;
    const method = init.method || "GET";
    calls.push({ path, method });
    if (path.endsWith("/leads")) return json({ leads: [], title: "" });
    if (path.endsWith("/webhook/test")) return json({ ok: true, httpStatus: 200, at: new Date().toISOString(), error: "" });
    if (path.endsWith("/webhook")) {
      return json({
        url: "https://hook.test/leads",
        enabled: true,
        hasSecret: true,
        secretLast4: "abcd",
        lastDelivery: null,
        consecutiveFailures: 0,
        autoDisabled: false,
      });
    }
    if (path === "/integrations/leadpronto") return json({ status: "disconnected" });
    if (path.endsWith("/shares/mine")) return json({ shares: [] });
    return json({}, 404);
  };
  try {
    const dialog = createLeadsDialog({ getSlug: () => "tour", toast() {} });
    const ui = dom.nodes;
    dialog.open();
    await flush();

    assert.equal(ui["delivery-list"].hidden, false);
    assert.equal(ui["delivery-detail"].hidden, true);
    for (const id of DELIVERY_ORDER) assert.equal(ui[`leads-${id}`].hidden, true);

    // LeadPronto: conexão da conta e desligado (ainda não conectado).
    assert.equal(ui["delivery-level-lp"].textContent, t("leads.delivery.levelAccount"));
    assert.equal(ui["delivery-state-lp"].textContent, t("leads.delivery.stateOff"));
    assert.equal(ui["delivery-state-lp"].classList.contains("is-off"), true);

    // Webhook: conexão deste link e conectado.
    assert.equal(ui["delivery-level-webhook"].textContent, t("leads.delivery.levelLink"));
    assert.equal(ui["delivery-state-webhook"].textContent, t("leads.delivery.stateOn"));
    assert.equal(ui["delivery-state-webhook"].classList.contains("is-on"), true);
    assert.equal(ui["delivery-state-hubspot"].textContent, t("leads.delivery.stateOff"));

    ui["btn-delivery-open-rd"].click();
    assert.equal(ui["delivery-list"].hidden, true);
    assert.equal(ui["delivery-detail"].hidden, false);
    assert.equal(ui["leads-rd"].hidden, false);
    for (const id of DELIVERY_ORDER.filter((item) => item !== "rd")) assert.equal(ui[`leads-${id}`].hidden, true);
    assert.equal(ui["btn-delivery-open-rd"].getAttribute("aria-expanded"), "true");
    assert.equal(ui["btn-delivery-open-hubspot"].getAttribute("aria-expanded"), "false");

    ui["btn-delivery-back"].click();
    assert.equal(ui["delivery-list"].hidden, false);
    assert.equal(ui["delivery-detail"].hidden, true);
    for (const id of DELIVERY_ORDER) assert.equal(ui[`leads-${id}`].hidden, true);
    assert.equal(ui["btn-delivery-open-rd"].getAttribute("aria-expanded"), "false");

    // Testar pelo cartão: mesma rota do botão da seção e a mensagem nos dois lugares.
    ui["btn-delivery-test-webhook"].click();
    await flush();
    assert.equal(calls.some((call) => call.method === "POST" && call.path.endsWith("/webhook/test")), true);
    const expected = t("leads.webhook.testOk", { status: "200" });
    assert.equal(ui["delivery-status-webhook"].textContent, expected);
    assert.equal(ui["leads-webhook-status"].textContent, expected);

    // Abrir um detalhe e reabrir o diálogo volta para a lista de cartões.
    ui["btn-delivery-open-hubspot"].click();
    assert.equal(ui["delivery-detail"].hidden, false);
    dialog.open();
    assert.equal(ui["delivery-list"].hidden, false);
    assert.equal(ui["delivery-detail"].hidden, true);
    for (const id of DELIVERY_ORDER) assert.equal(ui[`leads-${id}`].hidden, true);
    await flush();
  } finally {
    dom.restore();
  }
});

test("Webhook: subtítulo do cartão e bloco Receitas prontas com Make, n8n e Zapier", () => {
  const start = html.indexOf('id="results-pane-delivery"');
  const end = html.indexOf('id="results-pane-analytics"');
  const pane = html.slice(start, end);
  const card = pane.slice(pane.indexOf('data-delivery-card="webhook"'), pane.indexOf('data-delivery-card="rd"'));
  assert.match(card, /data-i18n="leads\.delivery\.webhookSub">para qualquer sistema · Make, n8n, Zapier</);
  assert.equal(catalogs.pt["leads.delivery.webhookSub"], "para qualquer sistema · Make, n8n, Zapier");

  const section = pane.slice(pane.indexOf('id="leads-webhook"'), pane.indexOf('id="leads-rd"'));
  const from = section.indexOf('id="leads-webhook-recipes"');
  assert.ok(from > 0 && from < section.indexOf('id="leads-webhook-url"'), "Receitas prontas fica antes do campo da URL");
  const recipes = section.slice(from, section.indexOf("</div>\n        </div>", from));
  assert.match(recipes, /data-i18n="leads\.webhook\.recipes\.title">Receitas prontas</);
  const tools = [...recipes.matchAll(/data-webhook-recipe="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(tools, ["make", "n8n", "zapier"]);
  for (const tool of tools) {
    assert.match(recipes, new RegExp(`id="leads-webhook-recipe-${tool}"[^>]*href="/integracoes/leads#${tool}" target="_blank" rel="noopener"`));
  }
  // Nada de segredo ou URL de webhook no bloco: só links para o guia.
  assert.doesNotMatch(recipes, /whsec_|<input/);

  for (const locale of SUPPORTED_LOCALES) {
    for (const key of ["leads.delivery.webhookSub", "leads.webhook.recipes.title", "leads.webhook.recipes.lead",
      "leads.webhook.recipes.make", "leads.webhook.recipes.n8n", "leads.webhook.recipes.zapier"]) {
      assert.ok(String(catalogs[locale][key] || "").trim(), `${locale} ${key}`);
    }
    assert.match(catalogs[locale]["leads.delivery.webhookSub"], /· Make, n8n, Zapier$/);
  }
});

test("Webhook: links das receitas seguem o idioma atual", async () => {
  const dom = deliveryDom();
  globalThis.fetch = async (url) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/leads")) return json({ leads: [], title: "" });
    if (path.endsWith("/webhook")) return json({ url: "https://hook.test/leads", enabled: true, hasSecret: true, secretLast4: "abcd" });
    if (path === "/integrations/leadpronto") return json({ status: "disconnected" });
    if (path.endsWith("/shares/mine")) return json({ shares: [] });
    return json({}, 404);
  };
  const expected = {
    pt: "/integracoes/leads",
    en: "/en/integrations/leads",
    es: "/es/integraciones/leads",
  };
  try {
    for (const locale of SUPPORTED_LOCALES) {
      setLocale(locale, { persist: false });
      const dialog = createLeadsDialog({ getSlug: () => "tour", toast() {} });
      dialog.open();
      await flush();
      for (const tool of ["make", "n8n", "zapier"]) {
        const href = dom.nodes[`leads-webhook-recipe-${tool}`].href;
        assert.equal(href, `${expected[locale]}#${tool}`, `${locale} ${tool}`);
        assert.doesNotMatch(href, /hook\.test|whsec_/);
      }
    }
  } finally {
    setLocale("pt", { persist: false });
    dom.restore();
  }
});
