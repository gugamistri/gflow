import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  MAX_BLUR_RECTS,
  applyBlurRects,
  blurMatchesStep,
  blurRadiusFor,
  blurRectToPixels,
  customImageUsers,
  moveBlurRect,
  normalizeBlurRect,
  normalizeBlurRects,
  readStepBlur,
  stripBlurMeta,
} from "./blurArea.js";
import { deleteBlurOriginalsForProject, getBlurOriginal, putBlurOriginal } from "./blurStore.js";
import { embedImagesInDemo } from "./exportPack.js";
import { prepareSharePayload } from "./shareSnapshot.js";
import { defaultTheme } from "./themes.js";
import { defaultNarration, defaultPlayback } from "./playback.js";
import { readFileSync } from "node:fs";

/** Imagem sintética: fundo branco e "texto" (traços pretos de 2 px em glifos 8×12, como fonte de 12 px). */
function syntheticText(width = 640, height = 360, seed = 7) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let line = 20; line + 12 < height; line += 22) {
    for (let x = 10; x + 8 < width - 10; x += 10) {
      if (rnd() < 0.15) continue; // espaço entre "palavras"
      for (let k = 0; k < 4; k += 1) {
        const vertical = rnd() < 0.5;
        const ox = x + Math.floor(rnd() * 6);
        const oy = line + Math.floor(rnd() * 10);
        for (let i = 0; i < (vertical ? 12 : 8); i += 1) {
          for (let t = 0; t < 2; t += 1) {
            const px = vertical ? ox + t : ox + i;
            const py = vertical ? oy + i : oy + t;
            if (px >= width || py >= height) continue;
            const o = (py * width + px) * 4;
            data[o] = data[o + 1] = data[o + 2] = 0;
          }
        }
      }
    }
  }
  return { data, width, height };
}

function region(img, px) {
  const out = [];
  for (let y = px.y0; y < px.y1; y += 1) for (let x = px.x0; x < px.x1; x += 1) out.push(img.data[(y * img.width + x) * 4]);
  return { values: out, w: px.x1 - px.x0, h: px.y1 - px.y0 };
}

/** Energia de alta frequência (soma |vizinho − pixel|): é o que torna texto legível. */
function edgeEnergy({ values, w, h }) {
  let e = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const v = values[y * w + x];
      if (x + 1 < w) e += Math.abs(values[y * w + x + 1] - v);
      if (y + 1 < h) e += Math.abs(values[(y + 1) * w + x] - v);
    }
  }
  return e;
}

const sha = (u8) => createHash("sha256").update(u8).digest("hex");

test("normalizeBlurRect: prende na imagem, aceita arraste ao contrário, descarta minúsculo", () => {
  assert.deepEqual(normalizeBlurRect({ x: 90, y: 90, w: 30, h: 30 }), { x: 90, y: 90, w: 10, h: 10 });
  assert.deepEqual(normalizeBlurRect({ x: 50, y: 50, w: -20, h: -10 }), { x: 30, y: 40, w: 20, h: 10 });
  assert.equal(normalizeBlurRect({ x: 1, y: 1, w: 0.1, h: 20 }), null);
  assert.equal(normalizeBlurRect({ x: "a", y: 1, w: 3, h: 3 }), null);
  assert.equal(normalizeBlurRect(null), null);
  const many = Array.from({ length: 40 }, () => ({ x: 1, y: 1, w: 5, h: 5 }));
  assert.equal(normalizeBlurRects(many).length, MAX_BLUR_RECTS);
});

test("moveBlurRect não deixa sair da imagem", () => {
  assert.deepEqual(moveBlurRect({ x: 80, y: 10, w: 15, h: 10 }, 30, -50), { x: 85, y: 0, w: 15, h: 10 });
});

test("blurRectToPixels arredonda para fora", () => {
  assert.deepEqual(blurRectToPixels({ x: 10.1, y: 10.1, w: 10, h: 10 }, 100, 100), { x0: 10, y0: 10, x1: 21, y1: 21 });
});

test("desfoque destrói o texto dentro do retângulo e não toca em nada fora", () => {
  const original = syntheticText();
  const img = { ...original, data: new Uint8ClampedArray(original.data) };
  const rect = { x: 10, y: 15, w: 50, h: 40 };
  applyBlurRects(img, [rect]);
  const px = blurRectToPixels(rect, img.width, img.height);
  const before = region(original, px);
  const after = region(img, px);
  const ratio = edgeEnergy(after) / edgeEnergy(before);
  assert.ok(ratio < 0.03, `energia de borda caiu só para ${(ratio * 100).toFixed(2)}%`);
  // nenhum pixel preto ("tinta" do texto) sobrevive dentro do retângulo
  assert.ok(Math.min(...after.values) > 120, `pixel mais escuro ${Math.min(...after.values)}`);
  // fora do retângulo: byte a byte igual
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      if (x >= px.x0 && x < px.x1 && y >= px.y0 && y < px.y1) continue;
      const o = (y * img.width + x) * 4;
      for (let c = 0; c < 4; c += 1) assert.equal(img.data[o + c], original.data[o + c]);
    }
  }
  assert.notEqual(sha(img.data), sha(original.data));
});

test("raio forte e proporcional ao tamanho", () => {
  assert.equal(blurRadiusFor(320, 200), 12);
  assert.equal(blurRadiusFor(1920, 1080), 32);
  assert.equal(blurRadiusFor(8000, 8000), 48);
});

test("ficha do passo: tour antigo sem blur continua igual", () => {
  const old = { id: "s1", type: "screen", image: "custom:img1", hotspot: { x: 1, y: 1, w: 2, h: 2 } };
  assert.equal(readStepBlur(old), null);
  assert.equal(blurMatchesStep(old), false);
  const demo = { steps: [structuredClone(old)] };
  assert.deepEqual(stripBlurMeta(demo), { steps: [old] });
  assert.deepEqual(stripBlurMeta({}), {});
});

test("ficha vale só enquanto a imagem do passo é a que recebeu o desfoque", () => {
  const step = { id: "s1", image: "custom:k1", blur: { id: "blr0123", key: "k1", rects: [{ x: 1, y: 1, w: 10, h: 10 }] } };
  assert.equal(blurMatchesStep(step), true);
  step.image = "custom:outra";
  assert.equal(blurMatchesStep(step), false);
  assert.equal(readStepBlur({ blur: { id: "x", key: "k", rects: [] } }), null);
});

test("customImageUsers conta passos com a mesma imagem", () => {
  const demo = { steps: [{ image: "custom:a" }, { image: "custom:a" }, { image: "custom:b" }] };
  assert.equal(customImageUsers(demo, "a"), 2);
  assert.equal(customImageUsers(demo, "b"), 1);
});

function project(steps, customImages) {
  return { id: "p1", name: "qa-blur", theme: defaultTheme(), customImages, steps, sceneLabels: {}, playback: defaultPlayback(), narration: defaultNarration() };
}

test("snapshot publicado (/p, /v, HTML): só a imagem borrada, sem ficha nem biblioteca", async () => {
  const blurred = "data:image/png;base64,QkxVUlJFRA==";
  const p = project(
    [{ id: "s1", type: "screen", image: "custom:k1", blur: { id: "blr0123", key: "k1", rects: [{ x: 1, y: 1, w: 10, h: 10 }] } }],
    { k1: { name: "a.png", dataUrl: blurred }, unused: { name: "b.png", dataUrl: "data:image/png;base64,T1JJRw==" } }
  );
  const out = await embedImagesInDemo(prepareSharePayload(p));
  assert.equal(out.steps[0].image, blurred);
  assert.equal(out.steps[0].blur, undefined);
  assert.deepEqual(out.customImages, {});
  assert.ok(!JSON.stringify(out).includes("T1JJRw=="));
  // o projeto do editor não muda
  assert.ok(p.steps[0].blur);
});

test("snapshot de tour antigo (sem blur, guia e galeria) não muda", async () => {
  for (const mode of [undefined, "gallery"]) {
    const p = project([{ id: "s1", type: "screen", image: "custom:k1", hotspot: { x: 1, y: 2, w: 3, h: 4 } }], { k1: { name: "a", dataUrl: "data:image/png;base64,QQ==" } });
    if (mode) p.playback.mode = mode;
    const out = await embedImagesInDemo(prepareSharePayload(p));
    assert.deepEqual(out.steps, [{ id: "s1", type: "screen", image: "data:image/png;base64,QQ==", hotspot: { x: 1, y: 2, w: 3, h: 4 } }]);
    assert.equal(out.playback.mode, mode);
  }
});

test("originais ficam no IndexedDB local e somem com o projeto", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  await putBlurOriginal("blrA", { bytes, mime: "image/png", projectId: "p-a" });
  await putBlurOriginal("blrB", { bytes, mime: "image/png", projectId: "p-b" });
  const got = await getBlurOriginal("blrA");
  assert.deepEqual([...got.bytes], [1, 2, 3, 4]);
  assert.equal(got.mime, "image/png");
  assert.equal(await deleteBlurOriginalsForProject("p-a"), 1);
  assert.equal(await getBlurOriginal("blrA"), null);
  assert.ok(await getBlurOriginal("blrB"));
});

test("textos da ferramenta (pt/en/es) sem palavras proibidas", () => {
  const src = readFileSync(new URL("./i18n.js", import.meta.url), "utf8");
  const lines = src.split("\n").filter((l) => /"blur\./.test(l));
  assert.equal(lines.length, 21);
  for (const l of lines) assert.ok(!/plataforma|intelig[eê]ncia|ecossistema|potencializar|platform|intelligence|ecosystem|empower/i.test(l), l);
});
