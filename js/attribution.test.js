import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCOUNT_SENT_KEY,
  ATTRIBUTION_KEY,
  ATTRIBUTION_TTL_MS,
  captureAttribution,
  cleanUtmValue,
  getAttribution,
  isCreatedDemo,
  markCreatedOnce,
  noteDemoSaved,
  projectMode,
  readUtm,
  sendProductEvent,
  syncAccountAttribution,
} from "./attribution.js";

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    map,
  };
}

function fakeCloud() {
  const calls = [];
  const fn = async (path, init) => {
    calls.push({ path, body: JSON.parse(init.body), init });
    return { ok: true, status: 202 };
  };
  fn.calls = calls;
  return fn;
}

test("readUtm: só utm_source/medium/campaign/content, limpos e sem PII", () => {
  assert.deepEqual(readUtm("?utm_source=LinkedIn&utm_medium=social&utm_campaign=Imob%20Nov&utm_term=x&gclid=1"), {
    utm_source: "linkedin",
    utm_medium: "social",
    utm_campaign: "imob-nov",
  });
  assert.equal(readUtm("?ref=x"), null);
  assert.equal(readUtm("?utm_source=ana%40exemplo.com"), null);
  assert.equal(cleanUtmValue("5511999998888"), "");
});

test("captureAttribution: guarda 90 dias, visita sem UTM não apaga, DNT/GPC não guarda", () => {
  const storage = memoryStorage();
  const t0 = 1_800_000_000_000;
  assert.deepEqual(captureAttribution({ search: "?utm_source=mcptry&utm_medium=directory", storage, now: t0, privacy: false }), { utm_source: "mcptry", utm_medium: "directory" });
  assert.deepEqual(captureAttribution({ search: "", storage, now: t0 + 1000, privacy: false }), { utm_source: "mcptry", utm_medium: "directory" });
  assert.deepEqual(captureAttribution({ search: "?utm_source=linkedin", storage, now: t0 + 2000, privacy: false }), { utm_source: "linkedin" });
  assert.equal(getAttribution({ storage, now: t0 + 2000 + ATTRIBUTION_TTL_MS + 1 }), null);
  assert.equal(storage.getItem(ATTRIBUTION_KEY), null);
  const dnt = memoryStorage();
  assert.equal(captureAttribution({ search: "?utm_source=x", storage: dnt, now: t0, privacy: true }), null);
  assert.equal(dnt.map.size, 0);
});

test("demo criada: modo, projeto com passo, uma vez por id", () => {
  assert.equal(projectMode({ playback: { mode: "gallery" } }), "galeria");
  assert.equal(projectMode({ playback: { mode: "guided" } }), "guia");
  const now = Date.now();
  assert.equal(isCreatedDemo({ id: "a", createdAt: now, steps: [] }, now), false);
  assert.equal(isCreatedDemo({ id: "a", createdAt: now, stock: true, steps: [{}] }, now), false);
  assert.equal(isCreatedDemo({ id: "a", createdAt: now, steps: [{}] }, now), true);
  assert.equal(isCreatedDemo({ id: "a", createdAt: now - 30 * 24 * 3600 * 1000, steps: [{}] }, now), false, "projeto antigo não conta");
  assert.equal(isCreatedDemo({ id: "a", steps: [{}] }, now), false);
  const storage = memoryStorage();
  assert.equal(markCreatedOnce("p1", { storage }), true);
  assert.equal(markCreatedOnce("p1", { storage }), false);
});

test("noteDemoSaved: envia demo_created uma vez, com modo e UTM, sem id do projeto", async () => {
  const storage = memoryStorage();
  captureAttribution({ search: "?utm_source=linkedin&utm_campaign=imob-nov", storage, now: Date.now(), privacy: false });
  const fetchCloud = fakeCloud();
  const project = { id: "proj-123", createdAt: Date.now(), steps: [{}], playback: { mode: "gallery" } };
  assert.equal(noteDemoSaved(project, { fetchCloud, storage, privacy: false }), true);
  assert.equal(noteDemoSaved(project, { fetchCloud, storage, privacy: false }), false);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(fetchCloud.calls.length, 1);
  assert.equal(fetchCloud.calls[0].path, "/api/product-events");
  assert.deepEqual(fetchCloud.calls[0].body, { event: "demo_created", mode: "galeria", utm: { utm_source: "linkedin", utm_campaign: "imob-nov" } });
  assert.equal(fetchCloud.calls[0].init.keepalive, true);
  assert.ok(!JSON.stringify(fetchCloud.calls[0].body).includes("proj-123"));
});

test("sendProductEvent: só eventos do editor; DNT/GPC não envia", async () => {
  const storage = memoryStorage();
  const fetchCloud = fakeCloud();
  assert.equal(await sendProductEvent("demo_shared", { mode: "guia" }, { fetchCloud, storage, privacy: false }), true);
  assert.deepEqual(fetchCloud.calls[0].body, { event: "demo_shared", mode: "guia" });
  assert.equal(await sendProductEvent("upgrade_completed", {}, { fetchCloud, storage, privacy: false }), false);
  assert.equal(await sendProductEvent("demo_shared", {}, { fetchCloud, storage, privacy: true }), false);
  assert.equal(fetchCloud.calls.length, 1);
  assert.equal(await sendProductEvent("demo_shared", {}, { fetchCloud: async () => { throw new Error("x"); }, storage, privacy: false }), false);
});

test("syncAccountAttribution: manda a origem uma vez por conta, sem guardar o e-mail", async () => {
  const storage = memoryStorage();
  const fetchCloud = fakeCloud();
  const account = { signedIn: true, email: "ana@example.com" };
  assert.equal(await syncAccountAttribution({ fetchCloud, account, storage, privacy: false }), false, "sem UTM não envia");
  captureAttribution({ search: "?utm_source=mcptry", storage, now: Date.now(), privacy: false });
  assert.equal(await syncAccountAttribution({ fetchCloud, account, storage, privacy: false }), true);
  assert.equal(await syncAccountAttribution({ fetchCloud, account, storage, privacy: false }), false);
  assert.equal(fetchCloud.calls.length, 1);
  assert.equal(fetchCloud.calls[0].path, "/account/attribution");
  assert.deepEqual(fetchCloud.calls[0].body, { utm: { utm_source: "mcptry" } });
  assert.ok(!String(storage.getItem(ACCOUNT_SENT_KEY)).includes("ana"));
  assert.equal(await syncAccountAttribution({ fetchCloud, account: { signedIn: false }, storage, privacy: false }), false);
  assert.equal(await syncAccountAttribution({ fetchCloud, account: { signedIn: true, email: "bia@example.com" }, storage, privacy: false }), true);
});
