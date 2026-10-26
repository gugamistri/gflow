import assert from "node:assert/strict";
import test from "node:test";
import {
  TOUCH_DRAG_EDGE,
  TOUCH_DRAG_HOLD_MS,
  TOUCH_DRAG_SLOP,
  dropTargetAt,
  edgeScrollSpeed,
  insertBeforeFor,
} from "./filmDrag.js";

const card = (index, left, width = 100) => ({
  index,
  scene: 1,
  rect: { left, top: 0, width, height: 60 },
});

test("arraste na faixa horizontal escolhe o cartão pela metade esquerda/direita", () => {
  const cards = [card(0, 0), card(1, 106), card(2, 212)];
  assert.deepEqual(dropTargetAt({ x: 20, y: 30, horizontal: true, cards }), { index: 0, scene: 1, before: true });
  assert.deepEqual(dropTargetAt({ x: 80, y: 30, horizontal: true, cards }), { index: 0, scene: 1, before: false });
  assert.deepEqual(dropTargetAt({ x: 110, y: 30, horizontal: true, cards }), { index: 1, scene: 1, before: true });
  assert.deepEqual(dropTargetAt({ x: 300, y: 30, horizontal: true, cards }), { index: 2, scene: 1, before: false });
});

test("dedo no vão entre cartões e fora da faixa caem no vizinho certo", () => {
  const cards = [card(0, 0), card(1, 106)];
  // vão de 100 a 106: entra antes do próximo (índice 1), que é o mesmo lugar de "depois do 0"
  assert.deepEqual(dropTargetAt({ x: 102, y: 30, horizontal: true, cards }), { index: 1, scene: 1, before: true });
  assert.equal(insertBeforeFor(dropTargetAt({ x: 102, y: 30, horizontal: true, cards })), 1);
  // antes do primeiro
  assert.deepEqual(dropTargetAt({ x: -40, y: 30, horizontal: true, cards }), { index: 0, scene: 1, before: true });
});

test("na coluna (deitado) a conta usa o eixo vertical", () => {
  const cards = [
    { index: 0, scene: 2, rect: { left: 0, top: 0, width: 100, height: 60 } },
    { index: 1, scene: 2, rect: { left: 0, top: 66, width: 100, height: 60 } },
  ];
  assert.deepEqual(dropTargetAt({ x: 10, y: 20, horizontal: false, cards }), { index: 0, scene: 2, before: true });
  assert.deepEqual(dropTargetAt({ x: 10, y: 100, horizontal: false, cards }), { index: 1, scene: 2, before: false });
});

test("sem cartões não há alvo", () => {
  assert.equal(dropTargetAt({ x: 10, y: 10, horizontal: true, cards: [] }), null);
  assert.equal(dropTargetAt({ x: 10, y: 10, horizontal: true, cards: null }), null);
});

test("índice de inserção é o dobro do alvo: antes = index, depois = index + 1", () => {
  assert.equal(insertBeforeFor({ index: 2, before: true }), 2);
  assert.equal(insertBeforeFor({ index: 2, before: false }), 3);
  assert.equal(insertBeforeFor(null), null);
});

test("rolagem automática só nas bordas e mais forte quanto mais perto do limite", () => {
  const box = { min: 0, max: 400 };
  assert.equal(edgeScrollSpeed({ ...box, pos: 200 }), 0);
  assert.ok(edgeScrollSpeed({ ...box, pos: 4 }) < 0);
  assert.ok(edgeScrollSpeed({ ...box, pos: 396 }) > 0);
  assert.ok(edgeScrollSpeed({ ...box, pos: 0 }) <= edgeScrollSpeed({ ...box, pos: TOUCH_DRAG_EDGE - 4 }));
  assert.equal(edgeScrollSpeed({ min: 0, max: 0, pos: 0 }), 0);
  assert.equal(edgeScrollSpeed({ min: Number.NaN, max: 10, pos: 5 }), 0);
});

test("limiares do toque longo publicados", () => {
  assert.ok(TOUCH_DRAG_SLOP > 0);
  assert.ok(TOUCH_DRAG_HOLD_MS >= 200 && TOUCH_DRAG_HOLD_MS <= 400);
  assert.ok(TOUCH_DRAG_EDGE > 0);
});
