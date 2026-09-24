import assert from "node:assert/strict";
import test from "node:test";
import { createHistory } from "./history.js";

test("uma rajada de edições vira um único desfazer", () => {
  const history = createHistory();
  const base = { name: "A", n: 1 };
  history.reset(base);
  history.noteChange();
  base.n = 2;
  history.noteChange();
  base.n = 3;
  assert.equal(history.settle(base), true);
  assert.equal(history.canUndo(), true);
  assert.equal(history.canRedo(), false);

  const restored = history.undoChange(base);
  assert.deepEqual(restored, { name: "A", n: 1 });
  assert.equal(history.canUndo(), false);
  assert.equal(history.canRedo(), true);
});

test("desfazer no meio da rajada volta ao estado anterior", () => {
  const history = createHistory();
  const base = { label: "ok" };
  history.reset(base);
  history.noteChange();
  const current = { label: "errado" };
  const restored = history.undoChange(current);
  assert.deepEqual(restored, { label: "ok" });
  assert.equal(history.canRedo(), true);
  assert.deepEqual(history.redoChange(), { label: "errado" });
});

test("editar de novo apaga o refazer", () => {
  const history = createHistory();
  history.reset({ v: 1 });
  history.noteChange();
  history.settle({ v: 2 });
  history.undoChange({ v: 2 });
  assert.equal(history.canRedo(), true);
  history.noteChange();
  assert.equal(history.canRedo(), false);
  history.settle({ v: 3 });
  assert.equal(history.redoChange(), null);
});

test("as pilhas sobrevivem a um histórico novo", () => {
  const history = createHistory();
  history.reset({ v: 1 });
  history.noteChange();
  history.settle({ v: 2 });
  history.undoChange({ v: 2 });
  const saved = history.exportStacks();

  const again = createHistory();
  again.restore({ v: 1 }, saved);
  assert.equal(again.canUndo(), false);
  assert.equal(again.canRedo(), true);
  assert.deepEqual(again.redoChange(), { v: 2 });
});

test("restaurar ignora pilhas inválidas", () => {
  const history = createHistory();
  history.restore({ v: 1 }, { undo: [null, 4, { v: 0 }], redo: "nope" });
  assert.deepEqual(history.undoChange({ v: 1 }), { v: 0 });
  assert.equal(history.canRedo(), true);
});

test("o histórico descarta o passo mais antigo acima do limite", () => {
  const history = createHistory({ limit: 2 });
  history.reset({ v: 0 });
  history.noteChange();
  history.settle({ v: 1 });
  history.noteChange();
  history.settle({ v: 2 });
  history.noteChange();
  history.settle({ v: 3 });
  assert.deepEqual(history.undoChange({ v: 3 }), { v: 2 });
  assert.deepEqual(history.undoChange({ v: 2 }), { v: 1 });
  assert.equal(history.undoChange({ v: 1 }), null);
});
