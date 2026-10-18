/**
 * Desfazer/refazer só das MINHAS ações, em projetos colaborativos (history.js continua no modo local).
 * Cada entrada guarda patches inversos por campo (`prev` que o servidor devolveu em `applied`), não
 * snapshots: 50 ações ≈ poucos KB e o desfazer nunca reverte o trabalho de outra pessoa.
 *
 * Entrada: { ops: [{ key, value, prev }] } (value = o que eu escrevi; prev = o que havia antes).
 * `undo(readValue)`: para cada campo, se o valor atual ainda é o que eu escrevi → inverso limpo;
 * se outra pessoa mudou depois → vira `conflicts` (a UI confirma; confirmar sobrescreve).
 */
import { sameValue } from "./collabModel.js";

export const UNDO_LIMIT = 50;

export function createCollabUndo({ limit = UNDO_LIMIT } = {}) {
  let undo = [];
  let redo = [];
  let open = null; // ação em montagem (várias ops enviadas em lotes seguidos)

  const trim = (list) => {
    if (list.length > limit) list.splice(0, list.length - limit);
  };

  /** Registra o resultado de um lote enviado (applied do servidor). `group`: junta lotes da mesma ação. */
  function record(applied, { group = false } = {}) {
    const ops = applied.filter((a) => a && a.key).map((a) => ({ key: a.key, value: a.value, prev: a.prev ?? null }));
    if (!ops.length) return;
    if (group && open) {
      for (const op of ops) {
        const same = open.ops.find((o) => o.key === op.key);
        if (same) same.value = op.value; // mantém o prev original da ação
        else open.ops.push(op);
      }
    } else {
      open = { ops };
      undo.push(open);
      trim(undo);
    }
    redo = [];
  }

  /** Fecha a ação em montagem (próxima gravação começa outra). */
  function seal() {
    open = null;
  }

  const plan = (entry, readValue, forward) => {
    const patches = [];
    const conflicts = [];
    for (const op of entry.ops) {
      const expected = forward ? op.prev : op.value; // o que deveria estar lá agora
      const target = forward ? op.value : op.prev;
      const current = readValue(op.key);
      const patch = { key: op.key, value: target };
      if (!sameValue(current, expected)) conflicts.push({ key: op.key, current, expected, target });
      patches.push(patch);
    }
    return { patches, conflicts };
  };

  /** Prévia sem consumir: o que o desfazer faria e o que mudou depois. */
  function peekUndo(readValue) {
    const entry = undo[undo.length - 1];
    return entry ? plan(entry, readValue, false) : null;
  }
  function peekRedo(readValue) {
    const entry = redo[redo.length - 1];
    return entry ? plan(entry, readValue, true) : null;
  }

  /** Consome e devolve os patches. `force=false` com conflitos devolve `needsConfirm` sem consumir. */
  function popUndo(readValue, { force = false } = {}) {
    const entry = undo[undo.length - 1];
    if (!entry) return null;
    const p = plan(entry, readValue, false);
    if (p.conflicts.length && !force) return { needsConfirm: true, ...p };
    undo.pop();
    redo.push(entry);
    open = null;
    return { needsConfirm: false, ...p, entry };
  }
  function popRedo(readValue, { force = false } = {}) {
    const entry = redo[redo.length - 1];
    if (!entry) return null;
    const p = plan(entry, readValue, true);
    if (p.conflicts.length && !force) return { needsConfirm: true, ...p };
    redo.pop();
    undo.push(entry);
    open = null;
    return { needsConfirm: false, ...p, entry };
  }

  /** Depois de enviar os patches do desfazer: o `prev` novo (valor logo antes) mantém o refazer correto. */
  function afterApply(entry, applied) {
    for (const op of entry.ops) {
      const a = applied.find((x) => x.key === op.key);
      if (a) op.lastRev = a.rev;
    }
  }

  /** Passo apagado por outro: descarta entradas que dependem dele. */
  function dropForStep(stepId) {
    const keep = (e) => !e.ops.some((o) => o.key.startsWith(`s:${stepId}:`));
    undo = undo.filter(keep);
    redo = redo.filter(keep);
  }

  return {
    record, seal, peekUndo, peekRedo, popUndo, popRedo, afterApply, dropForStep,
    canUndo: () => undo.length > 0,
    canRedo: () => redo.length > 0,
    clear() { undo = []; redo = []; open = null; },
    size: () => ({ undo: undo.length, redo: redo.length }),
    // para testes e persistência leve
    exportStacks: () => ({ undo: structuredClone(undo), redo: structuredClone(redo) }),
  };
}
