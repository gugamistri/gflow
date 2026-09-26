import assert from "node:assert/strict";
import test from "node:test";
import { appendCaptureToProject, cloneStepForPaste } from "./stepClipboard.js";

test("cloneStepForPaste gera id novo e remapeia custom image", () => {
  let n = 0;
  const { step, images } = cloneStepForPaste(
    {
      id: "step-old",
      type: "screen",
      image: "custom:img-a",
      hotspot: { x: 10, y: 10, w: 8, h: 6 },
    },
    { "img-a": { name: "a.jpg", dataUrl: "data:image/jpeg;base64,aa" } },
    () => "img-new-" + ++n
  );
  assert.notEqual(step.id, "step-old");
  assert.equal(step.image, "custom:img-new-1");
  assert.equal(images["img-new-1"].dataUrl, "data:image/jpeg;base64,aa");
});

test("cloneStepForPaste preserva slide sem imagem custom", () => {
  const { step, images } = cloneStepForPaste(
    { id: "s1", type: "slide", image: "", popover: { title: "Oi" } },
    {}
  );
  assert.notEqual(step.id, "s1");
  assert.equal(step.type, "slide");
  assert.deepEqual(images, {});
});

test("appendCaptureToProject acrescenta cena nova sem apagar passos", () => {
  const project = {
    steps: [{ id: "a", scene: 1, type: "slide", image: "" }],
    customImages: {},
    sceneLabels: { "1": "Intro" },
  };
  const result = appendCaptureToProject(
    project,
    {
      name: "Captura",
      sceneLabels: { 1: "Captura" },
      customImages: {
        "img-x": { name: "x.jpg", dataUrl: "data:image/jpeg;base64,xx" },
      },
      steps: [
        {
          id: "cap-1",
          scene: 1,
          type: "screen",
          image: "custom:img-x",
          hotspot: { x: 40, y: 40, w: 12, h: 8 },
        },
      ],
    },
    {
      createStepId: () => "step-pasted",
      makeImageId: () => "img-pasted",
    }
  );
  assert.equal(result.inserted, 1);
  assert.equal(result.startIndex, 1);
  assert.equal(project.steps.length, 2);
  assert.equal(project.steps[0].id, "a");
  assert.equal(project.steps[1].id, "step-pasted");
  assert.equal(project.steps[1].scene, 2);
  assert.equal(project.steps[1].image, "custom:img-pasted");
  assert.ok(project.customImages["img-pasted"]);
  assert.equal(project.sceneLabels["2"], "Captura");
  assert.equal(project.sceneLabels["1"], "Intro");
});

test("appendCaptureToProject recusa payload vazio", () => {
  assert.throws(() => appendCaptureToProject({ steps: [] }, { steps: [] }));
});
