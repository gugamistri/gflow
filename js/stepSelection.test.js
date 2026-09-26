import assert from "node:assert/strict";
import test from "node:test";
import {
  collectStepsForClipboard,
  deleteIndices,
  moveIndices,
  normalizeIndices,
  rangeIndices,
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
