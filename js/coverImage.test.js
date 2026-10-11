import assert from "node:assert/strict";
import test from "node:test";
import { COVER_HEIGHT, COVER_STRIP_HEIGHT, COVER_WIDTH, coverLayout, fitText, pickCoverStep, stepFocus } from "./coverImage.js";

const shot = (id) => ({ id, image: `custom:${id}` });
const slide = (id) => ({ id, type: "slide", popover: { title: "Slide" } });

test("pickCoverStep: escolhido, 1ª captura, slide e tour vazio", () => {
  assert.deepEqual(pickCoverStep([shot("a"), shot("b")]), { index: 0, mode: "image" });
  assert.deepEqual(pickCoverStep([shot("a"), shot("b")], "b"), { index: 1, mode: "image" });
  assert.deepEqual(pickCoverStep([slide("s"), shot("a")]), { index: 1, mode: "image" });
  assert.deepEqual(pickCoverStep([slide("s"), shot("a")], "s"), { index: 0, mode: "slide" });
  assert.deepEqual(pickCoverStep([slide("s")]), { index: 0, mode: "slide" });
  assert.deepEqual(pickCoverStep([shot("a")], "sumiu"), { index: 0, mode: "image" });
  assert.deepEqual(pickCoverStep([]), { index: -1, mode: "title" });
  assert.deepEqual(pickCoverStep(null), { index: -1, mode: "title" });
});

test("coverLayout preenche a área acima da faixa sem distorcer", () => {
  const areaH = COVER_HEIGHT - COVER_STRIP_HEIGHT;
  const wide = coverLayout(1920, 1080);
  assert.equal(wide.dw, COVER_WIDTH);
  assert.equal(wide.dh, areaH);
  // mesma proporção do destino
  assert.ok(Math.abs(wide.sw / wide.sh - COVER_WIDTH / areaH) < 0.01);
  assert.equal(wide.sy, 0); // sem foco: topo
  assert.equal(wide.sx, 0);
  // tela alta (celular): corta em altura, centra no destaque
  const tall = coverLayout(390, 844, { focus: { x: 0.5, y: 0.9 } });
  assert.equal(tall.sw, 390);
  assert.ok(tall.sy > 0);
  assert.ok(tall.sy + tall.sh <= 844);
  // foco perto da borda não sai da imagem
  const edge = coverLayout(3000, 1000, { focus: { x: 1, y: 0 } });
  assert.equal(edge.sx + edge.sw, 3000);
  assert.equal(coverLayout(0, 100), null);
});

test("stepFocus usa o centro do destaque em %", () => {
  assert.deepEqual(stepFocus({ hotspot: { x: 40, y: 20, w: 20, h: 10 } }), { x: 0.5, y: 0.25 });
  assert.equal(stepFocus({}), null);
});

test("fitText corta com reticências", () => {
  const measure = (s) => s.length * 10;
  assert.equal(fitText(measure, "curto", 100), "curto");
  const cut = fitText(measure, "um nome de tour bem comprido demais", 120);
  assert.ok(cut.endsWith("…"));
  assert.ok(measure(cut) <= 120);
});
