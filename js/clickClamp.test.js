import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CLICK_INSET,
  clickPointForCanvasClick,
  pointInHotspot,
  clampClickToHotspot,
  clampStepClickPoints,
  ensureClickPoint,
  followHotspot,
  hasHotspot,
} from "./store.js";

const HS = { x: 40, y: 40, w: 20, h: 10 };

test("clique dentro do destaque não muda", () => {
  assert.deepEqual(clampClickToHotspot({ x: 45, y: 44 }, HS), { x: 45, y: 44 });
});

test("clique fora do destaque vai para a borda, com margem", () => {
  assert.deepEqual(clampClickToHotspot({ x: 5, y: 95 }, HS), {
    x: 40 + CLICK_INSET,
    y: 50 - CLICK_INSET,
  });
  assert.deepEqual(clampClickToHotspot({ x: 99, y: 0 }, HS), {
    x: 60 - CLICK_INSET,
    y: 40 + CLICK_INSET,
  });
});

test("destaque menor que a margem prende o clique no centro", () => {
  const tiny = { x: 10, y: 10, w: 1, h: 0.5 };
  assert.deepEqual(clampClickToHotspot({ x: 0, y: 99 }, tiny), { x: 10.5, y: 10.25 });
});

test("sem destaque válido o clique fica livre", () => {
  assert.deepEqual(clampClickToHotspot({ x: 3, y: 97 }, null), { x: 3, y: 97 });
  assert.deepEqual(clampClickToHotspot({ x: 3, y: 97 }, { x: 1, y: 1, w: 0, h: 5 }), { x: 3, y: 97 });
  assert.equal(hasHotspot({ x: 1, y: 1, w: NaN, h: 5 }), false);
  assert.equal(hasHotspot(HS), true);
});

test("ensureClickPoint prende na exibição sem mutar o passo salvo", () => {
  const step = { hotspot: { ...HS }, clickPoint: { x: 90, y: 5 } };
  const shown = ensureClickPoint(step);
  assert.deepEqual(shown, { x: 59, y: 41 });
  assert.deepEqual(step.clickPoint, { x: 90, y: 5 });
});

test("ensureClickPoint sem clique usa o centro do destaque", () => {
  assert.deepEqual(ensureClickPoint({ hotspot: HS }), { x: 50, y: 45 });
});

test("ensureClickPoint sem destaque mantém o clique livre", () => {
  assert.deepEqual(ensureClickPoint({ clickPoint: { x: 2, y: 98 } }), { x: 2, y: 98 });
});

test("mover o destaque leva o clique junto", () => {
  const next = { x: 10, y: 70, w: 20, h: 10 };
  assert.deepEqual(followHotspot({ x: 45, y: 44 }, HS, next), { x: 15, y: 74 });
});

test("redimensionar o destaque mantém o clique e prende dentro", () => {
  // clique continua dentro: não se mexe
  assert.deepEqual(followHotspot({ x: 45, y: 44 }, HS, { x: 40, y: 40, w: 30, h: 10 }), { x: 45, y: 44 });
  // destaque encolheu e deixou o clique de fora: vai para a borda
  assert.deepEqual(followHotspot({ x: 58, y: 48 }, HS, { x: 40, y: 40, w: 8, h: 4 }), { x: 47, y: 43 });
});

test("clique antigo fora do destaque: mover o destaque também o traz para dentro", () => {
  const p = followHotspot({ x: 90, y: 90 }, HS, { x: 0, y: 0, w: 20, h: 10 });
  assert.deepEqual(p, { x: 19, y: 9 });
});

test("capturas importadas entram com o clique dentro", () => {
  const steps = [
    { hotspot: { ...HS }, clickPoint: { x: 0, y: 0 } },
    { clickPoint: { x: 0, y: 0 } },
  ];
  clampStepClickPoints(steps);
  assert.deepEqual(steps[0].clickPoint, { x: 41, y: 41 });
  assert.deepEqual(steps[1].clickPoint, { x: 0, y: 0 });
});

test("HTML exportado usa a mesma regra de clique", () => {
  const src = readFileSync(new URL("./standalonePlayer.js", import.meta.url), "utf8");
  const pick = (name) => {
    const start = src.indexOf(`  function ${name}(`);
    assert.ok(start >= 0, name);
    const end = src.indexOf("\n  }\n", start);
    return src.slice(start, end + 4);
  };
  const ensure = new Function(
    `${pick("clickPointFromHotspot")}\n${pick("clampClickToHotspot")}\n${pick("ensureClickPoint")}\nreturn ensureClickPoint;`
  )();
  const cases = [
    { hotspot: HS, clickPoint: { x: 90, y: 5 } },
    { hotspot: HS, clickPoint: { x: 45, y: 44 } },
    { hotspot: HS },
    { clickPoint: { x: 2, y: 98 } },
    { hotspot: { x: 10, y: 10, w: 1, h: 0.5 }, clickPoint: { x: 0, y: 99 } },
  ];
  for (const step of cases) assert.deepEqual(ensure(step), ensureClickPoint(step));
});

test("clique no canvas fora do destaque não mexe o clique", () => {
  assert.equal(clickPointForCanvasClick({ x: 5, y: 95 }, HS), null);
  assert.equal(clickPointForCanvasClick({ x: 61, y: 45 }, HS), null);
  assert.equal(pointInHotspot({ x: 39.9, y: 45 }, HS), false);
});

test("clique no canvas dentro do destaque move o clique (preso à margem)", () => {
  assert.deepEqual(clickPointForCanvasClick({ x: 45, y: 44 }, HS), { x: 45, y: 44 });
  // na borda do destaque: entra e fica na margem
  assert.deepEqual(clickPointForCanvasClick({ x: 60, y: 40 }, HS), { x: 59, y: 41 });
  assert.equal(pointInHotspot({ x: 60, y: 50 }, HS), true);
});

test("clique no canvas sem destaque continua livre", () => {
  assert.deepEqual(clickPointForCanvasClick({ x: 3, y: 97 }, null), { x: 3, y: 97 });
  assert.equal(clickPointForCanvasClick({ x: NaN, y: 1 }, HS), null);
});
