import assert from "node:assert/strict";
import test from "node:test";
import {
  CLOUD_FLAG_KEYS,
  CLOUD_GLOBAL_KEY,
  callCloud,
  cloudFetch,
  getCloudBaseUrl,
  getCloudFlags,
  installCloudHooks,
  isCloudEnabled,
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

test("com URL base as flags ficam disponíveis e o helper continua stub", async () => {
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
    assert.deepEqual(await callCloud("/v1/share", { method: "POST" }, env), {
      ok: false,
      stub: true,
      reason: "not-implemented",
    });
    assert.deepEqual(await cloudFetch("/v1/tts", undefined, env), {
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
  assert.deepEqual(api.getCloudFlags({ baseUrl: "" }), flagsOff());
  assert.equal(installCloudHooks(null), null);
});
