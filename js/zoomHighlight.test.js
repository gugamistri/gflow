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

// ---- câmera com área segura + zoom do visitante ----
import {
  clampPan,
  computeSafeZoomCamera,
  hotspotScreenRect,
  isDoubleTap,
  maxUserScale,
  panAxisRange,
  pinchCamera,
  safeAreaRect,
} from "./zoomHighlight.js";

const inside = (r, safe, eps = 0.5) =>
  r.left >= safe.left - eps && r.right <= safe.right + eps && r.top >= safe.top - eps && r.bottom <= safe.bottom + eps;

// Celular em pé 390×844: controles no topo, legenda + balão embaixo (como o tour MCMV de teste)
const PHONE = { left: 0, top: 0, right: 390, bottom: 844 };
const PHONE_CHROME = [
  { left: 170, top: 12, right: 378, bottom: 56 }, // controles
  { left: 12, top: 12, right: 160, bottom: 50 }, // aviso "Toque fora para sair"
  { left: 8, top: 560, right: 382, bottom: 610 }, // legenda
  { left: 8, top: 618, right: 382, bottom: 836 }, // balão
];

test("safeAreaRect corta controles no topo e legenda/balão embaixo", () => {
  const safe = safeAreaRect(PHONE, PHONE_CHROME);
  assert.equal(safe.top, 62);
  assert.equal(safe.bottom, 554);
  assert.equal(safe.left, 0);
  assert.equal(safe.right, 390);
});

test("safeAreaRect ignora peças fora da área ou vazias", () => {
  const base = { left: 0, top: 0, right: 100, bottom: 100 };
  assert.deepEqual(safeAreaRect(base, [null, { left: 200, top: 0, right: 300, bottom: 50 }, { left: 10, top: 10, right: 10, bottom: 40 }]), base);
});

test("passo 7 (terraço no alto da planta): o close-up mostra o destaque inteiro na área segura", () => {
  const safe = safeAreaRect(PHONE, PHONE_CHROME);
  // planta 2641×2178 contida em 374 px de largura, centralizada na área livre
  const w = 374;
  const h = (374 * 2178) / 2641;
  const frame = { cx: 195, cy: (safe.top + safe.bottom) / 2, w, h };
  const hotspot = { x: 4, y: 6, w: 34, h: 15 };
  const cam = computeSafeZoomCamera(hotspot, frame, safe);
  assert.ok(cam.scale > 1.2, `scale=${cam.scale}`);
  const r = hotspotScreenRect(hotspot, frame, cam);
  assert.ok(inside(r, safe), JSON.stringify({ r, safe, cam }));
});

test("o close-up antigo (palco inteiro) deixava o terraço sob os controles — o novo não", () => {
  const safe = safeAreaRect(PHONE, PHONE_CHROME);
  const w = 374;
  const h = (374 * 2178) / 2641;
  // layout antigo: foto alinhada no topo (padding 56px), câmera medida no palco todo
  const frame = { cx: 195, cy: 56 + h / 2, w, h };
  const hotspot = { x: 4, y: 6, w: 34, h: 15 };
  const old = computeZoomCamera(hotspot, { w, h }, { w: 390, h: 844 }, true);
  const oldRect = hotspotScreenRect(hotspot, frame, old);
  assert.ok(!inside(oldRect, safe), "o caso antigo deveria reproduzir o corte");
  const cam = computeSafeZoomCamera(hotspot, frame, safe);
  assert.ok(inside(hotspotScreenRect(hotspot, frame, cam), safe));
});

test("destaque em qualquer canto fica inteiro na área segura", () => {
  const safe = { left: 8, top: 62, right: 382, bottom: 554 };
  const frame = { cx: 195, cy: 308, w: 374, h: 280 };
  const spots = [
    { x: 0, y: 0, w: 20, h: 10 },
    { x: 80, y: 0, w: 20, h: 10 },
    { x: 0, y: 90, w: 20, h: 10 },
    { x: 80, y: 90, w: 20, h: 10 },
    { x: 45, y: 45, w: 2, h: 2 },
    { x: 0, y: 40, w: 100, h: 8 },
  ];
  for (const hs of spots) {
    const cam = computeSafeZoomCamera(hs, frame, safe);
    assert.ok(cam.scale >= 1 && cam.scale <= 3.2, `scale=${cam.scale}`);
    assert.ok(inside(hotspotScreenRect(hs, frame, cam), safe), JSON.stringify({ hs, cam }));
  }
});

test("destaque maior que a área: sem zoom (1×) e sem empurrar a foto", () => {
  const safe = { left: 0, top: 0, right: 400, bottom: 300 };
  const frame = { cx: 200, cy: 150, w: 400, h: 300 };
  const cam = computeSafeZoomCamera({ x: 0, y: 0, w: 100, h: 100 }, frame, safe);
  assert.equal(cam.scale, 1);
  assert.equal(cam.translateX, 0);
  assert.equal(cam.translateY, 0);
});

test("sem medidas válidas a câmera segura fica em 1×", () => {
  assert.deepEqual(computeSafeZoomCamera({ x: 1, y: 1, w: 1, h: 1 }, null, null), { scale: 1, translateX: 0, translateY: 0 });
  assert.deepEqual(
    computeSafeZoomCamera({ x: 1, y: 1, w: 1, h: 1 }, { cx: 0, cy: 0, w: 0, h: 0 }, { left: 0, top: 0, right: 10, bottom: 10 }),
    { scale: 1, translateX: 0, translateY: 0 }
  );
});

test("desktop: área segura = palco, close-up continua parecido com o antigo", () => {
  const imageSize = { w: 1000, h: 600 };
  const stage = { w: 1200, h: 700 };
  const hs = { x: 40, y: 40, w: 10, h: 10 };
  const old = computeZoomCamera(hs, imageSize, stage, true);
  const frame = { cx: 600, cy: 350, w: 1000, h: 600 };
  const cam = computeSafeZoomCamera(hs, frame, { left: 0, top: 0, right: 1200, bottom: 700 });
  assert.ok(Math.abs(cam.scale - old.scale) < 1e-9);
  assert.ok(Math.abs(cam.translateX - old.translateX) < 1e-6);
  assert.ok(Math.abs(cam.translateY - old.translateY) < 1e-6);
});

test("panAxisRange: maior que a área cobre; menor fica dentro", () => {
  assert.deepEqual(panAxisRange(0, 100, 50, 200), [-50, 50]);
  assert.deepEqual(panAxisRange(0, 100, 50, 60), [-20, 20]);
  assert.deepEqual(panAxisRange(0, 100, 50, 100), [0, 0]);
});

test("clampPan: a foto ampliada não sai da área nem deixa faixa vazia", () => {
  const frame = { cx: 195, cy: 300, w: 374, h: 300 };
  const safe = { left: 8, top: 62, right: 382, bottom: 554 };
  const far = clampPan({ scale: 3, translateX: 5000, translateY: -5000 }, frame, safe);
  const left = frame.cx + far.translateX - (3 * frame.w) / 2;
  const bottom = frame.cy + far.translateY + (3 * frame.h) / 2;
  assert.ok(left <= safe.left + 1e-9);
  assert.ok(bottom >= safe.bottom - 1e-9);
  const one = clampPan({ scale: 1, translateX: 0, translateY: 0 }, frame, safe);
  assert.equal(one.translateX, 0);
  assert.equal(one.translateY, 0);
  assert.equal(clampPan({ scale: 0.3, translateX: 0, translateY: 0 }, frame, safe).scale, 1);
});

test("pinchCamera: o ponto sob os dedos fica sob os dedos e a escala respeita o teto", () => {
  const frame = { cx: 200, cy: 300, w: 400, h: 300 };
  const start = { scale: 1, translateX: 0, translateY: 0 };
  const mid = { x: 260, y: 340 };
  const cam = pinchCamera(start, mid, 100, mid, 250, frame, { maxScale: 4 });
  assert.equal(cam.scale, 2.5);
  // ponto da foto que estava em `mid` (em 1×) continua em `mid`
  const sx = frame.cx + cam.translateX + cam.scale * (mid.x - frame.cx);
  const sy = frame.cy + cam.translateY + cam.scale * (mid.y - frame.cy);
  assert.ok(Math.abs(sx - mid.x) < 1e-6 && Math.abs(sy - mid.y) < 1e-6, JSON.stringify({ sx, sy }));
  assert.equal(pinchCamera(start, mid, 100, mid, 10000, frame, { maxScale: 4 }).scale, 4);
  assert.equal(pinchCamera(start, mid, 100, mid, 10, frame, { maxScale: 4 }).scale, 1);
});

test("pinchCamera segue os dedos quando eles andam juntos (arrastar com dois dedos)", () => {
  const frame = { cx: 200, cy: 300, w: 400, h: 300 };
  const cam = pinchCamera({ scale: 2, translateX: 0, translateY: 0 }, { x: 200, y: 300 }, 100, { x: 230, y: 280 }, 100, frame);
  assert.equal(cam.scale, 2);
  assert.equal(cam.translateX, 30);
  assert.equal(cam.translateY, -20);
});

test("isDoubleTap: rápido e perto sim; devagar ou longe não", () => {
  const a = { x: 100, y: 100, at: 1000 };
  assert.equal(isDoubleTap(a, { x: 110, y: 105, at: 1200 }), true);
  assert.equal(isDoubleTap(a, { x: 110, y: 105, at: 1500 }), false);
  assert.equal(isDoubleTap(a, { x: 200, y: 100, at: 1100 }), false);
  assert.equal(isDoubleTap(null, a), false);
});

test("maxUserScale vai até a resolução da foto, entre 3× e 6×", () => {
  assert.equal(maxUserScale(2641, 374), 6);
  assert.equal(maxUserScale(776, 374), 3);
  assert.equal(maxUserScale(1500, 374), 1500 / 374);
  assert.equal(maxUserScale(0, 0), 3);
});

test("destaque grande que já aparece inteiro: sem close-up de quase 1× (a foto não sacode)", () => {
  const safe = { left: 8, top: 66, right: 382, bottom: 510 };
  const frame = { cx: 195, cy: 284, w: 374, h: 293 };
  const cam = computeSafeZoomCamera({ x: 36, y: 12, w: 56, h: 70 }, frame, safe);
  assert.deepEqual(cam, { scale: 1, translateX: 0, translateY: 0 });
});
