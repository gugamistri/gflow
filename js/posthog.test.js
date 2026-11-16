import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import {
  captureBody,
  cleanUrl,
  editorInitOptions,
  FUNNEL_EVENTS,
  POSTHOG_PRODUCT,
  readPosthogConfig,
  sanitizeProperties,
} from "./posthogConfig.js";
import { createPlayerPosthog, embedHostOf, GF_SESSION_KEY, readSessionId } from "./posthogPlayer.js";
import { analyticsAccountFromMe, createEditorPosthog, EDITOR_SDK_EVENTS, editorBeforeSend } from "./posthogEditor.js";

const require = createRequire(import.meta.url);
const { readPosthogEnv } = require("../api/lib/posthog-env.cjs");
const { renderViewPage } = require("../api/lib/view-shell.cjs");

// chave fictícia no formato phc_ (nunca a do projeto)
const KEY = "phc_test0000000000000000000000000000";
const HOST = "https://us.i.posthog.com";
const CONFIG = { key: KEY, host: HOST };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LEAD_REF = "0b5c6d1e-2f3a-4b5c-8d9e-0f1a2b3c4d5e";

const PII = ["Ana Silva", "ana@example.com", "+5511999998888", "(11) 99999-8888", "Quero uma demo"];

function assertNoPii(value, label) {
  const text = JSON.stringify(value);
  for (const needle of PII) assert.equal(text.includes(needle), false, `${label} contém ${needle}`);
  assert.equal(/[^\s"@]+@[^\s"@]+\.[a-z]{2,}/i.test(text), false, `${label} tem algo com cara de e-mail`);
  for (const key of ["email", "name", "nome", "phone", "telefone", "message", "consentText", "fields"]) {
    assert.equal(new RegExp(`"${key}"\\s*:`).test(text), false, `${label} tem a chave ${key}`);
  }
}

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    map,
  };
}

test("config: sem chave ou host válidos → null (nada inicializa)", () => {
  assert.deepEqual(readPosthogConfig(CONFIG), CONFIG);
  assert.deepEqual(readPosthogConfig({ key: KEY, host: `${HOST}/` }), CONFIG);
  for (const bad of [null, undefined, {}, { key: KEY }, { host: HOST }, { key: "abc", host: HOST }, { key: KEY, host: "http://us.i.posthog.com" }, { key: KEY, host: `${HOST}/x` }, { key: KEY, host: `${HOST}?a=1` }]) {
    assert.equal(readPosthogConfig(bad), null, JSON.stringify(bad));
  }
  assert.equal(readPosthogEnv({}), null);
  assert.equal(readPosthogEnv({ POSTHOG_KEY: KEY }), null);
  assert.equal(readPosthogEnv({ POSTHOG_HOST: HOST }), null);
  assert.equal(readPosthogEnv({ POSTHOG_KEY: "phc_replace_me_please", POSTHOG_HOST: HOST }), null);
  assert.deepEqual(readPosthogEnv({ POSTHOG_KEY: KEY, POSTHOG_HOST: HOST }), CONFIG);
});

test("sanitizeProperties tira nome, e-mail, telefone e formulário; URL sem query", () => {
  const out = sanitizeProperties({
    tour_id: "meu-tour",
    gf_lead_ref: LEAD_REF,
    destination: "leadpronto",
    email: "ana@example.com",
    $email: "ana@example.com",
    name: "Ana Silva",
    first_name: "Ana",
    phone: "+5511999998888",
    telefone: "(11) 99999-8888",
    message: "Quero uma demo",
    fields: { email: "ana@example.com" },
    note: "ana@example.com",
    $current_url: "https://guiaflow.pro/auth/verify?token=segredo#x",
    $referrer: "https://cliente.com/obrigado?email=ana@example.com",
    $set: { email: "ana@example.com", plan: "pro" },
    $elements: [{ tag_name: "button", $el_text: "ana@example.com", "attr__name": "Ana Silva" }],
    $set_once: { $initial_person_info: { r: "https://x.com/?q=ana", u: "https://guiaflow.pro/editor?pro=1&token=abc" } },
  });
  assert.deepEqual(out.$set_once, { $initial_person_info: { r: "https://x.com/", u: "https://guiaflow.pro/editor" } });
  assert.equal(out.tour_id, "meu-tour");
  assert.equal(out.gf_lead_ref, LEAD_REF);
  assert.equal(out.destination, "leadpronto");
  assert.equal(out.$current_url, "https://guiaflow.pro/auth/verify");
  assert.equal(out.$referrer, "https://cliente.com/obrigado");
  assert.deepEqual(out.$set, { plan: "pro" });
  assert.deepEqual(out.$elements, [{ tag_name: "button" }]);
  assertNoPii(out, "sanitize");
  assert.equal(cleanUrl("https://guiaflow.pro/p/x?lp=tok"), "https://guiaflow.pro/p/x");
  assert.equal(captureBody(CONFIG, { event: "tour_viewed", distinctId: "x" }).properties.product, POSTHOG_PRODUCT);
  assert.deepEqual(FUNNEL_EVENTS, ["tour_viewed", "tour_lead_captured"]);
});

test("player: sem config, com DNT/GPC ou em ?preview=1 não cria nada nem grava storage", () => {
  const storage = memoryStorage();
  const sent = [];
  const send = (b) => sent.push(b);
  assert.equal(createPlayerPosthog({ config: null, storage, send }), null);
  assert.equal(createPlayerPosthog({ config: { key: KEY }, storage, send }), null);
  assert.equal(createPlayerPosthog({ config: CONFIG, storage, send, privacy: { dnt: "1" } }), null);
  assert.equal(createPlayerPosthog({ config: CONFIG, storage, send, privacy: { gpc: true } }), null);
  assert.equal(createPlayerPosthog({ config: CONFIG, storage, send, search: "?preview=1" }), null);
  assert.equal(storage.map.size, 0);
  assert.equal(sent.length, 0);
});

test("player: tour_viewed uma vez por sessão, gf_session_id em sessionStorage, IP anônimo, sem perfil", () => {
  const storage = memoryStorage();
  const sent = [];
  const ph = createPlayerPosthog({
    config: CONFIG,
    storage,
    send: (b) => sent.push(b),
    embed: true,
    referrer: "https://cliente.com.br/precos?email=ana@example.com",
    currentUrl: "https://guiaflow.pro/p/meu-tour?embed=1&utm_source=x",
    now: () => new Date("2026-11-16T12:00:00Z"),
  });
  assert.ok(ph);
  assert.match(ph.sessionId, UUID_RE);
  assert.equal(storage.getItem(GF_SESSION_KEY), ph.sessionId);
  assert.equal(ph.tourViewed({ tourId: "meu-tour", workspaceId: "usr_1" }), true);
  assert.equal(ph.tourViewed({ tourId: "meu-tour", workspaceId: "usr_1" }), false);
  // outra aba da mesma sessão (mesmo storage): não repete
  const again = createPlayerPosthog({ config: CONFIG, storage, send: (b) => sent.push(b) });
  assert.equal(again.sessionId, ph.sessionId);
  assert.equal(again.tourViewed({ tourId: "meu-tour" }), false);
  assert.equal(sent.length, 1);
  const body = sent[0];
  assert.equal(body.api_key, KEY);
  assert.equal(body.event, "tour_viewed");
  assert.equal(body.distinct_id, ph.sessionId);
  assert.equal(body.timestamp, "2026-11-16T12:00:00.000Z");
  const p = body.properties;
  assert.equal(p.product, "guiaflow");
  assert.equal(p.tour_id, "meu-tour");
  assert.equal(p.workspace_id, "usr_1");
  assert.equal(p.embed_host, "cliente.com.br");
  assert.equal(p.gf_session_id, ph.sessionId);
  assert.equal(p.$current_url, "https://guiaflow.pro/p/meu-tour");
  assert.equal(p.$ip, "");
  assert.equal(p.$geoip_disable, true);
  assert.equal(p.$process_person_profile, false);
  assert.deepEqual(p.$groups, { workspace: "usr_1" });
  assertNoPii(body, "tour_viewed");
});

test("player: tour_lead_captured só com ids; nunca o conteúdo do formulário", () => {
  const sent = [];
  const ph = createPlayerPosthog({ config: CONFIG, storage: memoryStorage(), send: (b) => sent.push(b) });
  assert.equal(ph.leadCaptured({ tourId: "meu-tour", gfLeadRef: "ana@example.com" }), false);
  assert.equal(ph.leadCaptured({ tourId: "meu-tour", workspaceId: "usr_1", gfLeadRef: LEAD_REF, destination: "leadpronto", name: "Ana Silva", email: "ana@example.com" }), true);
  assert.equal(ph.leadCaptured({ tourId: "meu-tour", gfLeadRef: LEAD_REF, destination: "hubspot" }), true);
  assert.equal(sent.length, 2);
  const [a, b] = sent;
  assert.equal(a.event, "tour_lead_captured");
  assert.equal(a.properties.gf_lead_ref, LEAD_REF);
  assert.equal(a.properties.destination, "leadpronto");
  assert.equal(a.properties.capture_source, "player");
  assert.equal("embed_host" in a.properties, false);
  assert.equal(b.properties.destination, "outro");
  for (const body of sent) assertNoPii(body, "tour_lead_captured");
  assert.match(ph.newLeadRef(), UUID_RE);
});

test("player: embed_host só no embed e só o host", () => {
  assert.equal(embedHostOf({ embed: false, referrer: "https://a.com/x" }), null);
  assert.equal(embedHostOf({ embed: true, referrer: "https://www.a.com/x?y=1" }), "www.a.com");
  assert.equal(embedHostOf({ embed: true, ancestorOrigins: ["https://b.com"], referrer: "https://a.com" }), "b.com");
  assert.equal(embedHostOf({ embed: true, referrer: "" }), null);
  const storage = memoryStorage();
  storage.setItem(GF_SESSION_KEY, "lixo");
  assert.match(readSessionId(storage), UUID_RE);
});

function fakeSdk() {
  const calls = [];
  const sdk = {
    init: (key, options) => calls.push(["init", key, options]),
    register: (props) => calls.push(["register", props]),
    identify: (...args) => calls.push(["identify", ...args]),
    group: (...args) => calls.push(["group", ...args]),
    reset: () => calls.push(["reset"]),
    capture: (...args) => calls.push(["capture", ...args]),
  };
  return { sdk, calls };
}

test("editor: sem config (ou DNT/GPC) o SDK nem carrega", async () => {
  let loads = 0;
  const loadSdk = async () => {
    loads += 1;
    return { default: fakeSdk().sdk };
  };
  for (const raw of [null, {}, { key: KEY }, { key: "x", host: HOST }]) {
    const ph = createEditorPosthog({ fetchConfig: async () => raw, loadSdk });
    assert.equal(await ph.ready, false);
    ph.identify({ userId: "usr_1", workspaceId: "usr_1", plan: "pro", isDemo: false });
    ph.reset();
  }
  const failing = createEditorPosthog({ fetchConfig: async () => { throw new Error("offline"); }, loadSdk });
  assert.equal(await failing.ready, false);
  const dnt = createEditorPosthog({ fetchConfig: async () => CONFIG, loadSdk, privacy: { gpc: true } });
  assert.equal(await dnt.ready, false);
  assert.equal(loads, 0);
});

test("editor: init sem replay/pesquisas, autocapture mascarado; identify só com user_id e grupo workspace", async () => {
  const { sdk, calls } = fakeSdk();
  const ph = createEditorPosthog({ fetchConfig: async () => CONFIG, loadSdk: async () => ({ default: sdk }) });
  // identify antes do SDK pronto fica na fila
  ph.identify({ userId: "usr_1", workspaceId: "usr_1", plan: "pro", isDemo: false });
  ph.identify({ userId: "ana@example.com", workspaceId: "w", plan: "pro", isDemo: false });
  assert.equal(await ph.ready, true);
  const [init, key, options] = calls[0];
  assert.equal(init, "init");
  assert.equal(key, KEY);
  assert.equal(options.api_host, HOST);
  assert.equal(options.disable_session_recording, true);
  assert.equal(options.disable_surveys, true);
  assert.equal(options.disable_external_dependency_loading, true);
  assert.equal(options.advanced_disable_flags, true);
  assert.equal(options.autocapture, true);
  assert.equal(options.mask_all_text, true);
  assert.equal(options.mask_all_element_attributes, true);
  assert.equal(options.person_profiles, "identified_only");
  assert.equal(options.persistence, "localStorage");
  assert.ok(options.capture_pageview);
  assert.equal(typeof options.before_send, "function");
  assert.deepEqual(calls[1], ["register", { product: "guiaflow" }]);
  assert.deepEqual(calls[2], ["identify", "usr_1"]);
  assert.deepEqual(calls[3], ["group", "workspace", "usr_1", { plan: "pro", is_demo: false }]);
  assert.equal(calls.length, 4);
  // repetir o mesmo usuário não duplica; e-mail como id é recusado
  ph.identify({ userId: "usr_1", workspaceId: "usr_1", plan: "pro", isDemo: false });
  ph.identify({ userId: "ana@example.com", workspaceId: "usr_1", plan: "pro", isDemo: false });
  assert.equal(calls.length, 4);
  for (const call of calls) assertNoPii(call.filter((x) => typeof x !== "function" && !(x && typeof x === "object" && "before_send" in x)), `chamada ${call[0]}`);
  ph.reset();
  assert.deepEqual(calls.at(-1), ["reset"]);
});

test("editor before_send: só eventos liberados, sem PII em propriedades, $set ou grupo", () => {
  assert.equal(editorBeforeSend({ event: "step_viewed", properties: {} }), null);
  assert.equal(editorBeforeSend({ event: "$exception", properties: {} }), null);
  assert.equal(editorBeforeSend({ event: "$snapshot", properties: {} }), null);
  assert.equal(editorBeforeSend(null), null);
  const ev = editorBeforeSend({
    event: "$identify",
    properties: { distinct_id: "usr_1", $current_url: "https://guiaflow.pro/editor?checkout=ok&email=ana@example.com", email: "ana@example.com" },
    $set: { email: "ana@example.com", name: "Ana Silva" },
    $set_once: { $initial_referrer: "https://x.com/?q=1" },
  });
  assert.equal(ev.properties.$current_url, "https://guiaflow.pro/editor");
  assert.equal(ev.properties.product, "guiaflow");
  assert.deepEqual(ev.$set, {});
  assert.deepEqual(ev.$set_once, { $initial_referrer: "https://x.com/" });
  assertNoPii(ev, "$identify");
  const group = editorBeforeSend({ event: "$groupidentify", properties: { $group_type: "workspace", $group_key: "usr_1", $group_set: { plan: "pro", is_demo: false, email: "ana@example.com" } } });
  assert.deepEqual(group.properties.$group_set, { plan: "pro", is_demo: false });
  assertNoPii(group, "$groupidentify");
  const auto = editorBeforeSend({ event: "$autocapture", properties: { $el_text: "ana@example.com", $elements: [{ tag_name: "a", attr__href: "mailto:ana@example.com" }] } });
  assertNoPii(auto, "$autocapture");
  assert.deepEqual(EDITOR_SDK_EVENTS.includes("tour_viewed"), false);
  const opts = editorInitOptions(CONFIG);
  assert.equal(opts.disable_session_recording, true);
});

test("editor: analyticsAccountFromMe só lê ids e plano", () => {
  const me = { user: { id: "usr_9", email: "ana@example.com", plan: "pro" }, analytics: { userId: "usr_9", workspaceId: "usr_9", isDemo: true }, entitlements: { plan: "pro" } };
  const a = analyticsAccountFromMe(me);
  assert.deepEqual(a, { userId: "usr_9", workspaceId: "usr_9", plan: "pro", isDemo: true });
  assertNoPii(a, "conta");
  assert.equal(analyticsAccountFromMe({ user: { email: "ana@example.com" } }), null);
  assert.equal(analyticsAccountFromMe({ analytics: { userId: "ana@example.com" } }), null);
  assert.deepEqual(analyticsAccountFromMe({ user: { id: "usr_2" } }), { userId: "usr_2", workspaceId: "usr_2", plan: "none", isDemo: false });
});

test("shell do /p: config do PostHog só no link permanente que existe", () => {
  const on = renderViewPage({ id: "meu-tour", name: "T", origin: "https://guiaflow.pro", missing: false, kind: "permanent", posthog: CONFIG });
  assert.ok(on.includes(`"posthog":{"key":"${KEY}","host":"${HOST}"}`));
  for (const html of [
    renderViewPage({ id: "meu-tour", name: "T", origin: "https://guiaflow.pro", missing: false, kind: "permanent", posthog: null }),
    renderViewPage({ id: "meu-tour", name: null, origin: "https://guiaflow.pro", missing: true, kind: "permanent", posthog: CONFIG }),
    renderViewPage({ id: "abc", name: "T", origin: "https://guiaflow.pro", missing: false, kind: "temporary", posthog: CONFIG }),
  ]) {
    assert.equal(html.includes("posthog"), false);
  }
});

test("lib do PostHog vendida é a no-external (sem script externo) e o player não a carrega", () => {
  const view = readFileSync(new URL("./viewApp.js", import.meta.url), "utf8");
  assert.equal(/vendor\/posthog/.test(view), false);
  assert.equal(/\.identify\(/.test(view), false);
  const player = readFileSync(new URL("./posthogPlayer.js", import.meta.url), "utf8");
  assert.equal(/import\(|vendor\/posthog|localStorage|document\.cookie/.test(player.replace(/\/\*[\s\S]*?\*\//g, "")), false);
  const editor = readFileSync(new URL("./posthogEditor.js", import.meta.url), "utf8");
  assert.ok(editor.includes('import("../vendor/posthog/module.no-external.js")'));
  const vendored = readFileSync(new URL("../vendor/posthog/module.no-external.js", import.meta.url), "utf8");
  assert.ok(vendored.length > 100000);
  assert.equal(/^import\s/m.test(vendored), false);
});
