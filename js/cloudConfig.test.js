import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CLOUD_AUTH_MESSAGE_TYPE,
  CLOUD_FLAG_KEYS,
  CLOUD_GLOBAL_KEY,
  CLOUD_PENDING_PUBLISH_KEY,
  CLOUD_SESSION_KEY,
  PUBLISHED_CLOUD_BASE,
  callCloud,
  claimCloudPublishIntent,
  cloudAuthMessageOrigins,
  cloudFetch,
  cloudLoginRedirectUrl,
  cloudVerifyUrl,
  completeCloudAuthCallback,
  editorHomeFromCallback,
  endCloudSession,
  establishCloudSession,
  getCloudAccount,
  getCloudBaseUrl,
  getCloudFlags,
  installCloudHooks,
  isCloudEnabled,
  loginWithPassword,
  parseCloudAuthMessage,
  parseCloudLoginPaste,
  readAuthCallbackCode,
  readCloudAuthCallback,
  readCloudSession,
  requestMagicLink,
  stripCloudAuthCallback,
  writeCloudPublishIntent,
  writeCloudSession,
} from "./cloudConfig.js";

function flagsOff() {
  return {
    hostedAi: false,
    tts: false,
    permanentShare: false,
    branding: false,
    analytics: false,
  };
}

function flagsOn() {
  return {
    hostedAi: true,
    tts: true,
    permanentShare: true,
    branding: true,
    analytics: true,
  };
}

test("sem URL base as flags ficam desligadas e a chamada não sai da máquina", async () => {
  delete globalThis[CLOUD_GLOBAL_KEY];
  const fetchCalls = [];
  const prev = globalThis.fetch;
  globalThis.fetch = (...args) => {
    fetchCalls.push(args);
    throw new Error("network");
  };
  try {
    assert.equal(isCloudEnabled(), false);
    assert.equal(isCloudEnabled({ baseUrl: "" }), false);
    assert.equal(isCloudEnabled({ baseUrl: "   " }), false);
    assert.deepEqual(getCloudFlags(), flagsOff());
    assert.deepEqual(getCloudFlags({ baseUrl: "" }), flagsOff());
    assert.deepEqual(await callCloud("/v1/ai"), {
      ok: false,
      stub: true,
      reason: "cloud-not-configured",
    });
    assert.deepEqual(await cloudFetch("/v1/tts", { method: "POST" }, { baseUrl: "" }), {
      ok: false,
      stub: true,
      reason: "cloud-not-configured",
    });
    assert.deepEqual(fetchCalls, []);
  } finally {
    if (prev === undefined) delete globalThis.fetch;
    else globalThis.fetch = prev;
  }
});

test("com URL base as flags ficam disponíveis e callCloud continua stub", async () => {
  const fetchCalls = [];
  const prev = globalThis.fetch;
  globalThis.fetch = (...args) => {
    fetchCalls.push(args);
    throw new Error("network");
  };
  const env = { baseUrl: "https://cloud.example/api/" };
  try {
    assert.equal(isCloudEnabled(env), true);
    assert.equal(getCloudBaseUrl(env), "https://cloud.example/api");
    assert.deepEqual(getCloudFlags(env), flagsOn());
    assert.deepEqual(await callCloud("/v1/tts", { method: "POST" }, env), {
      ok: false,
      stub: true,
      reason: "not-implemented",
    });
    assert.deepEqual(fetchCalls, []);
  } finally {
    if (prev === undefined) delete globalThis.fetch;
    else globalThis.fetch = prev;
  }
});

test("cloudFetch com URL base chama a API e devolve o erro de rede", async () => {
  const fetchCalls = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url, init });
    throw new Error("offline");
  };
  const env = { baseUrl: "https://cloud.example/api/", accessToken: "" };
  try {
    const result = await cloudFetch("/shares", { method: "POST", body: "{}" }, env);
    assert.equal(result.ok, false);
    assert.equal(result.error, "network");
    assert.equal(result.stub, undefined);
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, "https://cloud.example/api/shares");
    assert.equal(fetchCalls[0].init.method, "POST");
    assert.equal(new Headers(fetchCalls[0].init.headers).get("authorization"), null);
  } finally {
    if (prev === undefined) delete globalThis.fetch;
    else globalThis.fetch = prev;
  }
});

test("sem URL as flags pedidas continuam falsas", () => {
  assert.deepEqual(getCloudFlags({ flags: { hostedAi: true, tts: true } }), flagsOff());
  assert.equal(isCloudEnabled({ baseUrl: "javascript:alert(1)" }), false);
  assert.equal(isCloudEnabled({ baseUrl: "not a url" }), false);
});

test("lê o global, ignora segredo e respeita override", () => {
  const env = {
    globalValue: {
      baseUrl: "https://user:secret@cloud.example/api?token=abc#x",
      flags: { hostedAi: false, extra: true },
      apiKey: "sk-nope",
    },
  };
  assert.equal(getCloudBaseUrl(env), "https://cloud.example/api");
  const flags = getCloudFlags(env);
  assert.equal(flags.hostedAi, false);
  assert.equal(flags.tts, true);
  assert.equal(flags.permanentShare, true);
  assert.equal(flags.branding, true);
  assert.equal(flags.analytics, true);
  assert.equal("apiKey" in flags, false);
  assert.equal("extra" in flags, false);
});

test("meta ganha do storage quando o global não tem URL", () => {
  assert.equal(
    getCloudBaseUrl({
      globalValue: "",
      metaContent: "https://meta.example/v1/",
      storageValue: "https://store.example",
    }),
    "https://meta.example/v1"
  );
  assert.equal(getCloudBaseUrl({ storageValue: "http://127.0.0.1:8787/" }), "http://127.0.0.1:8787");
  assert.equal(
    getCloudBaseUrl({
      globalValue: "https://global.example",
      metaContent: "https://meta.example",
    }),
    "https://global.example"
  );
});

test("hosts publicados resolvem a nuvem e o link mágico", () => {
  assert.equal(PUBLISHED_CLOUD_BASE, "https://app.guiaflow.pro");
  for (const hostname of ["guiaflow.pro", "guiaflow-seven.vercel.app", "GUIAFLOW.PRO."]) {
    assert.equal(getCloudBaseUrl({ hostname }), "https://app.guiaflow.pro");
    assert.equal(cloudVerifyUrl({ hostname }), "https://app.guiaflow.pro/auth/verify");
    assert.equal(isCloudEnabled({ hostname }), true);
  }
  assert.equal(getCloudBaseUrl({ hostname: "localhost" }), "");
  assert.equal(getCloudBaseUrl({ hostname: "127.0.0.1" }), "");
  assert.equal(isCloudEnabled({ hostname: "" }), false);
  assert.equal(getCloudBaseUrl({ baseUrl: "", hostname: "guiaflow.pro" }), "");
  assert.equal(
    getCloudBaseUrl({ hostname: "guiaflow.pro", globalValue: "https://override.example" }),
    "https://override.example"
  );
  const prev = globalThis[CLOUD_GLOBAL_KEY];
  globalThis[CLOUD_GLOBAL_KEY] = "https://app.guiaflow.pro";
  try {
    assert.equal(getCloudBaseUrl(), "https://app.guiaflow.pro");
    assert.equal(cloudVerifyUrl(), "https://app.guiaflow.pro/auth/verify");
  } finally {
    if (prev === undefined) delete globalThis[CLOUD_GLOBAL_KEY];
    else globalThis[CLOUD_GLOBAL_KEY] = prev;
  }
});

test("override local com o host anterior da nuvem continua a valer", () => {
  const legacy = "https://api.guiaflow.pro";
  assert.equal(
    getCloudBaseUrl({ hostname: "guiaflow.pro", globalValue: legacy }),
    legacy
  );
  assert.equal(
    getCloudBaseUrl({ hostname: "guiaflow.pro", globalValue: "", storageValue: `${legacy}/` }),
    legacy
  );
  assert.equal(cloudVerifyUrl({ baseUrl: legacy }), `${legacy}/auth/verify`);
  const origins = cloudAuthMessageOrigins({ baseUrl: legacy });
  assert.equal(origins.has(legacy), true);
  assert.deepEqual(parseCloudLoginPaste(`  ${legacy}/auth/verify?token=once-token  `), {
    kind: "magic",
    token: "once-token",
  });
});

test("o HTML publicado aponta app.guiaflow.pro e os assets em a/34", () => {
  for (const file of ["../index.html", "../auth/callback.html"]) {
    const html = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(html, /__GUIAFLOW_CLOUD__ = "https:\/\/app\.guiaflow\.pro"/);
    assert.equal(html.includes("api.guiaflow.pro"), false);
  }
  for (const file of ["../index.html", "../view.html", "../ajuda.html", "../api/lib/view-shell.cjs"]) {
    const text = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(text, /a\/34\//);
    assert.equal(text.includes("a/33/"), false);
    assert.equal(text.includes("a/32/"), false);
    assert.equal(text.includes("a/31/"), false);
    assert.equal(text.includes("a/30/"), false);
    assert.equal(text.includes("a/29/"), false);
    assert.equal(text.includes("a/28/"), false);
    assert.equal(text.includes("a/27/"), false);
    assert.equal(text.includes("a/26/"), false);
    assert.equal(text.includes("a/25/"), false);
    assert.equal(text.includes("a/24/"), false);
    assert.equal(text.includes("a/23/"), false);
    assert.equal(text.includes("a/22/"), false);
    assert.equal(text.includes("a/21/"), false);
    assert.equal(text.includes("a/20/"), false);
    assert.equal(text.includes("a/19/"), false);
    assert.equal(text.includes("a/18/"), false);
    assert.equal(text.includes("a/17/"), false);
    assert.equal(text.includes("a/16/"), false);
    assert.equal(text.includes("a/15/"), false);
    assert.equal(text.includes("a/14/"), false);
    assert.equal(text.includes("a/13/"), false);
    assert.equal(text.includes("a/11/"), false);
  }
});

test("expõe as cinco flags e o módulo no host", () => {
  assert.deepEqual(CLOUD_FLAG_KEYS, [
    "hostedAi",
    "tts",
    "permanentShare",
    "branding",
    "analytics",
  ]);
  const host = {};
  const api = installCloudHooks(host);
  assert.equal(host.GuiaFlowCloud, api);
  assert.equal(typeof api.callCloud, "function");
  assert.equal(typeof api.cloudFetch, "function");
  assert.equal(typeof api.establishCloudSession, "function");
  assert.deepEqual(api.getCloudFlags({ baseUrl: "" }), flagsOff());
  assert.equal(installCloudHooks(null), null);
});

test("cloudFetch recusa caminho absoluto e manda o bearer só no header", async () => {
  const fetchCalls = [];
  const prev = globalThis.fetch;
  const prevStorage = globalThis.localStorage;
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (key) => (mem.has(key) ? mem.get(key) : null),
    setItem: (key, value) => mem.set(key, String(value)),
    removeItem: (key) => mem.delete(key),
  };
  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url: String(url), authorization: new Headers(init.headers).get("authorization") });
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, url: "https://app.guiaflow.pro/v/abc" }),
    };
  };
  try {
    writeCloudSession({ accessToken: "sess-token", email: "a@b.co" });
    assert.deepEqual(getCloudAccount(), { signedIn: true, email: "a@b.co" });
    const blocked = await cloudFetch("https://evil.example/shares", { method: "POST" }, {
      baseUrl: "https://app.guiaflow.pro",
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error, "invalid_path");
    const ok = await cloudFetch("/shares", { method: "POST", body: "{}" }, { baseUrl: "https://app.guiaflow.pro" });
    assert.equal(ok.ok, true);
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, "https://app.guiaflow.pro/shares");
    assert.equal(fetchCalls[0].authorization, "Bearer sess-token");
    assert.equal(fetchCalls[0].url.includes("sess-token"), false);
    const anon = await cloudFetch("/auth/magic-link", { method: "POST", auth: false, body: "{}" }, {
      baseUrl: "https://app.guiaflow.pro",
    });
    assert.equal(anon.ok, true);
    assert.equal(fetchCalls[1].authorization, null);
  } finally {
    if (prev === undefined) delete globalThis.fetch;
    else globalThis.fetch = prev;
    if (prevStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = prevStorage;
  }
});

test("parse do link mágico e pedido sem email não saem da máquina", async () => {
  const prev = globalThis.fetch;
  let called = 0;
  globalThis.fetch = async () => {
    called += 1;
    throw new Error("network");
  };
  try {
    assert.deepEqual(parseCloudLoginPaste("  https://app.guiaflow.pro/auth/verify?token=once-token  "), {
      kind: "magic",
      token: "once-token",
    });
    assert.equal(parseCloudLoginPaste("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln").kind, "bearer");
    assert.equal(parseCloudLoginPaste("não é token"), null);
    const bad = await requestMagicLink("sem-arroba", { baseUrl: "https://app.guiaflow.pro" });
    assert.equal(bad.error, "invalid_email");
    assert.equal(called, 0);
  } finally {
    if (prev === undefined) delete globalThis.fetch;
    else globalThis.fetch = prev;
  }
});

test("verificar o link grava o JWT e não o token de uso único", async () => {
  const prev = globalThis.fetch;
  const prevStorage = globalThis.localStorage;
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (key) => (mem.has(key) ? mem.get(key) : null),
    setItem: (key, value) => mem.set(key, String(value)),
    removeItem: (key) => mem.delete(key),
  };
  globalThis.fetch = async (url, init) => {
    const path = String(url);
    if (path.endsWith("/auth/verify")) {
      assert.equal(JSON.parse(init.body).token, "once-token");
      assert.equal(new Headers(init.headers).get("authorization"), null);
      return {
        ok: true,
        status: 200,
        json: async () => ({ accessToken: "jwt-session", user: { email: "ana@example.com" } }),
      };
    }
    return { ok: false, status: 404, json: async () => ({ error: "not_found" }) };
  };
  try {
    const session = await establishCloudSession(
      "https://app.guiaflow.pro/auth/verify?token=once-token",
      { baseUrl: "https://app.guiaflow.pro" }
    );
    assert.deepEqual(session, { ok: true, email: "ana@example.com" });
    const stored = JSON.parse(mem.get(CLOUD_SESSION_KEY));
    assert.equal(stored.accessToken, "jwt-session");
    assert.equal(stored.email, "ana@example.com");
    assert.equal(JSON.stringify(stored).includes("once-token"), false);
    await endCloudSession({ baseUrl: "" });
    assert.equal(mem.has(CLOUD_SESSION_KEY), false);
  } finally {
    if (prev === undefined) delete globalThis.fetch;
    else globalThis.fetch = prev;
    if (prevStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = prevStorage;
  }
});

function fakeJwt(payload) {
  const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${enc({ alg: "none", typ: "JWT" })}.${enc(payload)}.sig`;
}

function memoryStorage() {
  const mem = new Map();
  const prev = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (key) => (mem.has(key) ? mem.get(key) : null),
    setItem: (key, value) => mem.set(key, String(value)),
    removeItem: (key) => mem.delete(key),
  };
  return {
    mem,
    restore() {
      if (prev === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = prev;
    },
  };
}

test("sessão com JWT expirado não entra; a válida mostra a conta", () => {
  const store = memoryStorage();
  try {
    writeCloudSession({ accessToken: fakeJwt({ exp: 1 }), email: "a@b.co" });
    assert.equal(readCloudSession(), null);
    assert.equal(store.mem.has(CLOUD_SESSION_KEY), false);
    assert.deepEqual(getCloudAccount(), { signedIn: false, email: "" });

    writeCloudSession({
      accessToken: fakeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 }),
      email: "ana@example.com",
    });
    assert.deepEqual(getCloudAccount(), { signedIn: true, email: "ana@example.com" });
    writeCloudSession({ accessToken: "opaque-session", email: "ana@example.com" });
    assert.equal(getCloudAccount().signedIn, true);
  } finally {
    store.restore();
  }
});

test("o link mágico volta ao editor e o callback não deixa o token no URL", async () => {
  const prev = globalThis.fetch;
  const store = memoryStorage();
  let body = null;
  globalThis.fetch = async (url, init) => {
    const path = String(url);
    if (path.endsWith("/auth/magic-link")) {
      body = JSON.parse(init.body);
      return { ok: true, status: 200, json: async () => ({ delivered: true }) };
    }
    if (path.endsWith("/auth/verify")) {
      assert.equal(JSON.parse(init.body).token, "once-token-editor");
      return {
        ok: true,
        status: 200,
        json: async () => ({ accessToken: "jwt-session", user: { email: "ana@example.com" } }),
      };
    }
    return { ok: false, status: 404, json: async () => ({ error: "not_found" }) };
  };
  try {
    assert.equal(
      cloudLoginRedirectUrl("https://guiaflow.pro/editor?guiaflow_login=segredo#access_token=nope"),
      "https://guiaflow.pro/auth/callback"
    );
    assert.equal(cloudLoginRedirectUrl("file:///tmp/app.html"), "https://guiaflow.pro/auth/callback");
    assert.equal(
      cloudLoginRedirectUrl("http://127.0.0.1:4173/projetos"),
      "http://127.0.0.1:4173/auth/callback"
    );
    const sent = await requestMagicLink(
      "ana@example.com",
      { baseUrl: "https://app.guiaflow.pro" },
      { redirect: "https://guiaflow.pro/?next=1#x" }
    );
    assert.equal(sent.ok, true);
    assert.deepEqual(body, { email: "ana@example.com", redirect: "https://guiaflow.pro/auth/callback" });

    const href = "https://guiaflow.pro/?lang=pt&guiaflow_login=once-token-editor#stay=1";
    assert.deepEqual(readCloudAuthCallback(href), {
      token: "once-token-editor",
      via: "query",
      key: "guiaflow_login",
      kind: "magic",
    });
    assert.equal(readCloudAuthCallback("https://guiaflow.pro/?access_token=segredo"), null);
    assert.deepEqual(
      parseCloudLoginPaste("https://guiaflow.pro/?guiaflow_login=once-token-editor"),
      { kind: "magic", token: "once-token-editor" }
    );

    const done = await completeCloudAuthCallback(href, { baseUrl: "https://app.guiaflow.pro" });
    assert.equal(done.ok, true);
    assert.equal(done.consumed, true);
    assert.equal(done.email, "ana@example.com");
    assert.equal(done.href.includes("guiaflow_login"), false);
    assert.equal(done.href.includes("once-token-editor"), false);
    assert.match(done.href, /lang=pt/);
    assert.match(done.href, /stay=1/);
    assert.equal(JSON.parse(store.mem.get(CLOUD_SESSION_KEY)).accessToken, "jwt-session");

    const bearer = readCloudAuthCallback(
      `https://guiaflow.pro/#guiaflow_session=${fakeJwt({ sub: "ana" })}&stay=1`
    );
    assert.equal(bearer.kind, "bearer");
    assert.equal(bearer.via, "hash");
    const stripped = stripCloudAuthCallback(
      "https://guiaflow.pro/?guiaflow_login=abc&lang=pt#access_token=jwt&stay=1"
    );
    assert.equal(stripped.includes("guiaflow_login"), false);
    assert.equal(stripped.includes("access_token"), false);
    assert.match(stripped, /lang=pt/);
    assert.match(stripped, /stay=1/);
  } finally {
    if (prev === undefined) delete globalThis.fetch;
    else globalThis.fetch = prev;
    store.restore();
  }
});

test("o code de /auth/callback vira sessão e a senha também", async () => {
  const prev = globalThis.fetch;
  const store = memoryStorage();
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const path = String(url);
    calls.push({ path, body: init?.body ? JSON.parse(init.body) : null, auth: new Headers(init.headers).get("authorization") });
    if (path.endsWith("/auth/callback")) {
      assert.equal(JSON.parse(init.body).code, "once-code");
      return {
        ok: true,
        status: 200,
        json: async () => ({ accessToken: "jwt-from-code", user: { email: "ana@example.com" } }),
      };
    }
    if (path.endsWith("/auth/login")) {
      const body = JSON.parse(init.body);
      if (body.password === "errada") {
        return { ok: false, status: 401, json: async () => ({ error: "invalid_credentials" }) };
      }
      if (body.password === "via-code") {
        return { ok: true, status: 200, json: async () => ({ code: "once-code" }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ accessToken: "jwt-from-password", user: { email: body.email } }),
      };
    }
    return { ok: false, status: 404, json: async () => ({ error: "not_found" }) };
  };
  try {
    const href = "https://guiaflow.pro/auth/callback?code=once-code&lang=pt#stay=1";
    assert.equal(readAuthCallbackCode(href), "once-code");
    assert.equal(readAuthCallbackCode("https://guiaflow.pro/?code=once-code"), "");
    assert.equal(editorHomeFromCallback(href), "https://guiaflow.pro/?lang=pt#stay=1");
    const done = await completeCloudAuthCallback(href, { baseUrl: "https://app.guiaflow.pro" });
    assert.equal(done.ok, true);
    assert.equal(done.consumed, true);
    assert.equal(done.email, "ana@example.com");
    assert.equal(done.href.includes("code="), false);
    assert.equal(done.href.includes("/auth/callback"), false);
    assert.equal(JSON.parse(store.mem.get(CLOUD_SESSION_KEY)).accessToken, "jwt-from-code");
    assert.equal(calls[0].auth, null);
    assert.equal(calls[0].path, "https://app.guiaflow.pro/auth/callback");

    store.mem.delete(CLOUD_SESSION_KEY);
    const bad = await loginWithPassword("ana@example.com", "errada", { baseUrl: "https://app.guiaflow.pro" });
    assert.equal(bad.error, "invalid_credentials");
    assert.equal(store.mem.has(CLOUD_SESSION_KEY), false);
    const empty = await loginWithPassword("ana@example.com", "", { baseUrl: "https://app.guiaflow.pro" });
    assert.equal(empty.error, "invalid_credentials");
    assert.equal(calls.length, 2);

    const pass = await loginWithPassword("ana@example.com", "secreta", { baseUrl: "https://app.guiaflow.pro" });
    assert.deepEqual(pass, { ok: true, email: "ana@example.com" });
    assert.equal(JSON.parse(store.mem.get(CLOUD_SESSION_KEY)).accessToken, "jwt-from-password");

    const viaCode = await loginWithPassword("ana@example.com", "via-code", { baseUrl: "https://app.guiaflow.pro" });
    assert.equal(viaCode.ok, true);
    assert.equal(JSON.parse(store.mem.get(CLOUD_SESSION_KEY)).accessToken, "jwt-from-code");
  } finally {
    if (prev === undefined) delete globalThis.fetch;
    else globalThis.fetch = prev;
    store.restore();
  }
});

test("postMessage de auth só aceita o editor ou a origem da nuvem", () => {
  const origins = cloudAuthMessageOrigins({
    baseUrl: "https://app.guiaflow.pro",
    pageOrigin: "http://localhost:4173",
  });
  const msg = { type: CLOUD_AUTH_MESSAGE_TYPE, token: "once-token-editor", email: "ana@example.com" };
  assert.deepEqual(parseCloudAuthMessage(msg, "https://guiaflow.pro", origins), {
    token: "once-token-editor",
    email: "ana@example.com",
  });
  assert.equal(parseCloudAuthMessage(msg, "https://app.guiaflow.pro", origins)?.token, "once-token-editor");
  assert.equal(parseCloudAuthMessage(msg, "http://localhost:4173", origins)?.token, "once-token-editor");
  assert.equal(parseCloudAuthMessage(msg, "https://evil.example", origins), null);
  assert.equal(parseCloudAuthMessage({ type: "other", token: "x" }, "https://guiaflow.pro", origins), null);
  assert.equal(parseCloudAuthMessage("nope", "https://guiaflow.pro", origins), null);
});

test("a intenção de publicar só uma aba reclama", () => {
  const store = memoryStorage();
  try {
    const now = 1_700_000_000_000;
    assert.equal(writeCloudPublishIntent("proj-1", now)?.projectId, "proj-1");
    assert.equal(claimCloudPublishIntent("outro", now), false);
    assert.equal(store.mem.has(CLOUD_PENDING_PUBLISH_KEY), true);
    assert.equal(claimCloudPublishIntent("proj-1", now), true);
    assert.equal(claimCloudPublishIntent("proj-1", now), false);
    writeCloudPublishIntent("proj-1", now);
    assert.equal(claimCloudPublishIntent("proj-1", now + 31 * 60 * 1000), false);
    assert.equal(store.mem.has(CLOUD_PENDING_PUBLISH_KEY), false);
  } finally {
    store.restore();
  }
});
