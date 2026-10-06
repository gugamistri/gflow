import assert from "node:assert/strict";
import test from "node:test";
import {
  arrowSelection,
  captionVisibilityState,
  collectStepsForClipboard,
  deleteIndices,
  moveIndices,
  nextCaptionVisibility,
  normalizeIndices,
  nudgeBlockInsert,
  rangeIndices,
  resolvePlayPlaylist,
  toggleIndex,
} from "./stepSelection.js";

test("normalizeIndices ordena e remove inválidos", () => {
  assert.deepEqual(normalizeIndices([3, 1, 3, -1, 9], 4), [1, 3]);
});

test("toggleIndex adiciona e remove, nunca fica vazio", () => {
  assert.deepEqual(toggleIndex([1], 2, 4), [1, 2]);
  assert.deepEqual(toggleIndex([1, 2], 1, 4), [2]);
  assert.deepEqual(toggleIndex([1], 1, 4), [1]);
});

test("rangeIndices cobre o intervalo inclusive", () => {
  assert.deepEqual(rangeIndices(1, 3, 5), [1, 2, 3]);
  assert.deepEqual(rangeIndices(3, 1, 5), [1, 2, 3]);
});

test("deleteIndices remove o bloco e sugere primary", () => {
  const steps = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  const out = deleteIndices(steps, [1, 2]);
  assert.deepEqual(
    out.steps.map((s) => s.id),
    ["a", "d"]
  );
  assert.equal(out.primary, 1);
});

test("moveIndices desloca o bloco preservando ordem relativa", () => {
  const steps = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }];
  const out = moveIndices(steps, [1, 2], 4);
  assert.deepEqual(
    out.steps.map((s) => s.id),
    ["a", "d", "b", "c", "e"]
  );
  assert.deepEqual(out.selected, [2, 3]);
});

test("moveIndices para o início e atribui cena", () => {
  const steps = [
    { id: "a", scene: 1 },
    { id: "b", scene: 1 },
    { id: "c", scene: 2 },
  ];
  const out = moveIndices(steps, [2], 0, 1);
  assert.equal(out.steps[0].id, "c");
  assert.equal(out.steps[0].scene, 1);
  assert.deepEqual(out.selected, [0]);
});

test("arrowSelection sem shift seleciona só o vizinho e move a âncora", () => {
  assert.deepEqual(arrowSelection({ anchor: 1, active: 1, length: 5, delta: 1, extend: false }), {
    indices: [2],
    anchor: 2,
    active: 2,
  });
  assert.deepEqual(arrowSelection({ anchor: 0, active: 3, length: 5, delta: -1, extend: false }), {
    indices: [2],
    anchor: 2,
    active: 2,
  });
});

test("arrowSelection com shift estende e encolhe a partir da âncora", () => {
  assert.deepEqual(arrowSelection({ anchor: 1, active: 3, length: 6, delta: 1, extend: true }), {
    indices: [1, 2, 3, 4],
    anchor: 1,
    active: 4,
  });
  assert.deepEqual(arrowSelection({ anchor: 1, active: 4, length: 6, delta: -1, extend: true }), {
    indices: [1, 2, 3],
    anchor: 1,
    active: 3,
  });
  assert.deepEqual(arrowSelection({ anchor: 2, active: 2, length: 5, delta: -1, extend: true }), {
    indices: [1, 2],
    anchor: 2,
    active: 1,
  });
});

test("arrowSelection não passa das bordas", () => {
  assert.deepEqual(arrowSelection({ anchor: 0, active: 0, length: 3, delta: -1, extend: false }), {
    indices: [0],
    anchor: 0,
    active: 0,
  });
  assert.deepEqual(arrowSelection({ anchor: 0, active: 2, length: 3, delta: 1, extend: true }), {
    indices: [0, 1, 2],
    anchor: 0,
    active: 2,
  });
  assert.deepEqual(arrowSelection({ length: 0, delta: 1, extend: true }), {
    indices: [],
    anchor: 0,
    active: 0,
  });
});

test("nudgeBlockInsert só desloca bloco contíguo", () => {
  assert.equal(nudgeBlockInsert([1, 2], -1, 5), 0);
  assert.equal(nudgeBlockInsert([1, 2], 1, 5), 4);
  assert.equal(nudgeBlockInsert([0], -1, 5), null);
  assert.equal(nudgeBlockInsert([4], 1, 5), null);
  assert.equal(nudgeBlockInsert([0, 2], -1, 5), null);
  const steps = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  const up = moveIndices(steps, [1, 2], nudgeBlockInsert([1, 2], -1, steps.length));
  assert.deepEqual(
    up.steps.map((s) => s.id),
    ["b", "c", "a", "d"]
  );
  const down = moveIndices(steps, [1, 2], nudgeBlockInsert([1, 2], 1, steps.length));
  assert.deepEqual(
    down.steps.map((s) => s.id),
    ["a", "d", "b", "c"]
  );
});

test("captionVisibilityState trata misto e o padrão visível", () => {
  const steps = [{ showCaption: true }, { showCaption: false }, {}];
  assert.equal(captionVisibilityState(steps, [0, 2]), "on");
  assert.equal(captionVisibilityState(steps, [1]), "off");
  assert.equal(captionVisibilityState(steps, [0, 1]), "mixed");
  assert.equal(nextCaptionVisibility("on"), false);
  assert.equal(nextCaptionVisibility("off"), true);
  assert.equal(nextCaptionVisibility("mixed"), true);
});

test("resolvePlayPlaylist limita à seleção ordenada e preserva o tour inteiro", () => {
  assert.deepEqual(resolvePlayPlaylist(6, { from: 4, indices: [4, 1, 4, 9] }), {
    order: [1, 4],
    start: 0,
  });
  assert.deepEqual(resolvePlayPlaylist(6, { from: 2 }), {
    order: [0, 1, 2, 3, 4, 5],
    start: 2,
  });
  assert.deepEqual(resolvePlayPlaylist(3, { from: 1, indices: [] }), {
    order: [0, 1, 2],
    start: 1,
  });
  assert.deepEqual(resolvePlayPlaylist(3, { from: 9 }), {
    order: [0, 1, 2],
    start: 2,
  });
  assert.deepEqual(resolvePlayPlaylist(0, { indices: [0] }), { order: [], start: 0 });
});

test("collectStepsForClipboard inclui imagens custom", () => {
  const { steps, images } = collectStepsForClipboard(
    [
      { id: "1", image: "custom:img-a" },
      { id: "2", image: "" },
      { id: "3", image: "custom:img-b" },
    ],
    [0, 2],
    {
      "img-a": { name: "a.png", dataUrl: "data:a" },
      "img-b": { name: "b.png", dataUrl: "data:b" },
    }
  );
  assert.equal(steps.length, 2);
  assert.equal(images["img-a"].dataUrl, "data:a");
  assert.equal(images["img-b"].dataUrl, "data:b");
});
