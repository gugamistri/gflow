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

test("histórico antigo acima do limite só encolhe na próxima alteração", () => {
  const history = createHistory({ limit: 2 });
  history.restore({ v: 3 }, { undo: [{ v: 0 }, { v: 1 }, { v: 2 }], redo: [{ v: 9 }] });
  assert.deepEqual(history.undoChange({ v: 3 }), { v: 2 });
  assert.deepEqual(history.undoChange({ v: 2 }), { v: 1 });

  const again = createHistory({ limit: 2 });
  again.restore({ v: 3 }, { undo: [{ v: 0 }, { v: 1 }, { v: 2 }], redo: [{ v: 9 }] });
  again.noteChange();
  assert.equal(again.canRedo(), false);
  assert.equal(again.settle({ v: 4 }), true);
  assert.deepEqual(again.exportStacks().undo, [{ v: 2 }, { v: 3 }]);
  assert.deepEqual(again.undoChange({ v: 4 }), { v: 3 });
  assert.deepEqual(again.undoChange({ v: 3 }), { v: 2 });
  assert.equal(again.undoChange({ v: 2 }), null);
});

function heavyImage(char) {
  return "data:image/png;base64," + char.repeat(90);
}

test("o histórico guarda cada imagem uma vez e não copia o dataUrl nos snapshots", () => {
  const history = createHistory();
  const img = heavyImage("A");
  const snap = (v) => ({ v, customImages: { id: { name: "a.png", dataUrl: img } } });
  history.reset(snap(1));
  history.noteChange();
  history.settle(snap(2));
  history.noteChange();
  history.settle(snap(3));
  const saved = history.exportStacks();
  assert.equal(JSON.stringify(saved.undo).includes(img), false);
  assert.equal(JSON.stringify(saved.redo).includes(img), false);
  assert.deepEqual(Object.values(saved.media), [img]);
  const back = history.undoChange(snap(3));
  assert.equal(back.v, 2);
  assert.equal(back.customImages.id.dataUrl, img);
  assert.equal(back.customImages.id.name, "a.png");
});

test("trocar a imagem preserva a anterior no desfazer", () => {
  const history = createHistory();
  const first = heavyImage("A");
  const second = heavyImage("B");
  history.reset({ customImages: { id: { dataUrl: first } }, label: "antes" });
  history.noteChange();
  history.settle({ customImages: { id: { dataUrl: second } }, label: "depois" });
  const back = history.undoChange({ customImages: { id: { dataUrl: second } }, label: "depois" });
  assert.equal(back.customImages.id.dataUrl, first);
  assert.equal(back.label, "antes");
  const forward = history.redoChange();
  assert.equal(forward.customImages.id.dataUrl, second);
  const saved = history.exportStacks();
  assert.equal(JSON.stringify(saved.undo).includes(first), false);
  assert.equal(JSON.stringify(saved.undo).includes(second), false);
  assert.deepEqual(Object.values(saved.media), [first]);
});

test("imagem que saiu do limite some do pool exportado e o restore reidrata", () => {
  const history = createHistory({ limit: 1 });
  const snap = (v, char) => ({
    v,
    customImages: { id: { dataUrl: heavyImage(char) } },
    steps: [{ narrationAudio: { clips: ["data:audio/mpeg;base64," + char.repeat(80)] } }],
  });
  history.reset(snap(0, "A"));
  history.noteChange();
  history.settle(snap(1, "B"));
  history.noteChange();
  history.settle(snap(2, "C"));
  const saved = history.exportStacks();
  assert.equal(JSON.stringify(saved.undo).includes("data:image"), false);
  assert.equal(JSON.stringify(saved.undo).includes("data:audio"), false);
  assert.deepEqual(Object.values(saved.media).sort(), [heavyImage("B"), "data:audio/mpeg;base64," + "B".repeat(80)].sort());

  const again = createHistory({ limit: 1 });
  again.restore(snap(2, "C"), saved);
  const back = again.undoChange(snap(2, "C"));
  assert.equal(back.v, 1);
  assert.equal(back.customImages.id.dataUrl, heavyImage("B"));
  assert.equal(back.steps[0].narrationAudio.clips[0], "data:audio/mpeg;base64," + "B".repeat(80));
  const redone = again.redoChange();
  assert.equal(redone.v, 2);
  assert.equal(redone.customImages.id.dataUrl, heavyImage("C"));
});
