import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDemoPayload,
  hotspotAround,
  nextClickAction,
  pointFromClick,
} from "./demo-payload.js";

test("clique no centro vira porcentagem", () => {
  assert.deepEqual(pointFromClick({ x: 500, y: 400, vw: 1000, vh: 800 }), {
    x: 50,
    y: 50,
  });
});

test("clique fora da viewport é limitado à borda", () => {
  assert.deepEqual(pointFromClick({ x: -20, y: 5000, vw: 800, vh: 600 }), {
    x: 0,
    y: 100,
  });
});

test("clique sem viewport não vira ponto", () => {
  assert.equal(pointFromClick({ x: 10, y: 10 }), null);
});

test("destaque perto da borda continua dentro da tela", () => {
  const hotspot = hotspotAround({ x: 1, y: 99 });
  assert.equal(hotspot.x, 0);
  assert.equal(hotspot.y, 92);
  assert.ok(hotspot.x + hotspot.w <= 100);
  assert.equal(hotspot.y + hotspot.h, 100);
});

test("clique depois de Capturar só marca o último passo", () => {
  assert.equal(nextClickAction([{ awaitingHotspot: true }]), "mark");
  assert.equal(nextClickAction([{ awaitingHotspot: false }]), "capture");
  assert.equal(nextClickAction([]), "capture");
});

test("payload liga cada passo à imagem embutida", () => {
  const payload = buildDemoPayload({
    name: "guia-captura",
    shots: [
      {
        imageId: "img-a",
        stepId: "step-a",
        name: "passo-1.jpg",
        label: "Home",
        dataUrl: "data:image/jpeg;base64,aaa",
        addedAt: 10,
        clickPoint: { x: 25, y: 40 },
      },
    ],
  });

  assert.equal(payload.steps.length, 1);
  assert.equal(payload.steps[0].image, "custom:img-a");
  assert.equal(payload.customImages["img-a"].dataUrl, "data:image/jpeg;base64,aaa");
  assert.deepEqual(payload.steps[0].clickPoint, { x: 25, y: 40 });
  assert.equal(payload.steps[0].popover.description, "Edite a explicação deste passo.");
  assert.equal(payload.theme.presetId, "documento");
});

test("passo sem clique usa o centro como destaque", () => {
  const payload = buildDemoPayload({
    name: "guia-captura",
    shots: [
      {
        imageId: "img-b",
        stepId: "step-b",
        dataUrl: "data:image/jpeg;base64,bbb",
        clickPoint: null,
      },
    ],
  });
  assert.deepEqual(payload.steps[0].clickPoint, { x: 47, y: 44 });
});

test("captura sem imagem falha antes de gerar JSON", () => {
  assert.throws(
    () =>
      buildDemoPayload({
        name: "guia-captura",
        shots: [{ imageId: "img-c", stepId: "step-c" }],
      }),
    /Captura incompleta/
  );
});
