import { createMediaPool } from "./mediaPool.js";

const DEFAULT_LIMIT = 20;

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function createHistory({ limit = DEFAULT_LIMIT, pool } = {}) {
  const media = pool || createMediaPool();
  let undo = [];
  let redo = [];
  let committed = null;
  let burst = false;
  let legacyOverLimit = false;

  function trim(stack) {
    if (stack.length > limit) stack.splice(0, stack.length - limit);
  }

  function remember(state) {
    return state == null ? null : media.pack(state);
  }

  function publish(state) {
    return state == null ? null : media.unpack(state);
  }

  function syncPool() {
    const held = [];
    if (committed) held.push(committed);
    held.push(...undo, ...redo);
    media.retain(held);
  }

  function reset(state) {
    undo = [];
    redo = [];
    committed = remember(state);
    burst = false;
    legacyOverLimit = false;
    syncPool();
  }

  function noteChange() {
    if (committed == null) return;
    if (!burst) {
      burst = true;
      redo = [];
      syncPool();
    }
  }

  function settle(current) {
    if (!burst || committed == null || current == null) return false;
    burst = false;
    const next = remember(current);
    if (same(committed, next)) {
      syncPool();
      return false;
    }
    undo.push(committed);
    legacyOverLimit = false;
    trim(undo);
    trim(redo);
    committed = next;
    syncPool();
    return true;
  }

  function undoChange(current) {
    if (committed == null) return null;
    if (burst) {
      burst = false;
      if (current == null) return null;
      const now = remember(current);
      if (same(committed, now)) {
        syncPool();
        return null;
      }
      redo.push(now);
      syncPool();
      return publish(committed);
    }
    if (!undo.length) return null;
    redo.push(committed);
    committed = undo.pop();
    syncPool();
    return publish(committed);
  }

  function redoChange() {
    if (burst || !redo.length || committed == null) return null;
    undo.push(committed);
    if (!legacyOverLimit) trim(undo);
    committed = redo.pop();
    syncPool();
    return publish(committed);
  }

  function canUndo() {
    return burst || undo.length > 0;
  }

  function canRedo() {
    return !burst && redo.length > 0;
  }

  function exportStacks() {
    return {
      undo: undo.map((entry) => media.pack(entry)),
      redo: redo.map((entry) => media.pack(entry)),
      media: media.exportMedia([...undo, ...redo]),
    };
  }

  function restore(state, saved) {
    media.importMedia(saved?.media);
    committed = remember(state);
    burst = false;
    const keep = (entry) => entry && typeof entry === "object";
    // why: um projeto salvo acima do limite segue desfazível até a próxima edição
    undo = Array.isArray(saved?.undo) ? saved.undo.filter(keep).map((entry) => remember(entry)) : [];
    redo = Array.isArray(saved?.redo) ? saved.redo.filter(keep).map((entry) => remember(entry)) : [];
    legacyOverLimit = undo.length > limit || redo.length > limit;
    syncPool();
  }

  return { reset, noteChange, settle, undoChange, redoChange, canUndo, canRedo, exportStacks, restore };
}
