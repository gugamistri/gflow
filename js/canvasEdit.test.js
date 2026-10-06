import assert from "node:assert/strict";
import test from "node:test";
import {
  POPOVER_GAP,
  isTypingTarget,
  placePopoverBox,
  readInlineText,
  snapPopoverPlacement,
} from "./canvasEdit.js";

const hotspot = { left: 100, top: 100, width: 80, height: 40 };

test("isTypingTarget ignora o palco e respeita campo e contenteditable", () => {
  assert.equal(isTypingTarget(null), false);
  assert.equal(isTypingTarget({ tagName: "DIV" }), false);
  assert.equal(isTypingTarget({ tagName: "INPUT" }), true);
  assert.equal(isTypingTarget({ tagName: "TEXTAREA" }), true);
  assert.equal(isTypingTarget({ tagName: "SELECT" }), true);
  assert.equal(isTypingTarget({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(isTypingTarget({ tagName: "DIV", isContentEditable: false }), false);
});

test("readInlineText tira o newline final do contenteditable", () => {
  assert.equal(readInlineText("Olá\n"), "Olá");
  assert.equal(readInlineText("linha\noutra\n"), "linha\noutra");
  assert.equal(readInlineText("a\u00a0b"), "a b");
  assert.equal(readInlineText(""), "");
});

test("placePopoverBox ancora o balão no lado e no alinhamento", () => {
  const size = { width: 200, height: 100 };
  const bottom = placePopoverBox(hotspot, size, "bottom", "center");
  assert.equal(bottom.top, 100 + 40 + POPOVER_GAP);
  assert.equal(bottom.left, 100 + 40 - 100);
  assert.equal(bottom.side, "bottom");

  const right = placePopoverBox(hotspot, size, "right", "start");
  assert.equal(right.left, 100 + 80 + POPOVER_GAP);
  assert.equal(right.top, 100);

  const left = placePopoverBox(hotspot, size, "left", "end");
  assert.equal(left.left, 100 - POPOVER_GAP - 200);
  assert.equal(left.top, 100 + 40 - 100);

  const top = placePopoverBox(hotspot, size, "top", "end");
  assert.equal(top.top, 100 - POPOVER_GAP - 100);
  assert.equal(top.left, 100 + 80 - 200);

  const fallback = placePopoverBox(hotspot, size, "over", "middle");
  assert.equal(fallback.side, "bottom");
  assert.equal(fallback.align, "center");
});

test("snapPopoverPlacement cobre os doze encaixes do Driver", () => {
  assert.deepEqual(snapPopoverPlacement(hotspot, { x: 220, y: 108 }), { side: "right", align: "start" });
  assert.deepEqual(snapPopoverPlacement(hotspot, { x: 220, y: 120 }), { side: "right", align: "center" });
  assert.deepEqual(snapPopoverPlacement(hotspot, { x: 220, y: 136 }), { side: "right", align: "end" });
  assert.deepEqual(snapPopoverPlacement(hotspot, { x: 40, y: 105 }), { side: "left", align: "start" });
  assert.deepEqual(snapPopoverPlacement(hotspot, { x: 40, y: 120 }), { side: "left", align: "center" });
  assert.deepEqual(snapPopoverPlacement(hotspot, { x: 40, y: 138 }), { side: "left", align: "end" });
  assert.deepEqual(snapPopoverPlacement(hotspot, { x: 110, y: 40 }), { side: "top", align: "start" });
  assert.deepEqual(snapPopoverPlacement(hotspot, { x: 140, y: 40 }), { side: "top", align: "center" });
  assert.deepEqual(snapPopoverPlacement(hotspot, { x: 175, y: 40 }), { side: "top", align: "end" });
  assert.deepEqual(snapPopoverPlacement(hotspot, { x: 110, y: 200 }), { side: "bottom", align: "start" });
  assert.deepEqual(snapPopoverPlacement(hotspot, { x: 140, y: 200 }), { side: "bottom", align: "center" });
  assert.deepEqual(snapPopoverPlacement(hotspot, { x: 175, y: 200 }), { side: "bottom", align: "end" });
});
