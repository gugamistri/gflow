import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  bytesToDataUrl,
  createCloudSync,
  dehydrate,
  hydrate,
  mergeCustomThemes,
  projectToSyncPayload,
  readMeta,
  restoreFromPublishedLinks,
  SYNC_META_KEY,
  syncMetaKey,
  writeMeta,
} from "./cloudSync.js";

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    map,
  };
}

const bigImage = (seed) => bytesToDataUrl(new Uint8Array(2000).fill(seed), "image/png");
const bigAudio = (seed) => bytesToDataUrl(new Uint8Array(3000).fill(seed), "audio/mpeg");

/** Servidor falso com as mesmas regras do guiaflow-cloud (revision, clientId, tombstones, mídia). */
function fakeCloud() {
  let clock = Date.parse("2026-10-11T12:00:00.000Z");
  const stamp = () => new Date((clock += 1000)).toISOString();
  const projects = new Map();
  const media = new Map();
  let settings = { payload: {}, revision: 0, updatedAt: null };
  let seq = 0;
  const calls = [];
  const blocked = new Set();
  const present = (p, withPayload) => {
    const out = { id: p.id, clientId: p.clientId, name: p.name, revision: p.revision, updatedAt: p.updatedAt, deletedAt: p.deletedAt };
    if (withPayload) out.payload = structuredClone(p.payload);
    return out;
  };
  const ok = (data, status = 200) => ({ ok: true, status, data });
  const fail = (status, error, extra = {}) => ({ ok: false, status, error, data: { error, ...extra } });
  async function request(path, init = {}) {
    const method = init.method || "GET";
    calls.push(`${method} ${path}`);
    const body = init.body ? JSON.parse(init.body) : {};
    const url = new URL(path, "https://x");
    if (url.pathname === "/projects" && method === "GET") {
      const since = url.searchParams.get("since");
      const list = [...projects.values()].filter((p) => (since ? p.updatedAt > since : !p.deletedAt));
      return ok({ serverTime: new Date(clock).toISOString(), projects: list.map((p) => present(p, false)) });
    }
    if (url.pathname === "/projects" && method === "POST") {
      const existing = [...projects.values()].find((p) => p.clientId && p.clientId === body.clientId);
      if (existing && !existing.deletedAt) return fail(409, "client_id_exists", { project: present(existing, false) });
      const p = existing || { id: `srv-${++seq}`, clientId: body.clientId || null, revision: 0 };
      Object.assign(p, { name: body.name, payload: structuredClone(body.payload), revision: p.revision + 1, updatedAt: stamp(), deletedAt: null });
      projects.set(p.id, p);
      return ok({ project: present(p, true) }, 201);
    }
    const m = /^\/projects\/([^/]+)$/.exec(url.pathname);
    if (m) {
      const p = projects.get(decodeURIComponent(m[1]));
      if (!p || p.deletedAt) return fail(404, "not_found");
      if (method === "GET") return ok({ project: present(p, true) });
      if (method === "PATCH") {
        if (blocked.has(p.id)) return fail(409, "collab_active", { project: present(p, true) });
        if (body.revision != null && body.revision !== p.revision) return fail(409, "revision_conflict", { project: present(p, true) });
        Object.assign(p, { name: body.name ?? p.name, payload: structuredClone(body.payload ?? p.payload), revision: p.revision + 1, updatedAt: stamp() });
        return ok({ project: present(p, true) });
      }
      if (method === "DELETE") {
        Object.assign(p, { deletedAt: stamp(), payload: {}, revision: p.revision + 1 });
        p.updatedAt = p.deletedAt;
        return ok({ project: present(p, false) });
      }
    }
    if (url.pathname === "/media/check") return ok({ missing: body.hashes.filter((h) => !media.has(h)) });
    if (url.pathname === "/settings" && method === "GET") return ok({ settings });
    if (url.pathname === "/settings" && method === "PUT") {
      if (body.revision != null && body.revision !== settings.revision) return fail(409, "revision_conflict", { settings });
      settings = { payload: body.payload, revision: settings.revision + 1, updatedAt: stamp() };
      return ok({ settings });
    }
    if (url.pathname === "/shares/mine") return ok({ shares: [{ slug: "tour-a1", url: "https://guiaflow.pro/p/tour-a1", title: "Tour A", updatedAt: "2026-10-01T00:00:00Z" }, { slug: "tem-projeto", url: "u", title: "B" }] });
    if (url.pathname === "/api/shares/tour-a1") return ok({ payload: { name: "Tour A", steps: [{ id: "s1", image: bigImage(9) }], theme: {} } });
    return fail(404, "not_found");
  }
  return {
    request,
    calls,
    blocked,
    projects,
    media,
    get settings() {
      return settings;
    },
    uploadAsset: async (sha, bytes, mime) => {
      media.set(sha, { bytes: Uint8Array.from(bytes), mime });
      return { ok: true, status: 201 };
    },
    fetchAsset: async (sha) => {
      const row = media.get(sha);
      return row ? bytesToDataUrl(row.bytes, row.mime) : "";
    },
    editRemote(id, fn) {
      const p = projects.get(id);
      fn(p.payload, p);
      p.revision += 1;
      p.updatedAt = stamp();
    },
  };
}

function fakeStore(initial = []) {
  const projects = new Map(initial.map((p) => [p.id, structuredClone(p)]));
  let themes = [];
  let n = 0;
  const listeners = [];
  return {
    projects,
    listen: (fn) => listeners.push(fn),
    listAllProjects: async () => [...projects.values()].map((p) => structuredClone(p)),
    getProject: async (id) => (projects.has(id) ? structuredClone(projects.get(id)) : null),
    putProject: async (p, { silent = false } = {}) => {
      projects.set(p.id, structuredClone(p));
      if (!silent) listeners.forEach((fn) => fn({ type: "put", id: p.id }));
      return p;
    },
    deleteProject: async (id, { silent = false } = {}) => {
      projects.delete(id);
      if (!silent) listeners.forEach((fn) => fn({ type: "delete", id }));
    },
    getCustomThemes: () => structuredClone(themes),
    saveCustomThemes: (next, { silent = false } = {}) => {
      themes = structuredClone(next);
      if (!silent) listeners.forEach((fn) => fn({ type: "settings" }));
    },
    createProjectId: () => `proj-new${++n}`,
  };
}

function engine(cloud, store, storage = memoryStorage(), extra = {}) {
  const statuses = [];
  const sync = createCloudSync({
    request: cloud.request,
    fetchAsset: cloud.fetchAsset,
    uploadAsset: cloud.uploadAsset,
    store,
    storage,
    debounceMs: 60 * 60 * 1000,
    pollMs: 0,
    onStatus: (s) => statuses.push(s),
    skipProject: (p) => p.name === "Como usar o Guia",
    ...extra,
  });
  store.listen((e) => sync.notifyLocalChange(e));
  return { sync, statuses, storage };
}

const localProject = (id, seed, extra = {}) => ({
  id,
  name: `Projeto ${id}`,
  createdAt: 1,
  updatedAt: 2,
  theme: { presetId: "ocean" },
  customImages: { a: { name: "tela.png", dataUrl: bigImage(seed) } },
  steps: [{ id: "s1", image: "custom:a", narrationAudio: bigAudio(seed) }],
  share: { id: "tmp", writeToken: "segredo" },
  cloudShare: { slug: `tour-${id}`, url: `https://guiaflow.pro/p/tour-${id}` },
  ...extra,
});

test("dehydrate/hydrate trocam mídia por asset:<sha> e voltam iguais", async () => {
  const project = localProject("p1", 7);
  const { payload, assets } = await dehydrate(project);
  assert.equal(assets.size, 2);
  const text = JSON.stringify(payload);
  assert.equal(text.includes("data:"), false);
  assert.match(payload.steps[0].narrationAudio, /^asset:[a-f0-9]{64}$/);
  const back = await hydrate(payload, async (sha) => {
    const entry = assets.get(sha);
    return bytesToDataUrl(entry.bytes, entry.mime);
  });
  assert.deepEqual(back, project);
});

test("primeira sincronização sobe todos os projetos locais (menos o exemplo) e um navegador limpo baixa tudo", async () => {
  const cloud = fakeCloud();
  const store = fakeStore([localProject("p1", 1), localProject("p2", 2), { id: "seed", name: "Como usar o Guia", steps: [] }]);
  store.saveCustomThemes([{ id: "t1", name: "Minha marca" }], { silent: true });
  const a = engine(cloud, store);
  await a.sync.enable("ana@example.com");
  assert.equal(a.sync.getState().phase, "synced");
  assert.equal(cloud.projects.size, 2);
  assert.equal(cloud.media.size, 4);
  const remote = [...cloud.projects.values()].find((p) => p.clientId === "p1");
  assert.equal(JSON.stringify(remote.payload).includes("data:"), false);
  assert.equal(remote.payload.share, undefined, "o writeToken do link temporário não sobe");
  assert.equal(remote.payload.cloudShare.slug, "tour-p1", "o link permanente sobe junto");
  assert.deepEqual(cloud.settings.payload.customThemes, [{ id: "t1", name: "Minha marca" }]);
  assert.ok(a.statuses.some((s) => s.phase === "syncing" && s.total === 2));

  // navegador limpo, mesma conta
  const fresh = fakeStore([{ id: "seed", name: "Como usar o Guia", steps: [] }]);
  const b = engine(cloud, fresh);
  await b.sync.enable("ana@example.com");
  const restored = await fresh.getProject("p1");
  const original = localProject("p1", 1);
  delete original.share;
  assert.deepEqual(restored.steps, original.steps);
  assert.deepEqual(restored.customImages, original.customImages);
  assert.deepEqual(restored.cloudShare, original.cloudShare);
  assert.equal(restored.name, "Projeto p1");
  assert.ok(await fresh.getProject("p2"));
  assert.deepEqual(fresh.getCustomThemes(), [{ id: "t1", name: "Minha marca" }]);
  assert.equal(cloud.projects.size, 2, "nada duplicou");
});

test("edições sobem com revision; mídia repetida não sobe de novo", async () => {
  const cloud = fakeCloud();
  const store = fakeStore([localProject("p1", 1)]);
  const a = engine(cloud, store);
  await a.sync.enable("ana@example.com");
  const before = cloud.calls.filter((c) => c.startsWith("POST /media/check")).length;
  const p = await store.getProject("p1");
  p.name = "Renomeado";
  await store.putProject(p);
  await a.sync.syncNow();
  const remote = [...cloud.projects.values()][0];
  assert.equal(remote.name, "Renomeado");
  assert.equal(remote.revision, 2);
  assert.equal(cloud.calls.filter((c) => c.startsWith("POST /media/check")).length, before, "mídia já conhecida");
  // sem mudança de conteúdo: nenhum PATCH
  const patches = cloud.calls.filter((c) => c.startsWith("PATCH")).length;
  await store.putProject(await store.getProject("p1"));
  await a.sync.syncNow();
  assert.equal(cloud.calls.filter((c) => c.startsWith("PATCH")).length, patches);
});

test("PATCH collab_active não derruba o sync e não tenta de novo", async () => {
  const cloud = fakeCloud();
  const store = fakeStore([localProject("p1", 1)]);
  const seen = [];
  const a = engine(cloud, store, memoryStorage(), {
    onCollabActive: (info) => seen.push(info.localId),
  });
  await a.sync.enable("ana@example.com");
  const remote = [...cloud.projects.values()][0];
  cloud.blocked.add(remote.id);
  const p = await store.getProject("p1");
  p.name = "Editado";
  await store.putProject(p);
  await a.sync.syncNow();
  assert.equal(a.statuses.at(-1).phase, "synced");
  assert.equal(a.statuses.at(-1).error, "");
  assert.deepEqual(seen, ["p1"]);
  const patches = cloud.calls.filter((c) => c.startsWith("PATCH")).length;
  const again = await store.getProject("p1");
  again.name = "De novo";
  await store.putProject(again);
  await a.sync.syncNow();
  assert.equal(cloud.calls.filter((c) => c.startsWith("PATCH")).length, patches);
});

test("conflito mantém as duas versões", async () => {
  const cloud = fakeCloud();
  const store = fakeStore([localProject("p1", 1)]);
  const a = engine(cloud, store);
  await a.sync.enable("ana@example.com");
  const remote = [...cloud.projects.values()][0];
  cloud.editRemote(remote.id, (payload) => {
    payload.steps[0].caption = "versão do outro navegador";
  });
  const p = await store.getProject("p1");
  p.steps[0].caption = "versão daqui";
  await store.putProject(p);
  await a.sync.syncNow();
  const locals = await store.listAllProjects();
  assert.equal(locals.length, 2);
  const mine = locals.find((x) => x.id === "p1");
  const other = locals.find((x) => x.id !== "p1");
  assert.equal(mine.steps[0].caption, "versão daqui");
  assert.equal(other.steps[0].caption, "versão do outro navegador");
  assert.match(other.name, /outra versão/);
  assert.equal(other.cloudShare, undefined, "a cópia não herda o link permanente");
  assert.equal(cloud.projects.size, 2);
  assert.equal([...cloud.projects.values()].find((x) => x.clientId === "p1").payload.steps[0].caption, "versão daqui");
});

test("apagar sincroniza nos dois sentidos (tombstone)", async () => {
  const cloud = fakeCloud();
  const store = fakeStore([localProject("p1", 1), localProject("p2", 2)]);
  const storageA = memoryStorage();
  const a = engine(cloud, store, storageA);
  await a.sync.enable("ana@example.com");
  const other = fakeStore([]);
  const b = engine(cloud, other);
  await b.sync.enable("ana@example.com");
  assert.equal((await other.listAllProjects()).length, 2);

  await store.deleteProject("p1");
  await a.sync.syncNow();
  assert.ok([...cloud.projects.values()].find((p) => p.clientId === "p1").deletedAt);
  await b.sync.syncNow();
  assert.equal(await other.getProject("p1"), null);
  assert.ok(await other.getProject("p2"));
});

test("offline: a fila fica no localStorage e sobe quando a rede volta", async () => {
  const cloud = fakeCloud();
  let online = false;
  const store = fakeStore([localProject("p1", 1)]);
  const storage = memoryStorage();
  const request = async (path, init) => (online ? cloud.request(path, init) : { ok: false, error: "network" });
  const a = engine({ ...cloud, request }, store, storage);
  await a.sync.enable("ana@example.com");
  assert.equal(a.sync.getState().phase, "offline");
  assert.equal(cloud.projects.size, 0);
  assert.ok(JSON.parse(storage.getItem(syncMetaKey("ana@example.com"))).dirty.p1);
  assert.equal(storage.getItem(SYNC_META_KEY), null);
  a.sync.disable();
  online = true;
  const again = engine({ ...cloud, request }, store, storage);
  await again.sync.enable("ana@example.com");
  assert.equal(again.sync.getState().phase, "synced");
  assert.equal(cloud.projects.size, 1);
});

test("sem Pro (402) a sincronização para e não apaga nada local", async () => {
  const store = fakeStore([localProject("p1", 1)]);
  const request = async () => ({ ok: false, status: 402, error: "subscription_required" });
  const a = engine({ ...fakeCloud(), request }, store);
  await a.sync.enable("ana@example.com");
  assert.equal(a.sync.getState().phase, "inactive");
  assert.equal(a.sync.isEnabled(), false);
  assert.ok(await store.getProject("p1"));
});

test("outra conta no mesmo navegador recomeça os metadados", async () => {
  const cloud = fakeCloud();
  const store = fakeStore([localProject("p1", 1)]);
  const storage = memoryStorage();
  const a = engine(cloud, store, storage);
  await a.sync.enable("ana@example.com");
  a.sync.disable();
  const b = engine(cloud, store, storage);
  await b.sync.enable("bia@example.com");
  assert.equal(b.sync.getMeta().account, "bia@example.com");
});

test("restaurar dos links publicados cria projeto só para link sem projeto", async () => {
  const cloud = fakeCloud();
  const store = fakeStore([{ id: "x", name: "B", steps: [], cloudShare: { slug: "tem-projeto" } }]);
  const result = await restoreFromPublishedLinks({
    request: cloud.request,
    store,
    toProject: (payload, { name }) => ({ id: "proj-r1", name, steps: payload.steps, customImages: {} }),
    slugOf: (r) => r?.slug || "",
  });
  assert.deepEqual(result, { restored: 1, total: 2 });
  const restored = await store.getProject("proj-r1");
  assert.equal(restored.name, "Tour A");
  assert.equal(restored.cloudShare.slug, "tour-a1");
  assert.match(restored.steps[0].image, /^data:image\/png;base64,/);
});

test("perder o estado não cria outro projeto (cloudId ou o mesmo nome e conteúdo)", async () => {
  const cloud = fakeCloud();
  const store = fakeStore([localProject("p1", 1)]);
  const storage = memoryStorage();
  const a = engine(cloud, store, storage);
  await a.sync.enable("ana@example.com");
  assert.equal(cloud.projects.size, 1);
  const remoteId = [...cloud.projects.keys()][0];
  const saved = await store.getProject("p1");
  assert.equal(saved.cloudId, remoteId);
  assert.equal(projectToSyncPayload(saved).cloudId, undefined);
  const posts = () => cloud.calls.filter((c) => c === "POST /projects").length;
  const afterFirst = posts();

  // o mapa sumiu, mas o registro local ainda tem o id remoto
  storage.map.clear();
  [...cloud.projects.values()][0].clientId = null;
  const b = engine(cloud, store, storage);
  await b.sync.enable("ana@example.com");
  assert.equal(cloud.projects.size, 1);
  assert.equal(posts(), afterFirst);
  assert.equal([...cloud.projects.values()][0].id, remoteId);

  // sem cloudId e sem clientId: o conteúdo igual ainda vincula e faz PATCH
  const local = await store.getProject("p1");
  delete local.cloudId;
  await store.putProject(local, { silent: true });
  storage.map.clear();
  const c = engine(cloud, store, storage);
  await c.sync.enable("ana@example.com");
  assert.equal(cloud.projects.size, 1, "nome + hash não pode gerar POST");
  assert.equal(posts(), afterFirst);
  assert.equal((await store.getProject("p1")).cloudId, remoteId);
});

test("troca de conta guarda o estado de cada uma e não duplica ao voltar", async () => {
  const cloud = fakeCloud();
  const store = fakeStore([localProject("p1", 1)]);
  const storage = memoryStorage();
  const a = engine(cloud, store, storage);
  await a.sync.enable("ana@example.com");
  a.sync.disable();
  const anaRaw = storage.getItem(syncMetaKey("ana@example.com"));
  assert.equal(JSON.parse(anaRaw).remote.p1.id, [...cloud.projects.keys()][0]);
  const posts = cloud.calls.filter((c) => c === "POST /projects").length;

  const biaStore = fakeStore([localProject("p9", 9)]);
  const b = engine(cloud, biaStore, storage);
  await b.sync.enable("bia@example.com");
  assert.equal(b.sync.getMeta().account, "bia@example.com");
  assert.equal(storage.getItem(syncMetaKey("ana@example.com")), anaRaw);
  assert.equal(cloud.projects.size, 2);

  const back = engine(cloud, store, storage);
  await back.sync.enable("ana@example.com");
  assert.equal(back.sync.getMeta().remote.p1.id, JSON.parse(anaRaw).remote.p1.id);
  assert.equal(cloud.calls.filter((c) => c === "POST /projects").length, posts + 1);
  assert.equal(cloud.projects.size, 2);
});

test("sessão sem e-mail não liga nem troca a conta do sync", async () => {
  const cloud = fakeCloud();
  const store = fakeStore([localProject("p1", 1)]);
  const storage = memoryStorage();
  const off = engine(cloud, store, storage);
  await off.sync.enable("");
  await off.sync.enable("conta");
  assert.equal(off.sync.isEnabled(), false);
  assert.equal(cloud.projects.size, 0);
  assert.equal(storage.map.size, 0);

  const a = engine(cloud, store, storage);
  await a.sync.enable("ana@example.com");
  const before = storage.getItem(syncMetaKey("ana@example.com"));
  assert.equal(cloud.projects.size, 1);
  await a.sync.enable("");
  await a.sync.enable("conta");
  assert.equal(a.sync.isEnabled(), true);
  assert.equal(a.sync.getMeta().account, "ana@example.com");
  assert.equal(storage.getItem(syncMetaKey("ana@example.com")), before);
  assert.equal(storage.getItem(syncMetaKey("conta")), null);
  assert.equal(cloud.projects.size, 1);

  const src = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("function reconcileSync()"), src.indexOf("function syncStatusText()"));
  assert.equal(body.includes('account.email || "conta"'), false);
  assert.match(body, /cloudSync\.enable\(email\)/);
  assert.match(body, /if \(!email\) return/);
});

test("duas abas não criam o mesmo projeto duas vezes", async () => {
  const cloud = fakeCloud();
  const store = fakeStore([localProject("p1", 1)]);
  const storage = memoryStorage();
  const a = engine(cloud, store, storage);
  const b = engine(cloud, store, storage);
  await Promise.all([a.sync.enable("ana@example.com"), b.sync.enable("ana@example.com")]);
  assert.equal(cloud.projects.size, 1);
  assert.equal(cloud.calls.filter((c) => c === "POST /projects").length, 1);
  assert.equal(a.sync.getMeta().remote.p1.id, b.sync.getMeta().remote.p1.id);
});

test("navigator.locks: a segunda aba espera e relê o estado em vez de criar", async () => {
  const cloud = fakeCloud();
  const store = fakeStore([localProject("p1", 1)]);
  const storage = memoryStorage();
  let chain = Promise.resolve();
  const locks = {
    request(_name, _opts, callback) {
      const run = chain.then(() => callback());
      chain = run.then(() => {}, () => {});
      return run;
    },
  };
  const a = engine(cloud, store, storage, { locks });
  const b = engine(cloud, store, storage, { locks });
  await Promise.all([a.sync.enable("ana@example.com"), b.sync.enable("ana@example.com")]);
  assert.equal(cloud.projects.size, 1);
  assert.equal(cloud.calls.filter((c) => c === "POST /projects").length, 1);
  assert.equal(a.sync.getMeta().remote.p1.id, b.sync.getMeta().remote.p1.id);
});

test("pull com clientId reutiliza esse id e não chama createProjectId", async () => {
  const cloud = fakeCloud();
  const origin = fakeStore([localProject("p1", 1)]);
  await engine(cloud, origin).sync.enable("ana@example.com");
  let minted = 0;
  const fresh = fakeStore([]);
  const realCreate = fresh.createProjectId;
  fresh.createProjectId = () => {
    minted += 1;
    return realCreate();
  };
  await engine(cloud, fresh).sync.enable("ana@example.com");
  assert.equal(minted, 0);
  assert.ok(await fresh.getProject("p1"));
  assert.equal((await fresh.getProject("p1")).cloudId, [...cloud.projects.keys()][0]);
  assert.equal(cloud.projects.size, 1);
});

test("chave antiga migra só quando a conta é a mesma", () => {
  const storage = memoryStorage();
  const legacy = {
    v: 1,
    account: "ana@example.com",
    cursor: "2026-10-11T12:00:00.000Z",
    initialDone: true,
    remote: { p1: { id: "srv-1", rev: 2, hash: "h" } },
    dirty: {},
    pendingDeletes: {},
  };
  storage.setItem(SYNC_META_KEY, JSON.stringify(legacy));
  const ana = readMeta(storage, "ana@example.com");
  assert.equal(ana.remote.p1.id, "srv-1");
  assert.equal(ana.initialDone, true);
  assert.equal(storage.getItem(SYNC_META_KEY), null);
  assert.equal(JSON.parse(storage.getItem(syncMetaKey("ana@example.com"))).remote.p1.rev, 2);

  const otherStorage = memoryStorage();
  otherStorage.setItem(SYNC_META_KEY, JSON.stringify({ ...legacy, account: "bia@example.com" }));
  const other = readMeta(otherStorage, "ana@example.com");
  assert.equal(other.initialDone, false);
  assert.deepEqual(other.remote, {});
  assert.ok(otherStorage.getItem(SYNC_META_KEY));
  writeMeta(otherStorage, other);
  assert.equal(JSON.parse(otherStorage.getItem(syncMetaKey("ana@example.com"))).account, "ana@example.com");
  assert.ok(otherStorage.getItem(SYNC_META_KEY), "conta diferente não consome a chave antiga");
});

test("temas: união por id; a versão local ganha quando foi ela que mudou", () => {
  const merged = mergeCustomThemes([{ id: "a", v: 2 }, { id: "c" }], [{ id: "a", v: 1 }, { id: "b" }], { preferLocal: true });
  assert.deepEqual(merged, [{ id: "a", v: 2 }, { id: "b" }, { id: "c" }]);
  assert.deepEqual(mergeCustomThemes([{ id: "a", v: 2 }], [{ id: "a", v: 1 }]), [{ id: "a", v: 1 }]);
});
