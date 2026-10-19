/**
 * Controlador da colaboração: liga o editor (project em memória + onChange) ao cliente de rede,
 * fila de ops, locks, desfazer por usuário e à interface. Só existe com a flag `collab` ligada
 * e só age em projetos marcados como colaborativos (mapa em localStorage). Fora disso nada muda.
 */
import { collectAssetRefs, dehydrate, hydrate } from "./cloudSync.js";
import { createCollabClient } from "./collabClient.js";
import { createCommentsUi } from "./commentsUi.js";
import { applyField, FIELD_INPUT_IDS, fieldLabelKey, inputIdForKey, keyForInputId, normalizePositions, parseKey, readField, snapshotProject, stepIdOf, stepKey, TEXT_FIELDS } from "./collabModel.js";
import { createLockManager } from "./collabLocks.js";
import { peopleFrom } from "./collabPresence.js";
import { createOpQueue } from "./collabQueue.js";
import { readOnlyReason, uiPermissions } from "./collabRoles.js";
import { createCollabUndo } from "./collabUndo.js";

export const COLLAB_MAP_KEY = "guiaflow.collab.v1";
const QUEUE_KEY = (remoteId) => `guiaflow.collab.q.${remoteId}`;
const FLUSH_DEBOUNCE_MS = 450;
const GROUP_UNDO_MS = 2_000;
const SHORT_FIELDS = new Set(["title", "label", "alt"]);
const FIELD_BY_INPUT = Object.fromEntries(Object.entries(FIELD_INPUT_IDS).map(([f, id]) => [id, f]));

export function readCollabMap(storage) {
  try {
    const raw = JSON.parse(storage?.getItem(COLLAB_MAP_KEY) || "{}");
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}
function writeCollabMap(storage, map) {
  try { storage?.setItem(COLLAB_MAP_KEY, JSON.stringify(map)); } catch { /* cota */ }
}

export function createCollabController(deps) {
  const {
    t, ui, request, storage = typeof localStorage !== "undefined" ? localStorage : null,
    getProject, getSelectedIndex, setSelectedIndex, refresh, persistLocal, confirmDialog,
    fetchMedia, uploadMedia, getAccountEmail = () => "", openUpgrade = () => {}, openProjectLocal = async () => {},
    createLocalProject = async (p) => p, flushAutosave = async () => {}, syncNow = async () => {}, remoteIdFor = () => null,
    saveLocalCopy = async () => {}, closeToLibrary = () => {}, setSession = () => {}, now = () => Date.now(),
  } = deps;

  let ctx = null; // sessão colaborativa do projeto aberto
  let pendingCommentThread = null; // link do e-mail: abre o painel quando o projeto anexar
  const assetCache = new Map(); // dehydrate
  const mediaCache = new Map(); // sha → data URL
  const uploaded = new Set();

  /* ---------- mapa de projetos colaborativos ---------- */
  const mapEntry = (localId) => readCollabMap(storage)[localId] || null;
  const isCollabLocalId = (localId) => Boolean(mapEntry(localId));
  function remember(localId, entry) {
    const map = readCollabMap(storage);
    map[localId] = entry;
    writeCollabMap(storage, map);
  }
  function forget(localId) {
    const map = readCollabMap(storage);
    delete map[localId];
    writeCollabMap(storage, map);
  }
  const findLocalByRemote = (remoteId) => Object.entries(readCollabMap(storage)).find(([, v]) => v.remoteId === remoteId)?.[0] || null;

  /* ---------- mídia na fronteira da rede ---------- */
  async function prefetchAssets(value, remoteId) {
    const shas = [...collectAssetRefs(value)].filter((s) => !mediaCache.has(s));
    let i = 0;
    const worker = async () => {
      while (i < shas.length) {
        const sha = shas[i++];
        mediaCache.set(sha, (await fetchMedia(`/projects/${encodeURIComponent(remoteId)}/media/${sha}`)) || "");
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, shas.length) }, worker));
  }
  async function toLocalValue(value, remoteId) {
    if (value == null || typeof value !== "object" && typeof value !== "string") return value;
    await prefetchAssets(value, remoteId);
    return hydrate(value, (sha) => mediaCache.get(sha) || "");
  }
  async function toWireValue(value, remoteId) {
    const { payload, assets } = await dehydrate(value, assetCache);
    const need = [...assets.keys()].filter((sha) => !uploaded.has(sha));
    if (need.length) {
      const chk = await request(`/projects/${encodeURIComponent(remoteId)}/media/check`, { method: "POST", body: JSON.stringify({ hashes: need }) });
      if (!chk.ok) throw Object.assign(new Error(chk.error || "media_check"), { network: !chk.status || chk.status >= 500, status: chk.status });
      const missing = new Set(chk.data?.missing || []);
      for (const sha of need) {
        if (missing.has(sha)) {
          const a = assets.get(sha);
          const res = await uploadMedia(remoteId, sha, a.bytes, a.mime);
          if (!res.ok) throw Object.assign(new Error(res.error || "media_upload"), { network: !res.status || res.status >= 500, status: res.status });
        }
        uploaded.add(sha);
      }
    }
    return payload;
  }

  /* ---------- helpers de projeto ---------- */
  const proj = () => getProject();
  const selectedStepId = () => proj()?.steps?.[getSelectedIndex()]?.id || null;
  const stepIndexOf = (id) => (proj()?.steps || []).findIndex((s) => s?.id === id);
  const nameOf = (userId) => ctx?.names.get(userId) || t("collab.conflict.someone");
  const colorOf = (userId) => ctx?.people.find((p) => p.userId === userId) || null;
  function focusInfo() {
    const a = typeof document !== "undefined" ? document.activeElement : null;
    const field = a?.id && FIELD_BY_INPUT[a.id];
    const stepId = selectedStepId();
    if (!field || !stepId || !a.closest?.("#props-body")) return null;
    return { inputId: a.id, field, stepId, key: stepKey(stepId, field) };
  }
  const describeKey = (key) => {
    const k = parseKey(key);
    return { label: t(fieldLabelKey(key)), n: k?.kind === "step" ? Math.max(1, stepIndexOf(k.stepId) + 1) : 0, stepId: k?.stepId || null };
  };

  /** Aplica uma lista de { key, value (local) } no projeto e atualiza a tela mantendo o passo selecionado. */
  function writeToProject(list, { keepSelection = true } = {}) {
    const p = proj();
    if (!p || !list.length) return [];
    const selId = selectedStepId();
    const changed = [];
    for (const op of list) {
      const prev = readField(p, op.key);
      if (applyField(p, op.key, op.value)) changed.push({ key: op.key, prev, value: op.value });
    }
    if (keepSelection && selId) {
      const idx = stepIndexOf(selId);
      setSelectedIndex(idx >= 0 ? idx : Math.min(getSelectedIndex(), Math.max(0, p.steps.length - 1)));
    }
    ctx.queue.markSeen(snapshotProject(p));
    return changed;
  }
  function repaint() {
    persistLocal();
    refresh();
    ui.paintFilmstrip();
    ctx?.comments?.repaint();
    updateFieldMarks();
    updateLockUi();
  }

  /* ---------- permissões e estado ---------- */
  function applyPerms() {
    const perms = ctx.perms;
    ui.applyPermissions(perms, { readOnlyText: perms.readOnlyBanner ? t(readOnlyReason(ctx.role, { readOnly: ctx.ownerLapsed })) : "" });
  }
  function setRole(role) {
    ctx.role = role;
    ctx.perms = uiPermissions(role, { guest: ctx.guest, readOnly: ctx.ownerLapsed });
    if (!ctx.perms.canEdit) ctx.queue.freeze();
    applyPerms();
    ctx.comments?.refresh({ quiet: true });
  }
  function paintStatus() {
    ui.setStatus({ online: ctx.online, pending: ctx.queue.pendingCount(), syncing: ctx.sending });
  }

  /* ---------- envio ---------- */
  function scheduleFlush(ms = FLUSH_DEBOUNCE_MS) {
    clearTimeout(ctx.flushTimer);
    ctx.flushTimer = setTimeout(() => void flush(), ms);
  }

  function revertToShadow() {
    const p = proj();
    const shadow = ctx.queue.shadowSnapshot();
    const ops = [];
    const local = snapshotProject(p);
    for (const [key, value] of shadow) if (JSON.stringify(local.get(key) ?? null) !== JSON.stringify(value ?? null)) ops.push({ key, value });
    writeToProject(ops);
    repaint();
  }

  async function flush() {
    if (!ctx || ctx.sending) { if (ctx) ctx.again = true; return; }
    const c = ctx;
    c.sending = true;
    try {
      do {
        c.again = false;
        const p = proj();
        if (!p) break;
        if (!c.perms.canEdit) {
          if (c.queue.observe(snapshotProject(p)).length) { revertToShadow(); ui.toast({ text: t("collab.toast.readonlyEdit") }); }
          break;
        }
        normalizePositions(p.steps); // o editor reordena o array e não conhece `pos`
        c.queue.observe(snapshotProject(p));
        paintStatus();
        const batch = c.queue.takeBatch();
        if (!batch.length) break;
        if (!c.online) { c.queue.fail(batch); break; }
        let wire;
        try {
          wire = [];
          for (const b of batch) wire.push({ key: b.key, baseRev: b.baseRev, value: await toWireValue(b.value, c.remoteId) });
        } catch (err) {
          c.queue.fail(batch);
          if (err?.network) { scheduleFlush(5_000); break; }
          console.error(err);
          break;
        }
        const res = await c.client.sendOps(wire);
        if (ctx !== c) return;
        if (!res.ok) {
          c.queue.fail(batch);
          if (res.readOnly) { c.ownerLapsed = true; setRole(c.role); }
          else if (res.editorLimit) ui.toast({ text: t("collab.editorLimit") });
          else if (res.limited) scheduleFlush(res.retryMs);
          else if (res.network) scheduleFlush(5_000);
          break;
        }
        const out = c.queue.settle(batch, res);
        recordUndo(out.applied);
        if (out.conflicts.length) presentConflicts(out.conflicts.map((x) => ({ ...x, by: null })));
        for (const id of new Set(out.deletedSteps)) onStepGone(id, null);
        if (out.retry) scheduleFlush(1_500);
        c.client.nudge();
        c.again = c.again || c.queue.hasPending();
      } while (c.again && ctx === c);
    } finally {
      if (ctx === c) { c.sending = false; paintStatus(); }
    }
  }

  function recordUndo(applied) {
    const c = ctx;
    const skip = c.skipRecord;
    if (skip) {
      c.skipRecord = null;
      if (skip.entry) c.undo.afterApply(skip.entry, applied);
      applied = applied.filter((a) => !skip.keys.has(a.key));
    }
    if (!applied.length) return;
    const t0 = now();
    c.undo.record(applied, { group: t0 - c.lastRecordAt < GROUP_UNDO_MS });
    c.lastRecordAt = t0;
    paintUndo();
  }
  function paintUndo() {
    deps.onUndoState?.({ canUndo: ctx?.undo.canUndo() || false, canRedo: ctx?.undo.canRedo() || false });
  }

  /* ---------- mudanças locais vindas do editor ---------- */
  function onLocalChange() {
    if (!ctx) return false;
    if (ctx.applyingRemote) return true;
    scheduleFlush();
    const f = focusInfo();
    if (f) void touchLock(f.stepId);
    paintStatus();
    return true;
  }

  /* ---------- eventos remotos ---------- */
  async function onEvents(events) {
    const c = ctx;
    const list = [];
    const conflicts = [];
    for (const ev of events) {
      if (ev.type === "members") { void refreshMembers(); continue; }
      if (ev.type !== "ops" || ev.by === c.selfId) continue;
      for (const op of ev.ops || []) {
        const r = c.queue.remote(op, ev.by);
        if (r.conflict) conflicts.push({ key: r.key, mine: r.mine, theirs: r.theirs, by: ev.by });
        else if (r.apply) list.push({ key: op.key, value: op.value, by: ev.by });
      }
    }
    if (conflicts.length) await presentConflicts(await convertConflicts(conflicts));
    if (list.length) await applyRemote(list);
  }

  async function convertConflicts(list) {
    const out = [];
    for (const c of list) out.push({ ...c, mine: c.mine, theirs: await toLocalValue(c.theirs, ctx.remoteId) });
    return out;
  }

  /** O que o usuário está digitando nunca é sobrescrito: vai para `deferred` e entra no blur. */
  async function applyRemote(list, { toast = true } = {}) {
    const c = ctx;
    const focus = focusInfo();
    const now_ = [];
    for (const op of list) {
      if (focus && op.key === focus.key) { c.deferred.set(op.key, { value: op.value, by: op.by }); continue; }
      now_.push({ ...op, value: await toLocalValue(op.value, c.remoteId) });
    }
    if (ctx !== c || !now_.length) return;
    c.applyingRemote = true;
    let changed;
    try {
      const p = proj();
      for (const op of now_) {
        const k = parseKey(op.key);
        if (k?.field === "del" && op.value === true && p.steps[getSelectedIndex()]?.id === k.stepId) onStepGone(k.stepId, op.by, { silent: false });
        if (k?.field === "del" && op.value === true) {
          c.undo.dropForStep(k.stepId);
          const st = p.steps.find((x) => x.id === k.stepId);
          op.stepLabel = st?.label || st?.title || "";
        }
      }
      changed = writeToProject(now_);
      repaint();
    } finally {
      c.applyingRemote = false;
    }
    paintUndo();
    if (toast) announceRemote(now_, changed);
  }

  function announceRemote(list, changed) {
    if (!changed?.length) return;
    const by = list[0].by;
    const name = nameOf(by);
    const sel = selectedStepId();
    // quem está digitando num passo que eu estou vendo: o aviso de passo travado já explica; sem toast a cada tecla
    const holder = sel ? ctx.locks.holderOf(sel) : null;
    if (holder && holder.userId === by && changed.every((x) => stepIdOf(x.key) === sel)) {
      for (const x of changed) {
        const id = inputIdForKey(x.key);
        if (id) ui.flashField(id);
      }
      return;
    }
    const prevs = changed.map((x) => ({ key: x.key, value: x.prev }));
    const undoRemote = () => {
      const ops = prevs.filter((x) => x.value !== undefined);
      c_applyLocalPatches(ops);
    };
    let text;
    if (changed.length === 1) {
      const d = describeKey(changed[0].key);
      const k = parseKey(changed[0].key);
      if (k?.field === "new") text = t("collab.toast.stepAdded", { name });
      else if (k?.field === "del") text = t(changed[0].value ? "collab.toast.stepRemoved" : "collab.toast.stepAdded", { name, step: list.find((x) => x.key === changed[0].key)?.stepLabel || "" });
      else if (k?.field === "pos") text = t("collab.toast.moved", { name });
      else text = d.n ? t("collab.toast.changed", { name, field: d.label, n: d.n }) : t("collab.toast.changedProject", { name, field: d.label });
    } else text = t("collab.toast.nOps", { name, n: changed.length });
    const structural = changed.some((x) => /:(new|del)$/.test(x.key));
    ui.toast({ text, actionLabel: structural ? "" : t("collab.toast.undo"), onAction: structural ? null : undoRemote });
    for (const x of changed) {
      const id = inputIdForKey(x.key);
      if (id && stepIdOf(x.key) === sel) ui.flashField(id);
    }
  }

  /** Aplica valores no projeto como edição MINHA (vira op, entra no meu desfazer). */
  function c_applyLocalPatches(patches) {
    const p = proj();
    if (!p || !ctx) return;
    for (const x of patches) applyField(p, x.key, x.value);
    repaint();
    scheduleFlush(50);
  }

  /* ---------- conflitos ---------- */
  async function presentConflicts(list) {
    const c = ctx;
    const sel = selectedStepId();
    for (const cf of list) {
      const k = parseKey(cf.key);
      const name = cf.by ? nameOf(cf.by) : t("collab.conflict.someone");
      const field = k?.kind === "step" ? k.field : null;
      const textual = Boolean(field && TEXT_FIELDS[field] && typeof cf.mine === "string");
      const label = t(fieldLabelKey(cf.key));
      const keepMine = () => { c.queue.keepMine(cf.key); scheduleFlush(50); ui.toast({ text: t("collab.toast.mineKept", { field: label }) }); };
      const useTheirs = async () => {
        const theirs = c.queue.acceptTheirs(cf.key);
        await applyRemote([{ key: cf.key, value: theirs, by: cf.by }], { toast: false });
      };
      if (!textual) {
        // campo estruturado: a última escrita (a minha) vence, com Desfazer para a versão dela
        keepMine();
        ui.toast({ text: t("collab.toast.mineKept", { field: label }), actionLabel: t("collab.toast.discard"), onAction: () => void useTheirs() });
        continue;
      }
      const inputId = inputIdForKey(cf.key);
      const inline = !ui.isCompact() && SHORT_FIELDS.has(field) && stepIdOf(cf.key) === sel && inputId;
      if (inline) ui.showInlineConflict({ key: cf.key, inputId, name, onTheirs: () => void useTheirs(), onMine: keepMine });
      else ui.showConflictDialog({ name, mine: cf.mine, theirs: cf.theirs, onTheirs: () => void useTheirs(), onMine: keepMine });
    }
  }

  /** Blur: aplica o que chegou enquanto o campo estava em foco (a menos que eu tenha digitado). */
  function onFieldBlur(inputId) {
    if (!ctx) return;
    const sid = selectedStepId();
    const key = sid ? keyForInputId(sid, inputId) : null;
    if (key) ctx.locks.blur(sid);
    pushPresence();
    if (!key || !ctx.deferred.has(key)) return;
    const d = ctx.deferred.get(key);
    ctx.deferred.delete(key);
    if (ctx.queue.hasPending(key)) {
      // digitei enquanto a versão dela chegava: vira conflito (a minha continua no campo)
      const r = ctx.queue.remote({ key, value: d.value, rev: ctx.queue.revOf(key) }, d.by);
      if (r.conflict) void convertConflicts([{ key, mine: r.mine, theirs: r.theirs, by: d.by }]).then(presentConflicts);
      return;
    }
    void applyRemote([{ key, value: d.value, by: d.by }]);
  }

  function onFieldFocus() { pushPresence(); }
  async function onFieldInput(inputId) {
    if (!ctx || !ctx.perms.canEdit) return;
    const sid = selectedStepId();
    if (sid) await touchLock(sid);
    pushPresence();
  }

  /* ---------- passo removido ---------- */
  function onStepGone(stepId, by) {
    const c = ctx;
    if (!c || c.goneShown.has(stepId)) return;
    c.goneShown.add(stepId);
    const p = proj();
    const saved = p?.collab?.tombstones?.[stepId] || p?.steps?.find((s) => s.id === stepId);
    if (selectedStepId() !== stepId && getSelectedIndex() >= 0 && stepIndexOf(stepId) < 0 && by) {
      ui.toast({ text: t("collab.toast.stepRemoved", { name: nameOf(by), step: saved?.label || saved?.title || "" }) });
      return;
    }
    ui.showStepRemoved({
      name: by ? nameOf(by) : t("collab.conflict.someone"),
      onRestore: () => {
        const pp = proj();
        if (!pp || !saved) return;
        const copy = structuredClone(saved);
        copy.id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
        delete copy.pos;
        const at = Math.min(getSelectedIndex() + 1, pp.steps.length);
        pp.steps.splice(at, 0, copy);
        setSelectedIndex(at);
        repaint();
        scheduleFlush(50);
        ui.toast({ text: t("collab.step.restored") });
      },
    });
  }

  /** Antes de apagar um passo: avisa se outra pessoa o está editando. Devolve false para cancelar. */
  async function confirmStepDelete(stepId) {
    if (!ctx) return true;
    const holder = ctx.locks.holderOf(stepId);
    if (!holder) return true;
    return confirmDialog(t("collab.stepDelete.locked", { name: holder.name || nameOf(holder.userId) }));
  }

  /* ---------- locks e presença ---------- */
  async function touchLock(stepId) {
    if (!ctx?.perms.canEdit) return;
    const res = await ctx.locks.touch(stepId);
    if (res && res.ok === false && res.holder) updateLockUi();
  }
  function updateLockUi() {
    if (!ctx) return;
    const sid = selectedStepId();
    const holder = sid ? ctx.locks.holderOf(sid) : null;
    const person = holder ? ctx.people.find((p) => p.userId === holder.userId) : null;
    ui.paintLockBanner(sid, holder
      ? {
        holder: { name: holder.name || nameOf(holder.userId), color: person?.color || "#4a5568", initials: person?.initials || (holder.name || "?").slice(0, 1).toUpperCase() },
        canTakeOver: ctx.locks.canTakeOver(sid),
        onTakeOver: async () => {
          const r = await ctx.locks.takeOver(sid);
          if (r && r.ok === false) ui.toast({ text: t("collab.lock.taken", { name: holder.name || nameOf(holder.userId) }) });
          updateLockUi();
        },
      }
      : null);
    const map = new Map();
    for (const [id, h] of ctx.locks.othersMap()) {
      const pr = ctx.people.find((p) => p.userId === h.userId);
      map.set(id, { userId: h.userId, name: h.name || nameOf(h.userId), color: pr?.color || "#4a5568" });
    }
    ui.setLocks(map);
  }
  function updateFieldMarks() {
    ui.paintFieldMarks(selectedStepId());
  }
  function pushPresence() {
    if (!ctx?.client.isRunning()) return;
    void ctx.client.sendPresence();
  }
  function onStepSelected() {
    if (!ctx) return;
    const sid = selectedStepId();
    if (ctx.lastStep && ctx.lastStep !== sid) {
      void ctx.locks.leave(ctx.lastStep);
      ctx.undo.seal();
    }
    ctx.lastStep = sid;
    ctx.comments?.onStepSelected();
    updateLockUi();
    updateFieldMarks();
    pushPresence();
  }

  async function refreshMembers() {
    const res = await ctx?.client.members();
    if (!res?.ok || !ctx) return null;
    ctx.members = res.data.members || [];
    for (const m of ctx.members) ctx.names.set(m.userId, m.name);
    return res.data;
  }

  /* ---------- resync (primeiro estado e reconexões) ---------- */
  async function onResync(data) {
    const c = ctx;
    c.selfId = data.you?.userId || c.selfId;
    c.locks.setSelf(c.selfId);
    if (c.pendingLocks) { c.locks.applyRemote(c.pendingLocks); c.pendingLocks = null; }
    if (c.pendingPresence) { const pp = c.pendingPresence; c.pendingPresence = null; onPresence(pp); }
    if (data.you?.name) { c.names.set(c.selfId, data.you.name); c.selfName = data.you.name; }
    const payload = data.project?.payload || {};
    const hydrated = await toLocalValue(payload, c.remoteId);
    const asProject = { ...hydrated, name: data.project?.name || hydrated.name, steps: Array.isArray(hydrated.steps) ? hydrated.steps : [] };
    const server = snapshotProject(asProject);
    const tombstones = Object.keys(payload.collab?.tombstones || {});
    const p = proj();
    if (!p || ctx !== c) return;
    let apply;
    let conflicts = [];
    if (!c.ready) {
      c.queue.init(server, data.fieldRevs || {}, { tombstones });
      c.queue.restore();
      conflicts = c.queue.reconcile();
      const mine = new Set(c.queue.pendingKeys());
      const stepsNew = new Set([...mine].filter((k) => k.endsWith(":new")).map((k) => stepIdOf(k)));
      const local = snapshotProject(p);
      const diff = [];
      const seenKeys = new Set();
      for (const [key, value] of server) if (JSON.stringify(local.get(key) ?? null) !== JSON.stringify(value ?? null)) diff.push({ key, value });
      for (const key of local.keys()) if (key.endsWith(":new") && !server.has(key)) diff.push({ key: stepKey(stepIdOf(key), "del"), value: true });
      apply = diff.filter((op) => {
        const id = stepIdOf(op.key);
        if (seenKeys.has(op.key)) return false;
        seenKeys.add(op.key);
        return !mine.has(op.key) && !(id && stepsNew.has(id)) && !c.queue.conflictKeys().includes(op.key);
      });
      c.ready = true;
    } else {
      const r = c.queue.resync(server, data.fieldRevs || {}, { tombstones });
      apply = r.apply;
      conflicts = r.conflicts;
    }
    p.collab = structuredClone(payload.collab || p.collab || {});
    if (conflicts.length) await presentConflicts(await convertConflicts(conflicts.map((x) => ({ ...x, by: null }))));
    // `del` do servidor e `new`: o applyField cuida; os valores já estão na forma local (hidratados)
    const list = apply.map((op) => ({ key: op.key, value: op.value, by: null }));
    const focus = focusInfo();
    const writable = list.filter((op) => !(focus && op.key === focus.key));
    c.applyingRemote = true;
    try {
      const changed = writeToProject(writable);
      if (changed.length || c.firstPaint !== true) repaint();
      c.firstPaint = true;
    } finally {
      c.applyingRemote = false;
    }
    for (const op of list) if (focus && op.key === focus.key) c.deferred.set(op.key, { value: op.value, by: null });
    c.names.size || refreshMembers();
    paintStatus();
    scheduleFlush(100);
  }

  function onPresence(list) {
    if (!ctx) return;
    // o 1º state traz presença antes de eu saber quem sou: guarda e repinta depois do resync
    if (!ctx.selfId) { ctx.pendingPresence = list; return; }
    ctx.idle = ctx.idle || new Map();
    const next = peopleFrom(list, ctx.selfId, { idleMap: ctx.idle });
    for (const p of next) {
      const prev = ctx.people.find((x) => x.userId === p.userId);
      if (!prev || prev.stepId !== p.stepId || prev.field !== p.field) ctx.idle.set(p.userId, now());
      if (p.name) ctx.names.set(p.userId, p.name);
    }
    ctx.people = peopleFrom(list, ctx.selfId, { idleMap: ctx.idle });
    ui.setPeople(ctx.people, { selfName: ctx.selfName });
    updateFieldMarks();
    updateLockUi();
  }

  /* ---------- sessão ---------- */
  async function attach(localId) {
    const entry = mapEntry(localId);
    if (!entry || ctx?.localId === localId) return false;
    await detach();
    const remoteId = entry.remoteId;
    const c = {
      localId, remoteId, role: entry.role || "viewer", guest: Boolean(entry.guest), ownerLapsed: false, selfId: "", selfName: "",
      queue: createOpQueue({ storage, storageKey: QUEUE_KEY(remoteId) }),
      undo: createCollabUndo(), people: [], names: new Map(), members: [], deferred: new Map(), goneShown: new Set(),
      online: true, sending: false, again: false, ready: false, applyingRemote: false, lastRecordAt: 0, lastStep: null,
      flushTimer: null, skipRecord: null, perms: null, client: null, locks: null,
    };
    ctx = c;
    ui.mount();
    c.perms = uiPermissions(c.role, { guest: c.guest });
    c.client = createCollabClient({
      request, projectId: remoteId, getStep: selectedStepId,
      getField: () => focusInfo()?.field || null,
      handlers: {
        onResync: (d) => onResync(d), onEvents: (e) => onEvents(e), onPresence: (l) => onPresence(l),
        onLocks: (l) => { if (!c.selfId) { c.pendingLocks = l; return; } c.locks.applyRemote(l); updateLockUi(); },
        onRole: (r) => { if (r !== c.role) setRole(r); },
        onEffectiveRole: (x) => { if (x?.downgraded) ui.toast({ text: t("collab.editorLimit") }); },
        onOnline: (on) => { c.online = on; paintStatus(); if (on) scheduleFlush(200); },
        onReadOnly: () => { c.ownerLapsed = true; setRole(c.role); },
        onCseq: (n) => c.comments?.onCseq(n),
        onAccessLost: () => void onAccessLost(),
      },
    });
    c.locks = createLockManager({ selfId: "", acquire: (id) => c.client.acquireLock(id), release: (id) => c.client.releaseLock(id), onChange: () => updateLockUi() });
    ui.stackButton()?.addEventListener("click", () => { if (teamHost() && deps.onOpenTeam) deps.onOpenTeam(); else void openMembers(); });
    // comentários do Team: só dentro da sessão colaborativa (flag `collab`); o cseq chega no mesmo polling
    c.comments = createCommentsUi({
      t, request, projectId: remoteId, getProject, getSelectedIndex, setSelectedIndex,
      getSelfId: () => c.selfId, getMembers: () => c.members || [], refreshMembers: () => refreshMembers(),
      announce: (x) => ui.announce(x), toast: (o) => ui.toast(o), confirm: confirmDialog,
    });
    c.client.start();
    c.comments.start();
    if (pendingCommentThread && pendingCommentThread.projectId === remoteId) {
      const th = pendingCommentThread.threadId;
      pendingCommentThread = null;
      setTimeout(() => c.comments?.openPanel({ threadId: th }), 400);
    }
    applyPerms();
    ui.setStatus({ online: true, pending: 0 });
    paintUndo();
    return true;
  }

  async function detach() {
    const c = ctx;
    if (!c) return;
    clearTimeout(c.flushTimer);
    try { await flush(); } catch { /* ignore */ }
    c.client.stop();
    c.comments?.destroy();
    try { await c.locks.releaseAll(); } catch { /* ignore */ }
    c.locks.destroy();
    void c.client.leavePresence();
    ctx = null;
    ui.unmount();
    deps.onUndoState?.(null);
  }

  /** Fim da sessão (página fechando): solta locks e presença sem esperar. */
  function onPageHide() {
    if (!ctx) return;
    for (const id of ctx.locks.mineIds()) {
      try { void request(`/projects/${encodeURIComponent(ctx.remoteId)}/collab/locks/${encodeURIComponent(id)}`, { method: "DELETE", keepalive: true, timeoutMs: 3000 }); } catch { /* ignore */ }
    }
    try { void request(`/projects/${encodeURIComponent(ctx.remoteId)}/collab/presence`, { method: "DELETE", keepalive: true, timeoutMs: 3000 }); } catch { /* ignore */ }
  }

  async function onAccessLost() {
    const c = ctx;
    if (!c) return;
    c.queue.freeze();
    ui.showMessage({
      title: t("collab.access.lost"), text: "",
      actions: [
        { label: t("collab.access.saveCopy"), primary: true, onClick: async () => { await saveLocalCopy(proj()); ui.toast({ text: t("collab.access.copySaved") }); } },
        { label: t("collab.access.ok"), onClick: () => {} },
      ],
    });
    forget(c.localId);
    c.queue.clearStorage();
    await detach();
    closeToLibrary();
  }

  /* ---------- desfazer / refazer por usuário ---------- */
  async function runUndo(direction) {
    const c = ctx;
    if (!c || !c.perms.canEdit) return false;
    await flush();
    const read = (key) => readField(proj(), key);
    const pop = direction === "undo" ? c.undo.popUndo : c.undo.popRedo;
    let plan = pop.call(c.undo, read);
    if (!plan) return true;
    if (plan.needsConfirm) {
      const ok = await confirmDialog(t("collab.undo.confirm"));
      if (!ok) return true;
      plan = pop.call(c.undo, read, { force: true });
      if (!plan) return true;
    }
    c.skipRecord = { keys: new Set(plan.patches.map((x) => x.key)), entry: plan.entry };
    const p = proj();
    for (const x of plan.patches) {
      if (x.value === undefined || (x.value === null && /:(new)$/.test(x.key))) continue;
      applyField(p, x.key, x.value);
    }
    repaint();
    paintUndo();
    scheduleFlush(50);
    return true;
  }

  /* ---------- compartilhar, convidar, entrar ---------- */
  async function enableForCurrent() {
    const p = proj();
    if (!p) return;
    const email = getAccountEmail();
    if (!email) { ui.toast({ text: t("collab.enable.syncFirst") }); return; }
    const entry = mapEntry(p.id);
    if (entry && ctx) { await openMembers(); return; }
    ui.showMessage({
      title: t("collab.enable.title"), text: t("collab.enable.body"),
      actions: [{ label: t("collab.members.close"), onClick: () => {} }, { label: t("collab.enable.start"), primary: true, onClick: () => void doEnable(p) }],
    });
  }
  async function doEnable(p) {
    ui.toast({ text: t("collab.enable.working") });
    await flushAutosave();
    await syncNow();
    const remoteId = remoteIdFor(p.id);
    if (!remoteId) { ui.toast({ text: t("collab.enable.syncFirst") }); return; }
    const res = await request(`/projects/${encodeURIComponent(remoteId)}/collab/enable`, { method: "POST", body: "{}" });
    if (!res.ok) {
      const code = res.data?.error || res.error;
      if (res.status === 402) return paywall();
      if (code === "local_media_ref") { ui.toast({ text: t("collab.enable.localMedia") }); return; }
      ui.toast({ text: t("collab.invite.errGeneric") });
      return;
    }
    remember(p.id, { remoteId, role: "owner", guest: false, ownerName: "", name: p.name });
    await attach(p.id);
    deps.onTeamChange?.();
    await openMembers();
  }
  /** Dono abrindo em outro aparelho um projeto que já é colaborativo (marca `collab.v` vem da nuvem). */
  function adoptOwned(p) {
    if (!p || mapEntry(p.id) || !(Number(p.collab?.v) >= 1)) return false;
    const remoteId = remoteIdFor(p.id);
    if (!remoteId) return false;
    remember(p.id, { remoteId, role: "owner", guest: false, ownerName: "", name: p.name });
    return true;
  }
  function paywall() {
    ui.showMessage({
      title: t("collab.paywall.title"), text: t("collab.paywall.body"),
      actions: [{ label: t("collab.members.close"), onClick: () => {} }, { label: t("collab.paywall.cta"), primary: true, onClick: () => openUpgrade() }],
    });
  }

  /** Aba Equipe do Compartilhar: lista/convites dentro do painel (sem diálogo). */
  function teamHost() { return typeof document !== "undefined" ? document.getElementById("share-team-host") : null; }
  async function openMembers() {
    if (!ctx) return;
    const c = ctx;
    const data = await refreshMembers();
    const inv = c.perms.canInvite ? await request(`/projects/${encodeURIComponent(c.remoteId)}/collab/invites`, { method: "GET" }) : null;
    const members = (c.members || []).map((m) => ({ ...m, ...(() => { const pr = c.people.find((x) => x.userId === m.userId); return { color: pr?.color || "#1d5fa8", initials: pr?.initials || (m.name || "?").slice(0, 1).toUpperCase() }; })() }));
    const reopen = () => setTimeout(() => void openMembers(), 0);
    ui.openMembers({
      host: teamHost(),
      members, invites: inv?.ok ? inv.data.invites || [] : [], you: data?.you || { userId: c.selfId }, perms: c.perms, canRoleEdit: c.perms.canManageMembers,
      onInvite: async ({ email, role }) => {
        if (!/^\S+@\S+\.\S+$/.test(email)) return { ok: false, message: t("collab.invite.errEmail") };
        const r = await request(`/projects/${encodeURIComponent(c.remoteId)}/collab/invites`, { method: "POST", body: JSON.stringify({ email, role }) });
        if (r.ok) return { ok: true, message: r.data.emailSent ? t("collab.invite.sent", { email }) : t("collab.invite.linkOnly"), link: r.data.emailSent ? "" : r.data.link };
        const code = r.data?.error || r.error;
        if (r.status === 402) { paywall(); return { ok: false, message: t("collab.paywall.title") }; }
        const key = code === "invalid_email" ? "collab.invite.errEmail" : code === "guest_limit" ? "collab.invite.errLimit" : r.status === 429 ? "collab.invite.errRate" : code === "invite_self" ? "collab.invite.errSelf" : "collab.invite.errGeneric";
        return { ok: false, message: t(key) };
      },
      onRole: async (m, role) => { await request(`/projects/${encodeURIComponent(c.remoteId)}/collab/members/${encodeURIComponent(m.userId)}`, { method: "PATCH", body: JSON.stringify({ role }) }); reopen(); },
      onRemove: async (m) => { if (await confirmDialog(t("collab.members.removeConfirm", { name: m.name }))) { await request(`/projects/${encodeURIComponent(c.remoteId)}/collab/members/${encodeURIComponent(m.userId)}`, { method: "DELETE" }); reopen(); } },
      onRevoke: async (i) => { await request(`/projects/${encodeURIComponent(c.remoteId)}/collab/invites/${encodeURIComponent(i.id)}`, { method: "DELETE" }); reopen(); },
      onLeave: async () => {
        if (!(await confirmDialog(t("collab.members.leaveConfirm")))) return;
        await request(`/projects/${encodeURIComponent(c.remoteId)}/collab/members/me`, { method: "DELETE" });
        forget(c.localId);
        await detach();
        closeToLibrary();
      },
    });
  }

  /** `#/join/<token>`: mostra o que vai acontecer, só aceita com clique. */
  function showJoin(token) {
    const roleLabel = "";
    let close = ui.showJoin({ roleLabel, project: "", status: "ready", onAccept: () => void accept(), onLater: () => deps.onJoinDismiss?.() });
    async function accept() {
      close();
      close = ui.showJoin({ status: "busy", onAccept() {} });
      const res = await request("/collab/join", { method: "POST", body: JSON.stringify({ token }), timeoutMs: 20_000 });
      close();
      if (!res.ok) {
        const code = res.data?.error || res.error;
        const key = code === "invite_invalid" || res.status === 410 ? "collab.join.invalid" : code === "invite_email_mismatch" ? "collab.join.mismatch"
          : res.status === 402 ? "collab.join.lapsed" : code === "team_limit" ? "collab.join.teamLimit" : code === "guest_limit" ? "collab.join.guestLimit"
            : res.status === 429 ? "collab.join.rate" : "collab.join.generic";
        ui.showJoin({ status: "error", message: t(key), onLater: () => deps.onJoinDismiss?.() });
        return;
      }
      if (res.data?.accessToken) setSession({ accessToken: res.data.accessToken, email: res.data.user?.email || "" });
      const info = res.data.project;
      const entry = { remoteId: info.id, role: info.role, guest: Boolean(res.data.guest), ownerName: "", name: info.name };
      ui.toast({ text: t("collab.join.done", { name: info.name, project: info.name }) });
      deps.onJoinDismiss?.();
      await openShared({ projectId: info.id, name: info.name, role: info.role, guest: entry.guest });
    }
  }

  /** Abre um projeto compartilhado comigo: cria a cópia local na 1ª vez, depois só abre. */
  async function openShared({ projectId, name, role, guest = null, owner = null }) {
    let localId = findLocalByRemote(projectId);
    if (localId && !(await deps.hasLocal?.(localId))) { forget(localId); localId = null; }
    if (!localId) {
      const res = await request(`/projects/${encodeURIComponent(projectId)}/collab/state`, { method: "GET", timeoutMs: 30_000 });
      if (!res.ok || !res.data?.project) { ui.toast({ text: t("collab.join.generic") }); return; }
      const payload = await toLocalValue(res.data.project.payload || {}, projectId);
      const created = await createLocalProject({ ...payload, name: res.data.project.name || name, steps: Array.isArray(payload.steps) ? payload.steps : [] });
      localId = created.id;
      remember(localId, { remoteId: projectId, role: res.data.role || role, guest: guest ?? true, ownerName: owner?.name || "", name: created.name });
    } else {
      const e = mapEntry(localId);
      remember(localId, { ...e, role: role || e.role });
    }
    await openProjectLocal(localId);
  }

  async function listShared() {
    const res = await request("/collab/shared", { method: "GET" });
    return res.ok ? res.data.projects || [] : [];
  }

  return {
    attach, detach, adoptOwned, onLocalChange, onFieldBlur, onFieldFocus, onFieldInput, onStepSelected, onPageHide,
    undo: () => runUndo("undo"), redo: () => runUndo("redo"),
    enableForCurrent, openMembers, showJoin, openShared, listShared, confirmStepDelete, paywall,
    guestAccount: () => Object.values(readCollabMap(storage)).some((e) => e.guest),
    openComments: (opts) => ctx?.comments?.openPanel(opts),
    /** Link do e-mail (#/comments/<projeto>/<conversa>): abre o projeto e o painel. Devolve false se o projeto não é meu/compartilhado. */
    async openCommentLink({ projectId, threadId }) {
      const localId = findLocalByRemote(projectId);
      if (!localId) return false;
      if (ctx?.remoteId === projectId) { ctx.comments?.openPanel({ threadId }); return true; }
      pendingCommentThread = { projectId, threadId };
      await openProjectLocal(localId);
      return true;
    },
    isActive: () => Boolean(ctx), isCollabLocalId, mapEntry, flush,
    perms: () => ctx?.perms || uiPermissions(null),
    // testes
    _ctx: () => ctx,
  };
}
