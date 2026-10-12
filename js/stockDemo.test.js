import assert from "node:assert/strict";
import test from "node:test";
import { STOCK_DEMO_NAME, isUntouchedStockDemo } from "./projects.js";

test("exemplo intocado fica só no navegador; editado (ou renomeado) sincroniza", () => {
  assert.equal(isUntouchedStockDemo({ name: STOCK_DEMO_NAME, steps: [] }), true);
  assert.equal(isUntouchedStockDemo({ name: STOCK_DEMO_NAME, steps: [], stockEdited: true }), false);
  assert.equal(isUntouchedStockDemo({ name: "Meu tour", steps: [] }), false);
  assert.equal(isUntouchedStockDemo(null), false);
});
