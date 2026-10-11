import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const P = await import("./projects.js");
const { createHistory } = await import("./history.js");

const png = (fill, n = 6000) => "data:image/png;base64," + Buffer.alloc(n, fill).toString("base64");
const mp3 = (fill, n = 6000) => "data:audio/mpeg;base64," + Buffer.alloc(n, fill).toString("base64");

function idb(name) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function all(name, store) {
  const db = await idb(name);
  try {
    return await new Promise((resolve) => {
      const req = db.transaction(store).objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result);
    });
  } finally {
    db.close();
  }
}

async function rawPut(store, row) {
  const db = await idb("demo-studio");
  await new Promise((resolve) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(row);
    tx.oncomplete = resolve;
  });
  db.close();
}

function sampleProject(name = "Tour") {
  const project = P.createEmptyProject({ name });
  project.customImages = { a: { name: "a.png", dataUrl: png(1) }, b: { name: "b.png", dataUrl: png(1) } };
  project.steps = [
    { id: "s1", type: "screen", image: "custom:a", narrationAudio: { clips: [mp3(7)] } },
    { id: "s2", type: "screen", image: "custom:b" },
  ];
  return project;
}

test("salvar guarda Blobs por sha (sem base64 no registro) e abrir devolve os data URLs", async () => {
  const project = sampleProject();
  await P.putProject(project);
  const raw = await P.getProjectRecord(project.id);
  assert.equal(JSON.stringify(raw).includes("base64"), false, "registro sem base64");
  const media = await all("demo-studio-media", "media");
  assert.equal(media.length, 2, "duas imagens iguais = um arquivo, + o áudio");
  assert.ok(media.every((row) => row.blob instanceof Blob && row.blob.size === row.size));
  const back = await P.getProject(project.id);
  assert.equal(back.customImages.a.dataUrl, png(1));
  assert.equal(back.steps[0].narrationAudio.clips[0], mp3(7));
  const summary = P.readIndex().projects.find((p) => p.id === project.id);
  assert.ok(summary.sizeBytes >= 12000 && summary.sizeBytes < 14000, `tamanho ${summary.sizeBytes}`);
});

test("projeto antigo (data: inline) abre igual e migra no próximo save", async () => {
  const legacy = { ...sampleProject("Antigo"), id: "proj-legacy" };
  legacy.customImages.c = { name: "c.png", dataUrl: png(3) };
  await rawPut("projects", legacy);
  const opened = await P.getProject("proj-legacy");
  assert.deepEqual(opened.customImages, legacy.customImages);
  await P.putProject(opened);
  const raw = await P.getProjectRecord("proj-legacy");
  assert.equal(JSON.stringify(raw).includes("base64"), false);
  assert.deepEqual((await P.getProject("proj-legacy")).customImages, legacy.customImages);
});

test("histórico de desfazer também guarda a mídia fora e volta inteiro", async () => {
  const project = sampleProject("Com histórico");
  await P.putProject(project);
  const history = createHistory();
  history.reset(project);
  history.noteChange();
  const edited = structuredClone(project);
  edited.customImages.a.dataUrl = png(9);
  history.settle(edited);
  await P.putProjectAndHistory(edited, history.exportStacks());
  const rows = await all("demo-studio", "history");
  const row = rows.find((r) => r.id === project.id);
  assert.equal(JSON.stringify(row).includes("base64"), false);
  const saved = await P.getProjectHistory(project.id);
  const again = createHistory();
  again.restore(edited, saved);
  const undone = again.undoChange(edited);
  assert.equal(undone.customImages.a.dataUrl, png(1));
});

test("duplicar reaproveita os arquivos; apagar + GC remove só o que ninguém cita", async () => {
  const project = sampleProject("Original");
  project.customImages.only = { name: "only.png", dataUrl: png(42) };
  await P.putProject(project);
  const before = (await all("demo-studio-media", "media")).length;
  const copy = await P.duplicateProject(project.id);
  assert.equal((await all("demo-studio-media", "media")).length, before, "cópia não grava bytes novos");
  await P.deleteProject(project.id);
  let gc = await P.collectMediaGarbage({ unlocked: true });
  assert.equal(gc.removed, 0, "a cópia ainda cita tudo");
  await P.deleteProject(copy.id);
  gc = await P.collectMediaGarbage({ unlocked: true });
  assert.ok(gc.removed >= 1);
  const left = await all("demo-studio-media", "media");
  const shas = new Set(left.map((r) => r.sha));
  for (const p of await P.listAllProjects()) {
    for (const match of JSON.stringify(p).matchAll(/gfm:([a-f0-9]{64})/g)) assert.ok(shas.has(match[1]), "nenhum projeto ficou com arquivo faltando");
  }
});

test("exportar JSON continua portátil (base64) e importar JSON antigo segue funcionando", async () => {
  const project = sampleProject("Export");
  await P.putProject(project);
  const payload = P.projectToDemoPayload(await P.getProject(project.id));
  assert.equal(payload.customImages.a.dataUrl, png(1));
  assert.equal(JSON.stringify(payload).includes("\u0001gfm:"), false);
  const imported = P.demoPayloadToProject(JSON.parse(JSON.stringify(payload)), { name: "Importado" });
  await P.putProject(imported);
  assert.equal((await P.getProject(imported.id)).customImages.b.dataUrl, png(1));
});
