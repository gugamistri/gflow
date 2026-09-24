import assert from "node:assert/strict";
import test from "node:test";
import { insertSceneAfter, moveScene, renumberScenes } from "./scenes.js";

test("reenumera as cenas pela ordem em que aparecem", () => {
  const demo = {
    steps: [
      { id: "a", scene: 7 },
      { id: "b", scene: 2 },
      { id: "c", scene: 2 },
      { id: "d", scene: 4 },
      { id: "e", scene: 8 },
    ],
    sceneLabels: { 7: "RSRREREW", 2: "Editor", 4: "Captura", 8: "2323332323" },
  };

  assert.equal(renumberScenes(demo), true);
  assert.deepEqual(demo.steps.map((step) => step.scene), [1, 2, 2, 3, 4]);
  assert.deepEqual(demo.sceneLabels, {
    1: "RSRREREW",
    2: "Editor",
    3: "Captura",
    4: "2323332323",
  });
  assert.equal(renumberScenes(demo), false);
});

test("inserir cena entra depois do bloco atual e a lista segue 1..N", () => {
  const demo = {
    steps: [
      { id: "a", scene: 1 },
      { id: "b", scene: 2 },
      { id: "c", scene: 2 },
      { id: "d", scene: 3 },
    ],
    sceneLabels: { 1: "Um", 2: "Dois", 3: "Três" },
  };
  const created = { id: "novo", scene: 1 };

  const index = insertSceneAfter(demo, 2, created, "Nova");

  assert.equal(index, 3);
  assert.deepEqual(demo.steps.map((step) => step.id), ["a", "b", "c", "novo", "d"]);
  assert.deepEqual(demo.steps.map((step) => step.scene), [1, 2, 2, 3, 4]);
  assert.equal(demo.sceneLabels[3], "Nova");
  assert.equal(demo.sceneLabels[4], "Três");
});

test("mover uma cena leva o bloco inteiro e reenumera", () => {
  const demo = {
    steps: [
      { id: "a", scene: 1 },
      { id: "b", scene: 2 },
      { id: "c", scene: 2 },
      { id: "d", scene: 3 },
    ],
    sceneLabels: { 1: "Um", 2: "Dois", 3: "Três" },
  };

  assert.equal(moveScene(demo, 3, 1, "before"), true);
  assert.deepEqual(demo.steps.map((step) => step.id), ["d", "a", "b", "c"]);
  assert.deepEqual(demo.steps.map((step) => step.scene), [1, 2, 3, 3]);
  assert.deepEqual(demo.sceneLabels, { 1: "Três", 2: "Um", 3: "Dois" });
  assert.equal(moveScene(demo, 2, 2, "after"), false);
});
