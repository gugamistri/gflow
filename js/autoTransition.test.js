import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTO_TRANSITION_MAX_MS,
  AUTO_TRANSITION_MS,
  DIFF_GRID,
  autoTransitionsMode,
  cameraFrame,
  cameraPlan,
  changedRegion,
  dissolvePlan,
  readCameraView,
  sameAspect,
} from "./autoTransition.js";
import { cropGroupFor, stripCropMeta } from "./cropArea.js";
import { defaultPlayback, newProjectPlayback } from "./playback.js";
import { createEmptyProject } from "./projects.js";
import { clickRevealPlan } from "./tour-schema/clickTransition.js";

const { w: W, h: H } = DIFF_GRID;
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

function screen(fill = 240) {
  return new Float32Array(W * H).fill(fill);
}
function paint(lum, x0, y0, w, h, v) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) lum[y * W + x] = v;
  return lum;
}

test("liga só em tour novo, nunca na galeria; ?transitions= compara no preview", () => {
  assert.equal(defaultPlayback().autoTransitions, undefined, "tour antigo sem playback não ganha a flag");
  assert.equal(newProjectPlayback().autoTransitions, true);
  assert.equal(createEmptyProject({ name: "qa" }).playback.autoTransitions, true, "projeto novo nasce com a flag");
  assert.equal(autoTransitionsMode({ playback: newProjectPlayback() }, ""), "on");
  // tour antigo: sem a flag
  assert.equal(autoTransitionsMode({ playback: { defaultHoldSeconds: 6 } }, ""), "off");
  assert.equal(autoTransitionsMode({}, ""), "off");
  assert.equal(autoTransitionsMode({ playback: newProjectPlayback() }, "?transitions=off"), "off");
  assert.equal(autoTransitionsMode({ playback: { defaultHoldSeconds: 6 } }, "?transitions=on"), "on");
  // galeria: nem forçando
  assert.equal(autoTransitionsMode({ playback: { ...newProjectPlayback(), mode: "gallery" } }, "?transitions=on"), "off");
});

test("câmera: só entre recortes do mesmo print, com recortes diferentes", () => {
  const a = { id: "a", type: "screen", crop: { group: "abcdef0123456789", rect: { x: 0, y: 0, w: 50, h: 50 } } };
  const b = { id: "b", type: "screen", crop: { group: "abcdef0123456789", rect: { x: 40, y: 30, w: 60, h: 70 } } };
  const plan = cameraPlan(a, b);
  assert.equal(plan.kind, "camera");
  assert.ok(plan.ms > 0 && plan.ms <= AUTO_TRANSITION_MAX_MS);
  assert.equal(AUTO_TRANSITION_MS <= 600, true);
  assert.equal(cameraPlan(a, structuredClone(a)), null, "mesmo recorte");
  assert.equal(cameraPlan(a, { ...b, crop: { ...b.crop, group: "ffffffff00000000" } }), null, "outro print");
  assert.equal(cameraPlan(a, { id: "c", type: "screen" }), null, "passo sem recorte (tour antigo)");
  assert.equal(cameraPlan(a, { ...b, type: "slide" }), null);
  // ficha estragada não vira câmera
  assert.equal(readCameraView({ crop: { group: "x", rect: b.crop.rect } }), null);
  assert.equal(readCameraView({ crop: { group: "abcdef0123456789", rect: { x: 80, y: 0, w: 40, h: 10 } } }), null);
});

test("câmera: o mesmo ponto do print fica no mesmo lugar da tela em todo quadro", () => {
  const from = { x: 0, y: 0, w: 50, h: 50 };
  const to = { x: 40, y: 30, w: 60, h: 70 };
  const boxA = { left: 100, top: 50, width: 800, height: 450 };
  const boxB = { left: 120, top: 40, width: 700, height: 470 };
  const f0 = cameraFrame(from, to, boxA, boxB, 0);
  assert.deepEqual(f0.view, boxA);
  ["left", "top", "width", "height"].forEach((k) => near(f0.a[k], boxA[k]));
  const f1 = cameraFrame(from, to, boxA, boxB, 1);
  ["left", "top", "width", "height"].forEach((k) => near(f1.b[k], boxB[k]));
  for (const t of [0.25, 0.5, 0.75]) {
    const f = cameraFrame(from, to, boxA, boxB, t);
    // ponto (45%, 40%) do print está dentro dos dois recortes: tem que cair no mesmo pixel nas duas imagens
    const p = { x: 45, y: 40 };
    const ax = f.a.left + ((p.x - from.x) / from.w) * f.a.width;
    const bx = f.b.left + ((p.x - to.x) / to.w) * f.b.width;
    const ay = f.a.top + ((p.y - from.y) / from.h) * f.a.height;
    const by = f.b.top + ((p.y - to.y) / to.h) * f.b.height;
    near(ax, bx, 1e-6);
    near(ay, by, 1e-6);
  }
});

test("troca do que mudou: campo preenchido vira fade só na caixa", () => {
  const a = paint(screen(), 0, 0, W, 10, 40); // cabeçalho escuro
  const b = paint(paint(screen(), 0, 0, W, 10, 40), 60, 40, 30, 4, 30); // texto novo num campo
  const d = changedRegion(a, b);
  assert.equal(d.kind, "region");
  assert.ok(d.box.x <= (60 / W) * 100 && d.box.x + d.box.w >= (90 / W) * 100);
  assert.ok(d.box.y <= (40 / H) * 100 && d.box.y + d.box.h >= (44 / H) * 100);
  assert.ok(d.box.w * d.box.h < 1000, "caixa pequena");
  const plan = dissolvePlan(d);
  assert.equal(plan.kind, "dissolve");
  assert.ok(plan.ms <= 600);
});

test("tela inteira diferente → fallback (revelação do clique)", () => {
  const a = screen(240);
  const b = paint(screen(240), 0, 0, W, H / 2, 20);
  const d = changedRegion(a, b);
  assert.equal(d.kind, "large");
  assert.equal(dissolvePlan(d), null);
  // e o fallback é o círculo que já existe, partindo do clique
  const reveal = clickRevealPlan({ type: "screen", clickPoint: { x: 30, y: 40 } }, { preview: true });
  assert.deepEqual(reveal, { xPct: 30, yPct: 40, ms: 400 });
});

test("mudanças espalhadas (caixa grande, pouca área) → fallback", () => {
  const a = screen();
  const b = paint(paint(screen(), 2, 2, 6, 6, 0), W - 8, H - 8, 6, 6, 0);
  assert.equal(changedRegion(a, b).kind, "large");
});

test("ruído solto (compressão) é ignorado; imagens iguais = troca sem efeito", () => {
  const a = screen();
  const b = screen();
  for (let i = 0; i < 40; i++) b[(i * 997) % (W * H)] = 0; // pontos isolados
  assert.deepEqual(changedRegion(a, b), { kind: "same" });
  assert.deepEqual(dissolvePlan({ kind: "same" }), { kind: "same" });
  // leve variação de cor (antialias / WebP) abaixo do limite
  const c = screen().map((v, i) => v + ((i % 7) - 3) * 3);
  assert.deepEqual(changedRegion(a, c), { kind: "same" });
});

test("leitura falhou ou tamanhos diferentes → fallback", () => {
  assert.equal(changedRegion(null, screen()).kind, "large");
  assert.equal(changedRegion(screen(), new Float32Array(10)).kind, "large");
  assert.equal(dissolvePlan(null), null);
  assert.equal(sameAspect(1280, 720, 1920, 1080), true);
  assert.equal(sameAspect(1280, 720, 1047, 720), false);
});

test("snapshot publicado leva só { group, rect } do recorte", async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const g1 = await cropGroupFor(bytes, "p1");
  assert.match(g1, /^[0-9a-f]{16}$/);
  assert.equal(await cropGroupFor(bytes, "p1"), g1, "mesmo print = mesmo grupo");
  assert.notEqual(await cropGroupFor(bytes, "p2"), g1, "outro projeto = outro grupo");
  assert.notEqual(await cropGroupFor(new Uint8Array([1, 2, 4]), "p1"), g1);
  const demo = {
    steps: [
      { id: "a", crop: { id: "crp0001", key: "k", rect: { x: 0, y: 0, w: 50, h: 50 }, group: g1 } },
      { id: "b", crop: { id: "crp0002", key: "k2", rect: { x: 0, y: 0, w: 50, h: 50 } } },
      { id: "c" },
    ],
  };
  stripCropMeta(demo);
  assert.deepEqual(demo.steps[0].crop, { group: g1, rect: { x: 0, y: 0, w: 50, h: 50 } });
  assert.equal("crop" in demo.steps[1], false);
  assert.deepEqual(demo.steps[2], { id: "c" });
});
