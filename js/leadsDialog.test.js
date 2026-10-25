import assert from "node:assert/strict";
import test from "node:test";
import { CLOUD_GLOBAL_KEY } from "./cloudConfig.js";
import { csvDate, csvFileName, createLeadsDialog } from "./leadsDialog.js";

function fakePat() {
  return ["pa" + "t", "n" + "a1", "11111111", "2222", "3333", "4444", "555555555555"].join("-");
}

function node() {
  const listeners = {};
  const classes = new Set();
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
    setAttribute() {},
    getAttribute() { return null; },
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
    nodes,
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
