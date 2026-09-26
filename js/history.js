const DEFAULT_LIMIT = 20;

function clone(value) {
  return structuredClone(value);
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function createHistory({ limit = DEFAULT_LIMIT } = {}) {
  let undo = [];
  let redo = [];
  let committed = null;
  let burst = false;
  let legacyOverLimit = false;

  function trim(stack) {
    if (stack.length > limit) stack.splice(0, stack.length - limit);
  }

  function reset(state) {
    undo = [];
    redo = [];
    committed = state == null ? null : clone(state);
    burst = false;
    legacyOverLimit = false;
  }

  function noteChange() {
    if (committed == null) return;
    if (!burst) {
      burst = true;
      redo = [];
    }
  }

  function settle(current) {
    if (!burst || committed == null || current == null) return false;
    burst = false;
    const next = clone(current);
    if (same(committed, next)) return false;
    undo.push(committed);
    legacyOverLimit = false;
    trim(undo);
    trim(redo);
    committed = next;
    return true;
  }

  function undoChange(current) {
    if (committed == null) return null;
    if (burst) {
      burst = false;
      if (current == null) return null;
      const now = clone(current);
      if (same(committed, now)) return null;
      redo.push(now);
      return clone(committed);
    }
    if (!undo.length) return null;
    redo.push(committed);
    committed = undo.pop();
    return clone(committed);
  }

  function redoChange() {
    if (burst || !redo.length || committed == null) return null;
    undo.push(committed);
    if (!legacyOverLimit) trim(undo);
    committed = redo.pop();
    return clone(committed);
  }

  function canUndo() {
    return burst || undo.length > 0;
  }

  function canRedo() {
    return !burst && redo.length > 0;
  }

  function exportStacks() {
    return { undo: undo.map(clone), redo: redo.map(clone) };
  }

  function restore(state, saved) {
    committed = state == null ? null : clone(state);
    burst = false;
    const keep = (entry) => entry && typeof entry === "object";
    // why: um projeto salvo acima do limite segue desfazível até a próxima edição
    undo = Array.isArray(saved?.undo) ? saved.undo.filter(keep).map(clone) : [];
    redo = Array.isArray(saved?.redo) ? saved.redo.filter(keep).map(clone) : [];
    legacyOverLimit = undo.length > limit || redo.length > limit;
  }

  return { reset, noteChange, settle, undoChange, redoChange, canUndo, canRedo, exportStacks, restore };
}
