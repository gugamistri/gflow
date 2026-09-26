import assert from "node:assert/strict";
import test from "node:test";
import { computeZoomCamera, zoomCameraCss, zoomCameraStyle } from "./zoomHighlight.js";

test("sem zoom devolve identidade", () => {
  const cam = computeZoomCamera({ x: 10, y: 10, w: 5, h: 5 }, { w: 800, h: 600 }, { w: 1000, h: 700 }, false);
  assert.equal(cam.scale, 1);
  assert.equal(cam.translateX, 0);
  assert.equal(cam.translateY, 0);
  assert.equal(zoomCameraCss(cam), "none");
});

test("destaque pequeno amplia até o teto anti-pixelação", () => {
  const cam = computeZoomCamera({ x: 40, y: 40, w: 5, h: 5 }, { w: 800, h: 600 }, { w: 800, h: 600 }, true);
  // fit = min(800/40, 600/30) * 0.55 = 11 → teto 3.2
  assert.equal(cam.scale, 3.2);
});

test("barra larga e baixa também amplia (encaixe pelo menor eixo)", () => {
  // ~31% x 5.7% como o passo "Botões de edição"
  const cam = computeZoomCamera(
    { x: 20, y: 8, w: 31, h: 5.7 },
    { w: 1127, h: 642 },
    { w: 1470, h: 746 },
    true
  );
  assert.ok(cam.scale > 1.5, `scale=${cam.scale}`);
  assert.ok(cam.scale <= 3.2);
});

test("destaque já enorme não amplia", () => {
  const cam = computeZoomCamera({ x: 5, y: 5, w: 90, h: 90 }, { w: 800, h: 600 }, { w: 800, h: 600 }, true);
  assert.equal(cam.scale, 1);
});

test("hotspot no canto desloca para centralizar o recorte", () => {
  const cam = computeZoomCamera({ x: 0, y: 0, w: 10, h: 10 }, { w: 1000, h: 800 }, { w: 800, h: 600 }, true);
  assert.ok(cam.scale > 1);
  assert.ok(cam.translateX > 0);
  assert.ok(cam.translateY > 0);
});

test("zoomCameraStyle usa translate + scale com origem no centro", () => {
  const style = zoomCameraStyle({ scale: 2, translateX: 40, translateY: -20 });
  assert.equal(style.transform, "translate(40px, -20px) scale(2)");
  assert.equal(style.transformOrigin, "center center");
});
