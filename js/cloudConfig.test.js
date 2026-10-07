import assert from "node:assert/strict";
import test from "node:test";
import {
  CLOUD_FLAG_KEYS,
  CLOUD_GLOBAL_KEY,
  CLOUD_SESSION_KEY,
  callCloud,
  cloudFetch,
  endCloudSession,
  establishCloudSession,
  getCloudAccount,
  getCloudBaseUrl,
  getCloudFlags,
  installCloudHooks,
  isCloudEnabled,
  parseCloudLoginPaste,
  requestMagicLink,
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
      json: async () => ({ ok: true, url: "https://guiaflow.pro/v/abc" }),
    };
  };
  try {
    writeCloudSession({ accessToken: "sess-token", email: "a@b.co" });
    assert.deepEqual(getCloudAccount(), { signedIn: true, email: "a@b.co" });
    const blocked = await cloudFetch("https://evil.example/shares", { method: "POST" }, {
      baseUrl: "https://guiaflow.pro",
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error, "invalid_path");
    const ok = await cloudFetch("/shares", { method: "POST", body: "{}" }, { baseUrl: "https://guiaflow.pro" });
    assert.equal(ok.ok, true);
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, "https://guiaflow.pro/shares");
    assert.equal(fetchCalls[0].authorization, "Bearer sess-token");
    assert.equal(fetchCalls[0].url.includes("sess-token"), false);
    const anon = await cloudFetch("/auth/magic-link", { method: "POST", auth: false, body: "{}" }, {
      baseUrl: "https://guiaflow.pro",
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
    assert.deepEqual(parseCloudLoginPaste("  https://guiaflow.pro/auth/verify?token=once-token  "), {
      kind: "magic",
      token: "once-token",
    });
    assert.equal(parseCloudLoginPaste("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln").kind, "bearer");
    assert.equal(parseCloudLoginPaste("não é token"), null);
    const bad = await requestMagicLink("sem-arroba", { baseUrl: "https://guiaflow.pro" });
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
      "https://guiaflow.pro/auth/verify?token=once-token",
      { baseUrl: "https://guiaflow.pro" }
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
