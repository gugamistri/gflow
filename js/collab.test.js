import assert from "node:assert/strict";
import test from "node:test";
import { applyField, canvasIdsForField, diffSnapshots, fieldForDomTarget, inputIdForKey, keyForInputId, normalizePositions, readField, snapshotProject, visualField } from "./collabModel.js";
import { createOpQueue } from "./collabQueue.js";
import { createLockManager } from "./collabLocks.js";
import { createCollabUndo } from "./collabUndo.js";
import { readOnlyReason, roleAtLeast, uiPermissions } from "./collabRoles.js";
import { createCollabClient } from "./collabClient.js";

function proj() {
  return {
    name: "Tour",
    theme: { accent: "#fff" },
    customImages: {},
    steps: [
      { id: "step-a", pos: "a", scene: 1, type: "screen", label: "A", image: "", popover: { title: "Olá", description: "Texto A", side: "bottom", align: "center" }, caption: "cap A" },
      { id: "step-b", pos: "b", scene: 1, type: "screen", label: "B", image: "", popover: { title: "Dois", description: "Texto B", side: "bottom", align: "center" }, caption: "" },
    ],
  };
}
const memStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
};
function queueFor(p, storage) {
  const q = createOpQueue({ storage, storageKey: "q" });
  q.init(snapshotProject(p), {});
  return q;
}

/* ---------- modelo ---------- */

test("snapshot/diff: editar título, mover e criar/apagar passos geram as ops certas", () => {
  const p = proj();
  const before = snapshotProject(p);
  p.steps[0].popover.title = "Novo";
  p.steps.reverse();
  assert.equal(normalizePositions(p.steps), 1);
  p.steps.push({ id: "step-c", pos: "z", scene: 1, type: "screen", label: "C", image: "", popover: { title: "C", description: "", side: "bottom", align: "center" } });
  normalizePositions(p.steps);
  p.steps.splice(p.steps.findIndex((s) => s.id === "step-b"), 1);
  const ops = diffSnapshots(before, snapshotProject(p));
  const keys = ops.map((o) => o.key).sort();
  assert.deepEqual(keys.filter((k) => k.endsWith(":title")), ["s:step-a:title"]);
  assert.ok(keys.includes("s:step-a:pos"));
  assert.ok(keys.includes("s:step-c:new"));
  assert.ok(keys.includes("s:step-b:del"));
  assert.ok(!keys.some((k) => k.startsWith("s:step-c:") && !k.endsWith(":new")), "campos do passo novo vão dentro do new");
});

test("applyField espelha o servidor: texto, pos reordena, del/restaurar com tombstone, new", () => {
  const p = proj();
  assert.equal(applyField(p, "s:step-a:text", "Outro"), true);
  assert.equal(readField(p, "s:step-a:text"), "Outro");
  applyField(p, "s:step-a:pos", "c");
  assert.deepEqual(p.steps.map((s) => s.id), ["step-b", "step-a"]);
  applyField(p, "s:step-b:del", true);
  assert.deepEqual(p.steps.map((s) => s.id), ["step-a"]);
  assert.ok(p.collab.tombstones["step-b"]);
  assert.equal(readField(p, "s:step-b:del"), true);
  applyField(p, "s:step-b:del", false);
  assert.equal(p.steps.length, 2);
  applyField(p, "s:step-n:new", { pos: "bm", label: "N", popover: { title: "N", description: "d" } });
  assert.deepEqual(p.steps.map((s) => s.id), ["step-b", "step-n", "step-a"].sort((a, b) => p.steps.findIndex((s) => s.id === a) - p.steps.findIndex((s) => s.id === b)));
  assert.equal(applyField(p, "s:ghost:title", "x"), false);
  applyField(p, "s:step-a:hl", { hotspot: { x: 1, y: 2, w: 3, h: 4 }, clickPoint: null });
  assert.deepEqual(p.steps.find((s) => s.id === "step-a").hotspot, { x: 1, y: 2, w: 3, h: 4 });
});

test("nome da cena é campo colaborativo: snapshot, diff, readField, applyField e fila", () => {
  const p = { ...proj(), sceneLabels: { 1: "Welcome" } };
  const before = snapshotProject(p);
  assert.deepEqual(before.get("p:sceneLabels"), { 1: "Welcome" });
  const q = queueFor(p, memStorage());
  p.sceneLabels["1"] = "Bem-vindo";
  const after = snapshotProject(p);
  assert.deepEqual(diffSnapshots(before, after), [{ key: "p:sceneLabels", value: { 1: "Bem-vindo" } }]);
  q.observe(after);
  assert.deepEqual(q.takeBatch(), [{ key: "p:sceneLabels", baseRev: 0, value: { 1: "Bem-vindo" } }]);
  assert.deepEqual(readField(p, "p:sceneLabels"), { 1: "Bem-vindo" });
  // o dono, com a cópia antiga, recebe a op do convidado
  const owner = { ...proj(), sceneLabels: { 1: "Welcome" } };
  assert.equal(applyField(owner, "p:sceneLabels", { 1: "Bem-vindo", 2: "Fim" }), true);
  assert.deepEqual(owner.sceneLabels, { 1: "Bem-vindo", 2: "Fim" });
  assert.equal(applyField(owner, "p:sceneLabels", null), true);
  assert.deepEqual(owner.sceneLabels, {});
});

test("campos do inspetor mapeiam para chaves e de volta", () => {
  assert.equal(inputIdForKey("s:step-a:text"), "prop-description");
  assert.equal(keyForInputId("step-a", "prop-title"), "s:step-a:title");
  assert.equal(keyForInputId("step-a", "prop-xyz"), null);
  assert.equal(inputIdForKey("p:name"), null);
  assert.equal(inputIdForKey("s:step-a:i18n.pt.description"), "prop-description");
  assert.equal(inputIdForKey("s:step-a:side"), "prop-side");
  assert.equal(fieldForDomTarget({ id: "prop-title" }), "title");
  assert.equal(fieldForDomTarget({ id: "canvas-popover-body", dataset: { inline: "description" } }), "text");
  assert.equal(fieldForDomTarget({ id: "canvas-caption", dataset: { inline: "caption" } }), "caption");
  assert.equal(fieldForDomTarget({ id: "canvas-stage", dataset: {} }), null);
  assert.equal(visualField("i18n.en.title"), "title");
  assert.deepEqual(canvasIdsForField("text"), ["canvas-popover-body", "canvas-slide-body"]);
  assert.deepEqual(canvasIdsForField("i18n.pt.description"), ["canvas-popover-body", "canvas-slide-body"]);
});

/* ---------- fila de ops ---------- */

test("fila: coalesce por campo, baseRev vem da rev conhecida, applied atualiza shadow e rev", () => {
  const p = proj();
  const q = queueFor(p);
  p.steps[0].popover.title = "A1";
  q.observe(snapshotProject(p));
  p.steps[0].popover.title = "A2";
  p.steps[0].popover.description = "Z";
  q.observe(snapshotProject(p));
  assert.equal(q.pendingCount(), 2);
  const batch = q.takeBatch();
  assert.deepEqual(batch.map((b) => [b.key, b.baseRev, b.value]).sort(), [["s:step-a:text", 0, "Z"], ["s:step-a:title", 0, "A2"]]);
  assert.equal(q.takeBatch().length, 0, "enquanto há lote em voo não sai outro");
  const out = q.settle(batch, { applied: [{ key: "s:step-a:title", rev: 1, prev: "Olá" }, { key: "s:step-a:text", rev: 4, prev: "Texto A" }], rejected: [] });
  assert.equal(out.applied.length, 2);
  assert.equal(q.revOf("s:step-a:text"), 4);
  p.steps[0].popover.title = "A3";
  q.observe(snapshotProject(p));
  assert.equal(q.takeBatch()[0].baseRev, 1);
});

test("fila: voltar ao valor confirmado remove a pendente; criar e apagar antes de enviar não manda nada", () => {
  const p = proj();
  const q = queueFor(p);
  p.steps[0].label = "X";
  q.observe(snapshotProject(p));
  assert.equal(q.pendingCount(), 1);
  p.steps[0].label = "A";
  q.observe(snapshotProject(p));
  assert.equal(q.pendingCount(), 0);
  p.steps.push({ id: "step-t", pos: "n", scene: 1, type: "screen", label: "T", image: "", popover: { title: "T", description: "" } });
  q.observe(snapshotProject(p));
  assert.deepEqual(q.pendingKeys(), ["s:step-t:new"]);
  p.steps[2].popover.title = "T2"; // edição do passo ainda não enviado entra no `new`
  q.observe(snapshotProject(p));
  assert.equal(q.pendingCount(), 1);
  assert.equal(q.takeBatch()[0].value.popover.title, "T2");
});

test("conflito: rejeitada 'stale' guarda minha e a dela; keepMine reenvia com a rev nova; acceptTheirs descarta", () => {
  const p = proj();
  const q = queueFor(p);
  p.steps[0].popover.title = "Minha";
  q.observe(snapshotProject(p));
  const batch = q.takeBatch();
  const out = q.settle(batch, { applied: [], rejected: [{ key: "s:step-a:title", reason: "stale", rev: 3, serverValue: "Dela" }] });
  assert.deepEqual(out.conflicts, [{ key: "s:step-a:title", mine: "Minha", theirs: "Dela", rev: 3 }]);
  assert.equal(q.takeBatch().length, 0, "conflito aberto não reenvia sozinho");
  assert.equal(q.keepMine("s:step-a:title"), true);
  const again = q.takeBatch();
  assert.equal(again[0].baseRev, 3);
  assert.equal(again[0].value, "Minha");
  q.settle(again, { applied: [{ key: "s:step-a:title", rev: 4, prev: "Dela" }], rejected: [] });
  // aceitar a dela
  p.steps[0].popover.title = "M2";
  q.observe(snapshotProject(p));
  const b2 = q.takeBatch();
  q.settle(b2, { applied: [], rejected: [{ key: "s:step-a:title", reason: "stale", rev: 9, serverValue: "D2" }] });
  assert.equal(q.acceptTheirs("s:step-a:title"), "D2");
  assert.equal(q.conflictFor("s:step-a:title"), null);
  assert.equal(q.pendingCount(), 0);
});

test("remoto nunca sobrescreve campo com op local não confirmada; sem pendente aplica", () => {
  const p = proj();
  const q = queueFor(p);
  p.steps[0].caption = "digitando";
  q.observe(snapshotProject(p));
  const r1 = q.remote({ key: "s:step-a:caption", value: "dela", rev: 2 }, "u2");
  assert.equal(r1.apply, false);
  assert.equal(r1.conflict, true);
  assert.equal(r1.mine, "digitando");
  const r2 = q.remote({ key: "s:step-b:title", value: "Outro", rev: 1 }, "u2");
  assert.equal(r2.apply, true);
  assert.equal(q.revOf("s:step-b:title"), 1);
  // mesma mudança dos dois lados não é conflito
  p.steps[1].label = "igual";
  q.observe(snapshotProject(p));
  assert.equal(q.remote({ key: "s:step-b:label", value: "igual", rev: 5 }).same, true);
  assert.equal(q.hasPending("s:step-b:label"), false);
});

test("offline: falha devolve o lote, persiste e restaura; reconectar detecta rev mudada como conflito", () => {
  const p = proj();
  const storage = memStorage();
  const q = queueFor(p, storage);
  p.steps[0].popover.title = "offline 1";
  p.steps[1].label = "offline 2";
  q.observe(snapshotProject(p));
  const batch = q.takeBatch();
  q.fail(batch);
  assert.equal(q.pendingCount(), 2);
  assert.ok(storage._m.get("q"));
  // "recarregou a página": nova fila restaura as pendentes
  const q2 = createOpQueue({ storage, storageKey: "q" });
  q2.init(snapshotProject(proj()), { "s:step-a:title": { rev: 2 }, "s:step-b:label": { rev: 0 } });
  assert.equal(q2.restore(), 2);
  const found = q2.reconcile();
  // título: rev do servidor mudou (2 ≠ baseRev 0) e o valor do servidor difere → conflito
  assert.deepEqual(found.map((f) => f.key), ["s:step-a:title"]);
  assert.equal(q2.conflictKeys().length, 1);
  assert.deepEqual(q2.pendingKeys(), ["s:step-b:label"]);
});

test("resync: aplica o que o servidor mudou, preserva pendentes sem conflito e sinaliza conflitos", () => {
  const p = proj();
  const q = queueFor(p);
  p.steps[0].caption = "minha legenda";
  p.steps[1].label = "meu B";
  q.observe(snapshotProject(p));
  const server = proj();
  server.steps[0].caption = "legenda dela";
  server.steps[1].popover.title = "título dela";
  server.steps.push({ id: "step-z", pos: "z", scene: 1, type: "screen", label: "Z", image: "", popover: { title: "Z", description: "" } });
  const res = q.resync(snapshotProject(server), { "s:step-a:caption": { rev: 1 }, "s:step-b:title": { rev: 1 } });
  assert.deepEqual(res.conflicts.map((c) => c.key), ["s:step-a:caption"]);
  assert.ok(res.apply.some((o) => o.key === "s:step-b:title" && o.value === "título dela"));
  assert.ok(res.apply.some((o) => o.key === "s:step-z:new"));
  assert.ok(!res.apply.some((o) => o.key === "s:step-a:caption"));
  assert.deepEqual(q.pendingKeys(), ["s:step-b:label"]);
});

test("passo apagado: restaurar o mesmo id vira del:false; settle com step_deleted avisa o passo", () => {
  const p = proj();
  const q = queueFor(p);
  const removed = p.steps.splice(1, 1)[0];
  q.observe(snapshotProject(p));
  const b = q.takeBatch();
  assert.equal(b[0].key, "s:step-b:del");
  q.settle(b, { applied: [{ key: "s:step-b:del", rev: 1, prev: false }], rejected: [] });
  assert.equal(q.isDeleted("step-b"), true);
  p.steps.push(removed);
  normalizePositions(p.steps);
  q.observe(snapshotProject(p));
  const b2 = q.takeBatch();
  assert.equal(b2[0].key, "s:step-b:del");
  assert.equal(b2[0].value, false);
  q.settle(b2, { applied: [], rejected: [] });
  q.fail(b2);
  p.steps[0].label = "edita";
  q.observe(snapshotProject(p));
  const b3 = q.takeBatch();
  const out = q.settle(b3, { applied: [], rejected: [{ key: b3[0].key, reason: "step_deleted" }] });
  assert.deepEqual(out.deletedSteps, ["step-a"]);
});

test("locked_by reenvia depois; freeze (papel perdido) mantém as pendentes e não envia", () => {
  const p = proj();
  const q = queueFor(p);
  p.steps[0].label = "L";
  q.observe(snapshotProject(p));
  const b = q.takeBatch();
  const out = q.settle(b, { applied: [], rejected: [{ key: b[0].key, reason: "locked_by" }] });
  assert.equal(out.retry, true);
  assert.equal(q.pendingCount(), 1);
  q.freeze();
  assert.equal(q.takeBatch().length, 0);
  assert.equal(q.pendingCount(), 1);
});

/* ---------- locks ---------- */

function fakeTimers() {
  let t = 0;
  let id = 0;
  const timers = new Map();
  return {
    now: () => t,
    setTimer: (fn, ms) => { id += 1; timers.set(id, { at: t + ms, fn }); return id; },
    clearTimer: (i) => timers.delete(i),
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        const next = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        t = next[1].at;
        timers.delete(next[0]);
        await next[1].fn();
      }
      t = end;
    },
  };
}

test("lock: adquire no primeiro input, renova a cada 20 s com atividade e para de renovar parado", async () => {
  const ft = fakeTimers();
  const calls = [];
  const lm = createLockManager({ selfId: "me", acquire: async (s) => { calls.push(["acq", s]); return { ok: true }; }, release: async (s) => { calls.push(["rel", s]); }, ...ft });
  assert.deepEqual(await lm.touch("s1"), { ok: true });
  assert.equal(lm.holdsLock("s1"), true);
  await ft.advance(20_000); // houve atividade (touch inicial) → renova
  assert.equal(calls.filter((c) => c[0] === "acq").length, 2);
  await lm.touch("s1");
  await ft.advance(20_000);
  assert.equal(calls.filter((c) => c[0] === "acq").length, 3);
  await ft.advance(20_000); // sem atividade: deixa expirar e solta
  assert.equal(lm.holdsLock("s1"), false);
  assert.ok(calls.some((c) => c[0] === "rel"));
});

test("lock: blur solta depois de 5 s, nova atividade cancela; sair do passo solta na hora", async () => {
  const ft = fakeTimers();
  const rel = [];
  const lm = createLockManager({ selfId: "me", acquire: async () => ({ ok: true }), release: async (s) => rel.push(s), ...ft });
  await lm.touch("s1");
  lm.blur("s1");
  await ft.advance(4_000);
  await lm.touch("s1");
  await ft.advance(2_000);
  assert.equal(lm.holdsLock("s1"), true);
  assert.deepEqual(rel, []);
  lm.blur("s1");
  await ft.advance(5_001);
  assert.deepEqual(rel, ["s1"]);
  await lm.touch("s2");
  await lm.leave("s2");
  assert.deepEqual(rel, ["s1", "s2"]);
});

test("lock: passo travado por outra pessoa fica somente leitura; Assumir só depois do TTL; servidor recusa se ainda vivo", async () => {
  const ft = fakeTimers();
  let holderAlive = true;
  const lm = createLockManager({
    selfId: "me",
    acquire: async () => (holderAlive ? { ok: false, holder: { userId: "ana", name: "Ana" } } : { ok: true }),
    release: async () => {}, ...ft,
  });
  lm.applyRemote([{ stepId: "s1", userId: "ana", name: "Ana" }]);
  assert.equal(lm.isLockedByOther("s1"), true);
  assert.equal((await lm.touch("s1")).ok, false);
  assert.equal(lm.canTakeOver("s1"), false);
  await ft.advance(61_000);
  lm.applyRemote([{ stepId: "s1", userId: "ana", name: "Ana" }]); // continua o mesmo holder: seenAt preservado
  assert.equal(lm.canTakeOver("s1"), true);
  assert.equal((await lm.takeOver("s1")).ok, false, "ela ainda está ativa: servidor recusa");
  holderAlive = false;
  lm.applyRemote([]);
  assert.equal(lm.isLockedByOther("s1"), false);
  assert.equal((await lm.takeOver("s1")).ok, true);
  assert.equal(lm.holdsLock("s1"), true);
});

test("lock: sem rede não trava a digitação; lock meu que o servidor não lista expirou", async () => {
  const ft = fakeTimers();
  const lm = createLockManager({ selfId: "me", acquire: async () => { throw new Error("offline"); }, release: async () => {}, ...ft });
  assert.equal((await lm.touch("s1")).ok, true);
  assert.equal(lm.holdsLock("s1"), false);
  const lm2 = createLockManager({ selfId: "me", acquire: async () => ({ ok: true }), release: async () => {}, ...ft });
  await lm2.touch("s9");
  lm2.applyRemote([]);
  assert.equal(lm2.holdsLock("s9"), false);
});

/* ---------- undo por patches inversos ---------- */

test("undo: inverso limpo; só minhas ações; refazer volta; limite de 50", () => {
  const u = createCollabUndo();
  const cur = { "s:a:title": "Novo", "s:a:text": "T2" };
  u.record([{ key: "s:a:title", value: "Novo", prev: "Velho" }]);
  u.seal();
  u.record([{ key: "s:a:text", value: "T2", prev: "T1" }]);
  const r = u.popUndo((k) => cur[k]);
  assert.deepEqual(r.patches, [{ key: "s:a:text", value: "T1" }]);
  assert.equal(r.needsConfirm, false);
  assert.equal(u.canRedo(), true);
  cur["s:a:text"] = "T1";
  const redo = u.popRedo((k) => cur[k]);
  assert.deepEqual(redo.patches, [{ key: "s:a:text", value: "T2" }]);
  for (let i = 0; i < 60; i += 1) { u.seal(); u.record([{ key: `s:a:f${i}`, value: i, prev: null }]); }
  assert.equal(u.size().undo, 50);
});

test("undo: campo que outra pessoa mudou depois pede confirmação e só sobrescreve com force", () => {
  const u = createCollabUndo();
  u.record([{ key: "s:a:title", value: "Meu", prev: "Velho" }]);
  const cur = { "s:a:title": "Dela" };
  const r = u.popUndo((k) => cur[k]);
  assert.equal(r.needsConfirm, true);
  assert.deepEqual(r.conflicts, [{ key: "s:a:title", current: "Dela", expected: "Meu", target: "Velho" }]);
  assert.equal(u.canUndo(), true, "não consumiu");
  const forced = u.popUndo((k) => cur[k], { force: true });
  assert.deepEqual(forced.patches, [{ key: "s:a:title", value: "Velho" }]);
  assert.equal(u.canUndo(), false);
});

test("undo: lotes do mesmo gesto agrupam (prev original); nova ação limpa o refazer; passo apagado limpa entradas", () => {
  const u = createCollabUndo();
  u.record([{ key: "s:a:text", value: "ab", prev: "" }]);
  u.record([{ key: "s:a:text", value: "abc", prev: "ab" }], { group: true });
  assert.equal(u.size().undo, 1);
  const r = u.popUndo(() => "abc");
  assert.deepEqual(r.patches, [{ key: "s:a:text", value: "" }]);
  u.record([{ key: "s:b:title", value: "x", prev: "y" }]);
  assert.equal(u.canRedo(), false);
  u.dropForStep("b");
  assert.equal(u.canUndo(), false);
});

/* ---------- papéis ---------- */

test("papéis: matriz de permissões da UI", () => {
  const off = uiPermissions(null);
  assert.equal(off.collab, false);
  assert.equal(off.canEdit && off.canCreateProject && off.canPublish && off.seeBilling, true);
  const owner = uiPermissions("owner");
  assert.deepEqual([owner.canEdit, owner.canInvite, owner.canManageMembers, owner.canPublish, owner.canDeleteProject, owner.seeBilling], [true, true, true, true, true, true]);
  const editor = uiPermissions("editor", { guest: true });
  assert.deepEqual([editor.canEdit, editor.canInvite, editor.canCreateProject, editor.canDeleteProject, editor.canPublish, editor.seeBilling, editor.seeAnalytics], [true, false, false, false, false, false, false]);
  const commenter = uiPermissions("commenter", { guest: true });
  assert.deepEqual([commenter.canEdit, commenter.canComment, commenter.readOnlyBanner], [false, true, true]);
  const viewer = uiPermissions("viewer", { guest: true });
  assert.deepEqual([viewer.canEdit, viewer.canComment, viewer.canInvite, viewer.readOnlyBanner], [false, false, false, true]);
  const lapsed = uiPermissions("owner", { readOnly: true });
  assert.equal(lapsed.canEdit, false);
  assert.equal(lapsed.canInvite, false);
  assert.equal(readOnlyReason("viewer"), "collab.readonly.viewer");
  assert.equal(readOnlyReason("owner", { readOnly: true }), "collab.readonly.owner");
  assert.equal(readOnlyReason("editor"), "");
  assert.equal(roleAtLeast("editor", "commenter"), true);
  assert.equal(roleAtLeast("viewer", "editor"), false);
  assert.equal(roleAtLeast("x", "viewer"), false);
});

/* ---------- cliente de rede ---------- */

test("cliente: primeiro state sem since → resync; 304 não dispara nada; eventos chegam; 404 encerra", async () => {
  const log = [];
  const responses = [
    { ok: true, status: 200, data: { etag: 'W/"1.a"', seq: 1, role: "editor", resync: true, project: { payload: {} }, fieldRevs: {}, presence: [{ userId: "u2", name: "Ana", role: "editor", stepId: "s1" }], locks: [], events: [] } },
    { ok: false, status: 304 },
    { ok: true, status: 200, data: { etag: 'W/"2.b"', seq: 2, role: "editor", presence: [], locks: [{ stepId: "s1", userId: "u2" }], events: [{ seq: 2, type: "ops", by: "u2", ops: [{ key: "p:name", rev: 1, value: "N" }] }] } },
    { ok: false, status: 404, error: "not_found" },
  ];
  const urls = [];
  const c = createCollabClient({
    projectId: "p1",
    request: async (path, init) => { urls.push([path, init?.headers?.["If-None-Match"] || ""]); return responses.shift(); },
    handlers: {
      onResync: (d) => log.push(["resync", d.seq]), onEvents: (e) => log.push(["events", e.length]), onPresence: (p) => log.push(["presence", p.length]),
      onLocks: (l) => log.push(["locks", l.length]), onRole: (r) => log.push(["role", r]), onAccessLost: (e) => log.push(["lost", e.status]),
    },
    setTimer: () => 0, clearTimer: () => {}, isHidden: () => false,
  });
  assert.deepEqual(await c.pollOnce(), { ok: true, resync: true, seq: 1 });
  assert.deepEqual(await c.pollOnce(), { unchanged: true });
  assert.equal((await c.pollOnce()).ok, true);
  assert.deepEqual((await c.pollOnce()).terminal, true);
  assert.deepEqual(urls.map((u) => u[0]), ["/projects/p1/collab/state", "/projects/p1/collab/state?since=1", "/projects/p1/collab/state?since=1", "/projects/p1/collab/state?since=2"]);
  assert.equal(urls[1][1], 'W/"1.a"', "manda If-None-Match com o etag do corpo");
  assert.deepEqual(log, [["role", "editor"], ["presence", 1], ["locks", 0], ["resync", 1], ["presence", 0], ["locks", 1], ["events", 1], ["lost", 404]]);
  assert.equal(c.isRunning(), false);
});

test("cliente: rede cai → offline, volta → online; sendOps traduz 402/403/429/409", async () => {
  const states = [];
  let next;
  const c = createCollabClient({ projectId: "p1", request: async () => next, handlers: { onOnline: (v) => states.push(v), onAccessLost: () => states.push("lost") }, setTimer: () => 0, clearTimer: () => {} });
  next = { ok: false, error: "network" };
  assert.equal((await c.pollOnce()).offline, true);
  next = { ok: false, status: 304 };
  await c.pollOnce();
  assert.deepEqual(states, [false, true]);
  next = { ok: true, data: { applied: [{ key: "a", rev: 1 }], rejected: [], seq: 3, revision: 5 } };
  assert.equal((await c.sendOps([{ key: "a", baseRev: 0, value: 1 }])).applied.length, 1);
  next = { ok: false, status: 402, error: "owner_subscription_required", data: { error: "owner_subscription_required" } };
  assert.equal((await c.sendOps([])).readOnly, true);
  next = { ok: false, status: 429, data: { retryAfterSec: 7 } };
  assert.equal((await c.sendOps([])).retryMs, 7000);
  next = { ok: false, status: 409, data: { error: "editor_limit" } };
  assert.equal((await c.sendOps([])).editorLimit, true);
  next = { ok: false, status: 403, data: { error: "forbidden_role" } };
  const denied = await c.sendOps([]);
  assert.equal(denied.denied, true);
  assert.ok(states.includes("lost"));
});
