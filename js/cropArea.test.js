import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  cropMatchesStep,
  cropOutputSize,
  isFullCrop,
  normalizeCropRect,
  pointFromCrop,
  pointToCrop,
  readStepCrop,
  remapStepGeometry,
  stripCropMeta,
} from "./cropArea.js";
import { deleteCropOriginalsForProject, getCropOriginal, putCropOriginal } from "./cropStore.js";
import { embedImagesInDemo } from "./exportPack.js";
import { prepareSharePayload } from "./shareSnapshot.js";
import { defaultTheme } from "./themes.js";
import { defaultNarration, defaultPlayback } from "./playback.js";

const near = (a, b, eps = 0.02) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
const nearRect = (a, b) => ["x", "y", "w", "h"].forEach((k) => near(a[k], b[k]));

test("normalizeCropRect: mínimo de 5 %, presa na imagem", () => {
  assert.deepEqual(normalizeCropRect({ x: 90, y: 90, w: 30, h: 30 }), { x: 90, y: 90, w: 10, h: 10 });
  assert.deepEqual(normalizeCropRect({ x: 50, y: 50, w: -20, h: -20 }), { x: 30, y: 30, w: 20, h: 20 });
  assert.equal(normalizeCropRect({ x: 1, y: 1, w: 4, h: 50 }), null);
  assert.equal(normalizeCropRect(null), null);
  assert.equal(isFullCrop({ x: 0, y: 0, w: 100, h: 100 }), true);
  assert.equal(isFullCrop({ x: 0, y: 0, w: 90, h: 100 }), false);
});

test("ponto ida e volta pelo recorte", () => {
  const crop = { x: 20, y: 10, w: 50, h: 40 };
  const p = { x: 45, y: 30 };
  const q = pointToCrop(p, crop);
  assert.deepEqual(q, { x: 50, y: 50 });
  assert.deepEqual(pointFromCrop(q, crop), p);
});

test("remap: destaque e clique acompanham o recorte e voltam na tela inteira", () => {
  const step = { hotspot: { x: 40, y: 40, w: 10, h: 10 }, clickPoint: { x: 45, y: 45 } };
  const crop = { x: 30, y: 30, w: 40, h: 40 };
  remapStepGeometry(step, null, crop);
  nearRect(step.hotspot, { x: 25, y: 25, w: 25, h: 25 });
  assert.deepEqual(step.clickPoint, { x: 37.5, y: 37.5 });
  remapStepGeometry(step, crop, null);
  nearRect(step.hotspot, { x: 40, y: 40, w: 10, h: 10 });
  near(step.clickPoint.x, 45);
  near(step.clickPoint.y, 45);
});

test("remap de um recorte para outro = voltar à tela inteira e recortar de novo", () => {
  const a = { x: 10, y: 10, w: 60, h: 60 };
  const b = { x: 30, y: 20, w: 50, h: 50 };
  const s1 = { hotspot: { x: 50, y: 50, w: 10, h: 10 }, clickPoint: { x: 55, y: 55 } };
  const s2 = structuredClone(s1);
  remapStepGeometry(s1, a, b);
  remapStepGeometry(s2, a, null);
  remapStepGeometry(s2, null, b);
  nearRect(s1.hotspot, s2.hotspot);
  near(s1.clickPoint.x, s2.clickPoint.x);
});

test("destaque fora do recorte fica preso na borda e não some; clique fica dentro dele", () => {
  const step = { hotspot: { x: 80, y: 80, w: 10, h: 10 }, clickPoint: { x: 85, y: 85 } };
  remapStepGeometry(step, null, { x: 0, y: 0, w: 50, h: 50 });
  assert.ok(step.hotspot.w >= 2 && step.hotspot.h >= 2);
  assert.ok(step.hotspot.x + step.hotspot.w <= 100 && step.hotspot.y + step.hotspot.h <= 100);
  const hs = step.hotspot;
  assert.ok(step.clickPoint.x >= hs.x && step.clickPoint.x <= hs.x + hs.w);
  assert.ok(step.clickPoint.y >= hs.y && step.clickPoint.y <= hs.y + hs.h);
});

test("passo sem destaque nem clique (galeria, tour antigo) não ganha campos", () => {
  const step = { id: "s", type: "screen", image: "custom:a" };
  remapStepGeometry(step, null, { x: 10, y: 10, w: 50, h: 50 });
  assert.deepEqual(step, { id: "s", type: "screen", image: "custom:a" });
});

test("recorte é ampliado até o tamanho do print, mantendo a proporção", () => {
  assert.deepEqual(cropOutputSize(1280, 720, { x: 25, y: 25, w: 50, h: 50 }), { sx: 320, sy: 180, sw: 640, sh: 360, width: 1280, height: 720 });
  const tall = cropOutputSize(1280, 720, { x: 0, y: 0, w: 20, h: 100 });
  assert.equal(tall.height, 720);
  assert.equal(tall.width, 256);
});

test("ficha do passo: tour antigo sem crop", () => {
  assert.equal(readStepCrop({ image: "custom:a" }), null);
  assert.equal(cropMatchesStep({ image: "custom:a" }), false);
  const step = { image: "custom:k", crop: { id: "crp0001", key: "k", rect: { x: 1, y: 1, w: 50, h: 50 } } };
  assert.equal(cropMatchesStep(step), true);
  step.image = "custom:z";
  assert.equal(cropMatchesStep(step), false);
  assert.deepEqual(stripCropMeta({ steps: [{ id: "x" }] }), { steps: [{ id: "x" }] });
});

function project(steps, customImages, mode) {
  const p = { id: "p1", name: "qa-crop", theme: defaultTheme(), customImages, steps, sceneLabels: {}, playback: defaultPlayback(), narration: defaultNarration() };
  if (mode) p.playback.mode = mode;
  return p;
}

test("snapshot publicado: só o recorte, sem ficha nem print inteiro", async () => {
  const p = project([{ id: "s1", type: "screen", image: "custom:k", crop: { id: "crp0001", key: "k", rect: { x: 1, y: 1, w: 50, h: 50 } } }], { k: { name: "a", dataUrl: "data:image/png;base64,Q1JPUA==" } });
  const out = await embedImagesInDemo(prepareSharePayload(p));
  assert.equal(out.steps[0].image, "data:image/png;base64,Q1JPUA==");
  assert.equal(out.steps[0].crop, undefined);
  assert.ok(p.steps[0].crop);
});

test("snapshot de tour antigo (guia e galeria) não muda", async () => {
  for (const mode of [undefined, "gallery"]) {
    const step = { id: "s1", type: "screen", image: "custom:k", hotspot: { x: 1, y: 2, w: 3, h: 4 }, clickPoint: { x: 2, y: 3 } };
    const out = await embedImagesInDemo(prepareSharePayload(project([structuredClone(step)], { k: { name: "a", dataUrl: "data:image/png;base64,QQ==" } }, mode)));
    assert.deepEqual(out.steps, [{ ...step, image: "data:image/png;base64,QQ==" }]);
    assert.equal(out.playback.mode, mode);
  }
});

test("prints inteiros ficam no IndexedDB local e somem com o projeto", async () => {
  await putCropOriginal("crpA", { bytes: new Uint8Array([9, 8]), mime: "image/png", projectId: "p-a" });
  assert.deepEqual([...(await getCropOriginal("crpA")).bytes], [9, 8]);
  assert.equal(await deleteCropOriginalsForProject("p-a"), 1);
  assert.equal(await getCropOriginal("crpA"), null);
});

test("textos (pt/en/es) sem palavras proibidas", () => {
  const lines = readFileSync(new URL("./i18n.js", import.meta.url), "utf8").split("\n").filter((l) => /"crop\./.test(l));
  assert.equal(lines.length, 27);
  for (const l of lines) assert.ok(!/plataforma|intelig[eê]ncia|ecossistema|potencializar|platform|intelligence|ecosystem|empower/i.test(l), l);
});

test("desfoque + enquadramento juntos: o snapshot publicado não leva nenhuma das fichas", async () => {
  const step = {
    id: "s1",
    type: "screen",
    image: "custom:k",
    crop: { id: "crp0001", key: "k", rect: { x: 10, y: 10, w: 50, h: 50 } },
    blur: { id: "blr0001", key: "k", rects: [{ x: 1, y: 1, w: 10, h: 10 }] },
  };
  for (const mode of [undefined, "gallery"]) {
    const out = await embedImagesInDemo(prepareSharePayload(project([structuredClone(step)], { k: { name: "a", dataUrl: "data:image/png;base64,QkxVUg==" } }, mode)));
    assert.equal(out.steps[0].image, "data:image/png;base64,QkxVUg==");
    assert.equal(out.steps[0].crop, undefined);
    assert.equal(out.steps[0].blur, undefined);
  }
});
