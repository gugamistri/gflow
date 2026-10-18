/**
 * Fila de ops do cliente colaborativo (Fase 1): última escrita vence por campo.
 *
 * Fluxo: o controlador chama `observe(snapshot)` a cada mudança local; a fila compara com o último
 * snapshot visto e guarda UMA op pendente por campo (a última). `takeBatch()` manda para o servidor
 * (`baseRev` = rev do campo que o cliente conhece) e `settle()` interpreta a resposta. Offline, as
 * pendentes ficam (persistidas) e vão no próximo envio.
 *
 * Regra de ouro (Figma): o valor remoto NUNCA sobrescreve um campo com op local não confirmada. Esse
 * caso vira `conflict` e a UI decide (mostrar versão dela / manter a minha).
 */
import { diffSnapshots, parseKey, sameValue, snapshotProject, stepIdOf, stepKey } from "./collabModel.js";

export const MAX_BATCH = 50;
const RETRY_LOCKED_MAX = 5;

export function createOpQueue({ storage = null, storageKey = "", now = () => Date.now() } = {}) {
  let shadow = new Map(); // último estado confirmado pelo servidor (forma local)
  let seen = new Map(); // último snapshot do projeto local observado
  let revs = {}; // chave → rev conhecida
  const pending = new Map(); // chave → { value, baseRev, tries }
  let inflight = new Map(); // chave → { value, baseRev }
  const conflicts = new Map(); // chave → { mine, theirs, rev, by }
  const deleted = new Set(); // ids de passos apagados (tombstones conhecidos)
  let frozen = false; // papel perdido: nada mais sai

  function persist() {
    if (!storage || !storageKey) return;
    try {
      storage.setItem(storageKey, JSON.stringify({
        v: 1, at: now(), revs,
        pending: [...pending].map(([key, p]) => ({ key, value: p.value, baseRev: p.baseRev })),
        inflight: [...inflight].map(([key, p]) => ({ key, value: p.value, baseRev: p.baseRev })),
      }));
    } catch { /* cota cheia: a fila segue em memória */ }
  }

  function restore() {
    if (!storage || !storageKey) return 0;
    try {
      const data = JSON.parse(storage.getItem(storageKey) || "null");
      if (!data || data.v !== 1) return 0;
      let n = 0;
      for (const p of [...(data.inflight || []), ...(data.pending || [])]) {
        if (!parseKey(p.key) || pending.has(p.key)) continue;
        pending.set(p.key, { value: p.value, baseRev: Number(p.baseRev) || 0, tries: 0 });
        n += 1;
      }
      return n;
    } catch {
      return 0;
    }
  }

  function clearStorage() {
    try { storage?.removeItem(storageKey); } catch { /* ignore */ }
  }

  /** Estado inicial vindo do servidor (resync completo). */
  function init(snapshot, fieldRevs = {}, { tombstones = [] } = {}) {
    shadow = new Map(snapshot);
    seen = new Map(snapshot);
    revs = Object.fromEntries(Object.entries(fieldRevs).map(([k, v]) => [k, Number(v?.rev ?? v) || 0]));
    deleted.clear();
    for (const id of tombstones) deleted.add(id);
    frozen = false;
  }

  const revOf = (key) => revs[key] ?? 0;

  /** Campos de passos que o servidor já conhece (via `new`) passam a ser "confirmados" com o valor visto. */
  function adoptStepFields() {
    for (const [key, value] of seen) {
      const id = stepIdOf(key);
      if (!id || shadow.has(key) || pending.has(key) || inflight.has(key)) continue;
      if (shadow.has(stepKey(id, "new"))) shadow.set(key, value);
    }
  }

  /** Compara o projeto atual com o último visto e enfileira o que mudou. Devolve as chaves tocadas. */
  function observe(current) {
    const ops = diffSnapshots(seen, current);
    const touched = [];
    const dropStep = (id) => {
      for (const key of [...pending.keys()]) if (stepIdOf(key) === id) pending.delete(key);
    };
    for (const op of ops) {
      const k = parseKey(op.key);
      if (k?.kind === "step" && k.field === "new" && deleted.has(k.stepId)) {
        // desfazer apagar: o passo volta com o mesmo id → restaura o tombstone em vez de criar
        pending.set(stepKey(k.stepId, "del"), { value: false, baseRev: revOf(stepKey(k.stepId, "del")), tries: 0 });
        pending.delete(op.key);
        touched.push(stepKey(k.stepId, "del"));
        continue;
      }
      if (k?.kind === "step" && k.field === "del" && op.value === true) {
        const own = pending.get(stepKey(k.stepId, "new"));
        if (own) { // criado e apagado antes de enviar: nunca existiu para o servidor
          dropStep(k.stepId);
          continue;
        }
        dropStep(k.stepId);
      }
      if (k?.kind === "step" && k.field !== "new" && k.field !== "del" && pending.has(stepKey(k.stepId, "new"))) {
        pending.set(stepKey(k.stepId, "new"), { ...pending.get(stepKey(k.stepId, "new")), value: current.get(stepKey(k.stepId, "new")) });
        continue;
      }
      const conflict = conflicts.get(op.key);
      if (conflict) { // a pessoa voltou a editar o campo em conflito: "manter a minha" implícito
        conflict.mine = op.value;
        continue;
      }
      if (sameValue(op.value, shadow.get(op.key)) && !inflight.has(op.key) && !(k?.field === "new")) {
        pending.delete(op.key);
      } else {
        pending.set(op.key, { value: op.value, baseRev: pending.get(op.key)?.baseRev ?? revOf(op.key), tries: 0 });
      }
      touched.push(op.key);
    }
    seen = new Map(current);
    if (touched.length) persist();
    return touched;
  }

  /** Pendentes → envio. Marca como em voo. Ordem: `new`, campos, `pos`, `del`. */
  function takeBatch(max = MAX_BATCH) {
    if (frozen || inflight.size) return [];
    const order = (key) => {
      const f = parseKey(key)?.field;
      return f === "new" ? 0 : f === "del" ? 3 : f === "pos" ? 2 : 1;
    };
    const keys = [...pending.keys()].filter((key) => !conflicts.has(key)).sort((a, b) => order(a) - order(b)).slice(0, max);
    const batch = [];
    for (const key of keys) {
      const p = pending.get(key);
      pending.delete(key);
      inflight.set(key, { value: p.value, baseRev: p.baseRev, tries: p.tries });
      batch.push({ key, baseRev: p.baseRev, value: p.value });
    }
    return batch;
  }

  /**
   * Interpreta a resposta de /ops.
   * @returns {{applied:Array, conflicts:Array, dropped:Array, deletedSteps:string[], retry:boolean}}
   */
  function settle(batch, res) {
    const out = { applied: [], conflicts: [], dropped: [], deletedSteps: [], retry: false };
    const sent = new Map(batch.map((b) => [b.key, b]));
    const answered = new Set();
    for (const a of res.applied || []) {
      const op = sent.get(a.key);
      if (!op) continue;
      answered.add(a.key);
      shadow.set(a.key, op.value);
      revs[a.key] = a.rev;
      const k = parseKey(a.key);
      if (k?.kind === "step" && k.field === "del") {
        if (op.value) deleted.add(k.stepId);
        else deleted.delete(k.stepId);
      }
      if (k?.kind === "step" && k.field === "new") deleted.delete(k.stepId);
      out.applied.push({ key: a.key, rev: a.rev, value: op.value, prev: a.prev ?? null });
    }
    for (const r of res.rejected || []) {
      const op = sent.get(r.key);
      if (!op) continue;
      answered.add(r.key);
      if (r.reason === "stale") {
        revs[r.key] = Number(r.rev) || revOf(r.key);
        conflicts.set(r.key, { mine: op.value, theirs: r.serverValue ?? null, rev: revs[r.key], by: null });
        out.conflicts.push({ key: r.key, mine: op.value, theirs: r.serverValue ?? null, rev: revs[r.key] });
      } else if (r.reason === "locked_by") {
        const tries = (op.tries || 0) + 1;
        if (tries <= RETRY_LOCKED_MAX) {
          pending.set(r.key, { value: op.value, baseRev: op.baseRev, tries });
          out.retry = true;
        } else out.dropped.push({ key: r.key, reason: r.reason });
      } else {
        if (r.reason === "step_deleted" || r.reason === "unknown_step") {
          const id = stepIdOf(r.key);
          if (id) out.deletedSteps.push(id);
        }
        out.dropped.push({ key: r.key, reason: r.reason });
      }
    }
    for (const key of sent.keys()) if (!answered.has(key)) pending.set(key, { value: sent.get(key).value, baseRev: sent.get(key).baseRev, tries: 0 });
    inflight = new Map();
    adoptStepFields();
    // quem foi aceito pode ter mudado de novo enquanto voava: observe() já cuidou (pending novo)
    persist();
    return out;
  }

  /** Falha de rede/5xx: devolve o que estava em voo, sem perder nada. */
  function fail(batch) {
    for (const op of batch) if (!pending.has(op.key)) pending.set(op.key, { value: op.value, baseRev: op.baseRev, tries: 0 });
    inflight = new Map();
    persist();
  }

  /** Papel perdido (403) ou projeto removido: nada mais sai; as pendentes ficam para "salvar cópia". */
  function freeze() {
    frozen = true;
    for (const [key, p] of inflight) if (!pending.has(key)) pending.set(key, p);
    inflight = new Map();
    persist();
  }

  /**
   * Op de outra pessoa (evento `ops`). `apply: true` → o controlador pode escrever no projeto;
   * `conflict` → há op local não confirmada nesse campo: não sobrescrever.
   */
  function remote(op, by = null) {
    const { key, value, rev } = op;
    const mine = pending.has(key) ? pending.get(key) : inflight.has(key) ? inflight.get(key) : null;
    const k = parseKey(key);
    if (mine && !(k?.field === "del" && value === true)) {
      if (sameValue(mine.value, value)) {
        shadow.set(key, value);
        revs[key] = rev;
        pending.delete(key);
        return { apply: false, same: true, key };
      }
      revs[key] = rev;
      conflicts.set(key, { mine: mine.value, theirs: value, rev, by });
      pending.delete(key);
      return { apply: false, conflict: true, key, mine: mine.value, theirs: value, rev, by };
    }
    if (k?.field === "del" && value === true) for (const p of [...pending.keys()]) if (stepIdOf(p) === k.stepId) pending.delete(p);
    shadow.set(key, value);
    revs[key] = rev;
    if (k?.kind === "step" && k.field === "del") {
      if (value) deleted.add(k.stepId);
      else deleted.delete(k.stepId);
    }
    if (k?.kind === "step" && k.field === "new") deleted.delete(k.stepId);
    return { apply: true, key, value, rev, by };
  }

  /** Depois de escrever no projeto: o "visto" acompanha para o diff não achar que foi edição local. */
  function markSeen(current) {
    seen = new Map(current);
    adoptStepFields();
  }

  /** "Manter a minha": reenvia com a rev nova. */
  function keepMine(key) {
    const c = conflicts.get(key);
    if (!c) return false;
    conflicts.delete(key);
    pending.set(key, { value: c.mine, baseRev: revOf(key), tries: 0 });
    persist();
    return true;
  }

  /** "Ver versão dela" / aceitar o servidor: descarta a minha. */
  function acceptTheirs(key) {
    const c = conflicts.get(key);
    if (!c) return null;
    conflicts.delete(key);
    pending.delete(key);
    shadow.set(key, c.theirs);
    persist();
    return c.theirs;
  }

  /**
   * Estado completo do servidor (início, reconexão, `resync`). `serverSnapshot` já hidratado.
   * @returns {{apply:Array<{key,value}>, conflicts:Array}} mudanças para escrever no projeto
   */
  function resync(serverSnapshot, fieldRevs = {}, { tombstones = [] } = {}) {
    const remoteOps = diffSnapshots(shadow, serverSnapshot);
    const nextRevs = Object.fromEntries(Object.entries(fieldRevs).map(([k, v]) => [k, Number(v?.rev ?? v) || 0]));
    const apply = [];
    const found = [];
    for (const op of remoteOps) {
      const mine = pending.get(op.key) || inflight.get(op.key);
      if (mine) {
        if (!sameValue(mine.value, op.value)) {
          conflicts.set(op.key, { mine: mine.value, theirs: op.value, rev: nextRevs[op.key] ?? 0, by: null });
          pending.delete(op.key);
          found.push({ key: op.key, mine: mine.value, theirs: op.value });
        } else pending.delete(op.key);
        continue;
      }
      apply.push(op);
    }
    // pendentes cuja rev no servidor não mudou seguem; as demais já viraram conflito acima
    for (const [key, p] of pending) {
      const cur = nextRevs[key] ?? 0;
      if (cur !== p.baseRev) {
        if (sameValue(serverSnapshot.get(key), p.value)) pending.delete(key);
        else if (serverSnapshot.has(key) && !conflicts.has(key)) {
          conflicts.set(key, { mine: p.value, theirs: serverSnapshot.get(key), rev: cur, by: null });
          pending.delete(key);
          found.push({ key, mine: p.value, theirs: serverSnapshot.get(key) });
        } else p.baseRev = cur;
      }
    }
    inflight = new Map();
    shadow = new Map(serverSnapshot);
    revs = nextRevs;
    deleted.clear();
    for (const id of tombstones) deleted.add(id);
    persist();
    return { apply, conflicts: found };
  }

  /** Depois de init(): pendentes restauradas (offline) cuja rev no servidor mudou viram conflito (ou somem se iguais). */
  function reconcile() {
    const found = [];
    for (const [key, p] of [...pending]) {
      const cur = revOf(key);
      if (cur === p.baseRev) continue;
      const theirs = shadow.get(key);
      if (sameValue(theirs, p.value)) pending.delete(key);
      else if (shadow.has(key) || key.endsWith(":del")) {
        conflicts.set(key, { mine: p.value, theirs: theirs ?? null, rev: cur, by: null });
        pending.delete(key);
        found.push({ key, mine: p.value, theirs: theirs ?? null });
      } else p.baseRev = cur;
    }
    persist();
    return found;
  }

  return {
    init, reconcile, shadowSnapshot: () => new Map(shadow), restore, clearStorage, observe, takeBatch, settle, fail, freeze, remote, markSeen, keepMine, acceptTheirs, resync,
    revOf,
    shadowValue: (key) => shadow.get(key),
    pendingCount: () => pending.size + inflight.size,
    pendingKeys: () => [...pending.keys(), ...inflight.keys()],
    hasPending: (key) => pending.has(key) || inflight.has(key),
    conflictFor: (key) => conflicts.get(key) || null,
    conflictKeys: () => [...conflicts.keys()],
    isFrozen: () => frozen,
    isDeleted: (id) => deleted.has(id),
    snapshotOf: snapshotProject,
  };
}
