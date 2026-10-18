import assert from "node:assert/strict";
import test from "node:test";
import { AVATAR_COLORS, avatarContrastOk, colorFor, diffPresence, fieldEditors, groupByStep, initialsOf, peopleFrom, visibleAvatars } from "./collabPresence.js";
import { createCollabUi } from "./collabUi.js";
import { uiPermissions } from "./collabRoles.js";
import { getCloudFlags } from "./cloudConfig.js";
import { createCollabController, readCollabMap } from "./collabController.js";

/* ---------- presença ---------- */

test("avatares: as 8 cores passam em contraste 4.5:1 com texto branco; cor e iniciais são estáveis", () => {
  assert.equal(avatarContrastOk(), true);
  assert.equal(colorFor("user-1"), colorFor("user-1"));
  assert.ok(AVATAR_COLORS.includes(colorFor("user-2")));
  assert.equal(initialsOf("Ana Souza"), "AS");
  assert.equal(initialsOf("ana"), "A");
  assert.equal(initialsOf(""), "?");
});

test("presença: exclui eu mesmo, agrupa por passo, limita a 2 avatares + N e informa quem entrou/saiu", () => {
  const list = [
    { userId: "me", name: "Eu", role: "owner", stepId: "s1" },
    { userId: "a", name: "Ana", role: "editor", stepId: "s1", field: "title" },
    { userId: "b", name: "Bia", role: "viewer", stepId: "s1" },
    { userId: "c", name: "Caio", role: "editor", stepId: "s2" },
  ];
  const people = peopleFrom(list, "me");
  assert.deepEqual(people.map((p) => p.name), ["Ana", "Bia", "Caio"]);
  const byStep = groupByStep(people);
  assert.equal(byStep.get("s1").length, 2);
  assert.deepEqual(visibleAvatars(people, 2), { shown: people.slice(0, 2), more: 1 });
  assert.deepEqual(fieldEditors(people, "s1").map((p) => p.field), ["title"]);
  const next = peopleFrom(list.filter((p) => p.userId !== "a").concat({ userId: "d", name: "Davi", role: "editor", stepId: "s3" }), "me");
  const d = diffPresence(people, next);
  assert.deepEqual(d.joined.map((p) => p.name), ["Davi"]);
  assert.deepEqual(d.left.map((p) => p.name), ["Ana"]);
});

/* ---------- flag ---------- */

test("flag collab: desligada por padrão mesmo com a nuvem ligada; liga só com flags.collab===true ou opt-in explícito", () => {
  assert.equal(getCloudFlags({ baseUrl: "https://api.example.com" }).collab, false);
  assert.equal(getCloudFlags({ baseUrl: "https://api.example.com", flags: { collab: true } }).collab, true);
  assert.equal(getCloudFlags({ baseUrl: "https://api.example.com", flags: { collab: "yes" } }).collab, false);
  assert.equal(getCloudFlags({ baseUrl: "https://api.example.com", collabOptIn: true }).collab, true);
  assert.equal(getCloudFlags({ baseUrl: "", flags: { collab: true } }).collab, false);
});

/* ---------- UI por papel (DOM falso) ---------- */

function fakeDom(ids) {
  const mk = (id) => {
    const attrs = new Map();
    return {
      id, hidden: false, attrs,
      setAttribute: (k, v) => attrs.set(k, String(v)), getAttribute: (k) => attrs.get(k) ?? null,
      removeAttribute: (k) => attrs.delete(k), hasAttribute: (k) => attrs.has(k),
      toggleAttribute(k, on) { if (on) attrs.set(k, ""); else attrs.delete(k); return on; },
      classList: { add() {}, remove() {}, toggle() {} },
      style: {}, textContent: "",
    };
  };
  const nodes = Object.fromEntries(ids.map((id) => [id, mk(id)]));
  const classes = new Set();
  const body = { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), contains: (c) => classes.has(c) } };
  globalThis.document = {
    body,
    getElementById: (id) => nodes[id] || null,
    querySelectorAll: (sel) => sel.split(",").map((x) => x.trim()).flatMap((x) => (x.startsWith("#") && nodes[x.slice(1)] ? [nodes[x.slice(1)]] : [])),
    querySelector: () => null,
  };
  return { nodes, classes };
}

test("UI por papel: leitor/comentarista ficam somente leitura (inspetor inerte, faixa); editor edita; convidado perde publicar/cobrança/criar", () => {
  const ids = ["props-body", "btn-share-publish", "btn-share-revoke", "btn-share-republish", "btn-share-analytics", "btn-share-leads", "btn-share-embed", "btn-account-billing", "btn-new-project"];
  const { nodes, classes } = fakeDom(ids);
  const ui = createCollabUi({ t: (k) => k });
  const banner = { hidden: true, textContent: "" };
  // sem mount: o banner não existe; applyPermissions não pode quebrar
  ui.applyPermissions(uiPermissions("viewer", { guest: true }), { readOnlyText: "só ver" });
  assert.equal(nodes["props-body"].hasAttribute("inert"), true);
  assert.ok(classes.has("collab-readonly"));
  assert.equal(nodes["btn-share-publish"].hasAttribute("data-collab-hidden"), true);
  assert.equal(nodes["btn-account-billing"].hasAttribute("data-collab-hidden"), true);
  assert.equal(nodes["btn-new-project"].hasAttribute("data-collab-hidden"), true);

  ui.applyPermissions(uiPermissions("editor", { guest: true }));
  assert.equal(nodes["props-body"].hasAttribute("inert"), false);
  assert.ok(!classes.has("collab-readonly"));
  assert.equal(nodes["btn-share-publish"].hasAttribute("data-collab-hidden"), true, "convidado editor ainda não publica");
  assert.equal(nodes["btn-new-project"].hasAttribute("data-collab-hidden"), true);

  ui.applyPermissions(uiPermissions("owner", { guest: false }));
  assert.equal(nodes["btn-share-publish"].hasAttribute("data-collab-hidden"), false);
  assert.equal(nodes["btn-account-billing"].hasAttribute("data-collab-hidden"), false);
  assert.equal(nodes["btn-new-project"].hasAttribute("data-collab-hidden"), false);
  void banner;
  delete globalThis.document;
});

test("papéis: matriz de permissões do cliente espelha a do servidor", () => {
  const p = (r, o) => uiPermissions(r, o);
  assert.equal(p(null).collab, false);
  assert.equal(p(null).canCreateProject, true, "sem colaboração nada muda");
  assert.equal(p("viewer").canEdit, false);
  assert.equal(p("commenter").canEdit, false);
  assert.equal(p("commenter").canComment, true);
  assert.equal(p("editor").canEdit, true);
  assert.equal(p("editor").canInvite, false);
  assert.equal(p("owner").canInvite, true);
  assert.equal(p("owner", { readOnly: true }).canEdit, false, "dono sem Team: todos somente leitura");
  assert.equal(p("editor", { guest: true }).canPublish, false);
  assert.equal(p("editor", { guest: true }).seeBilling, false);
  assert.equal(p("owner", { guest: true }).canDeleteProject, false);
});

/* ---------- controlador com servidor falso ---------- */

function uiStub() {
  return new Proxy({}, { get: (_t, name) => (name === "isCompact" ? () => false : name === "stackButton" ? () => null : name === "isMounted" ? () => true : () => () => {}) });
}
function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

test("controlador: edição local vira op, o servidor confirma (rev) e o desfazer manda o patch inverso", async () => {
  const storage = memStorage();
  storage.setItem("guiaflow.collab.v1", JSON.stringify({ L1: { remoteId: "R1", role: "owner", guest: false } }));
  const project = { id: "L1", name: "Tour", steps: [{ id: "s1", scene: 1, label: "A", type: "screen", image: "", caption: "oi", popover: { title: "T", description: "D" }, pos: "V" }], customImages: {} };
  const sent = [];
  const revs = { "s:s1:caption": { rev: 1 } };
  const request = async (path, init = {}) => {
    if (path.endsWith("/collab/state") || path.includes("/collab/state?")) {
      return { ok: true, status: 200, data: { ok: true, seq: 1, etag: "e", you: { userId: "u1", name: "Eu" }, role: "owner", presence: [], locks: [], events: [], resync: true, project: { id: "R1", name: "Tour", revision: 1, payload: { name: "Tour", steps: structuredClone(project.steps), collab: { enabled: true, tombstones: {} } } }, fieldRevs: revs } };
    }
    if (path.endsWith("/collab/ops")) {
      const { ops } = JSON.parse(init.body);
      sent.push(ops);
      return { ok: true, status: 200, data: { ok: true, seq: 2, applied: ops.map((o) => ({ key: o.key, rev: (o.baseRev || 0) + 1, prev: "oi" })), rejected: [] } };
    }
    return { ok: true, status: 200, data: { ok: true } };
  };
  const undoStates = [];
  const c = createCollabController({
    t: (k) => k, ui: uiStub(), request, storage,
    getProject: () => project, getSelectedIndex: () => 0, setSelectedIndex() {}, refresh() {}, persistLocal() {},
    confirmDialog: async () => true, fetchMedia: async () => "", uploadMedia: async () => ({ ok: true }),
    onUndoState: (s) => undoStates.push(s),
  });
  await c.attach("L1");
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(c.isActive(), true);
  assert.equal(c.perms().canEdit, true);

  project.steps[0].caption = "olá";
  c.onLocalChange();
  await c.flush();
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].map((o) => [o.key, o.baseRev, o.value]), [["s:s1:caption", 1, "olá"]]);
  assert.equal(undoStates.at(-1)?.canUndo, true);

  await c.undo();
  assert.equal(project.steps[0].caption, "oi", "o desfazer restaurou o valor anterior");
  await c.flush();
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1].map((o) => [o.key, o.value]), [["s:s1:caption", "oi"]]);
  assert.equal(undoStates.at(-1)?.canRedo, true, "o desfazer não é gravado como nova ação");
  await c.detach();
  assert.equal(c.isActive(), false);
});

test("controlador: leitor não envia ops; a edição local é revertida e nada sai", async () => {
  const storage = memStorage();
  storage.setItem("guiaflow.collab.v1", JSON.stringify({ L2: { remoteId: "R2", role: "viewer", guest: true } }));
  const project = { id: "L2", name: "Tour", steps: [{ id: "s1", scene: 1, label: "A", type: "screen", image: "", caption: "oi", popover: {}, pos: "V" }], customImages: {} };
  let opsCalls = 0;
  const request = async (path) => {
    if (path.includes("/collab/state")) return { ok: true, status: 200, data: { ok: true, seq: 1, etag: "e", you: { userId: "u2", name: "Lia" }, role: "viewer", presence: [], locks: [], events: [], resync: true, project: { id: "R2", name: "Tour", revision: 1, payload: { name: "Tour", steps: structuredClone(project.steps), collab: { enabled: true, tombstones: {} } } }, fieldRevs: {} } };
    if (path.endsWith("/collab/ops")) opsCalls += 1;
    return { ok: true, status: 200, data: { ok: true } };
  };
  const c = createCollabController({ t: (k) => k, ui: uiStub(), request, storage, getProject: () => project, getSelectedIndex: () => 0, setSelectedIndex() {}, refresh() {}, persistLocal() {}, confirmDialog: async () => true, fetchMedia: async () => "", uploadMedia: async () => ({ ok: true }) });
  await c.attach("L2");
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(c.perms().canEdit, false);
  project.steps[0].caption = "hack";
  c.onLocalChange();
  await c.flush();
  assert.equal(opsCalls, 0);
  assert.equal(project.steps[0].caption, "oi");
  await c.detach();
  assert.deepEqual(Object.keys(readCollabMap(storage)), ["L2"]);
});
