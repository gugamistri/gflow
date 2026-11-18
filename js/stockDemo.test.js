import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { STOCK_DEMO_NAME, STOCK_DEMOS, isStockDemoName, isUntouchedStockDemo } from "./projects.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("exemplo intocado fica só no navegador; editado (ou renomeado) sincroniza", () => {
  assert.equal(isUntouchedStockDemo({ name: STOCK_DEMO_NAME, steps: [] }), true);
  assert.equal(isUntouchedStockDemo({ name: "Luminária Arco Liana", steps: [] }), true);
  assert.equal(isUntouchedStockDemo({ name: STOCK_DEMO_NAME, steps: [], stockEdited: true }), false);
  assert.equal(isUntouchedStockDemo({ name: "Meu tour", steps: [] }), false);
  assert.equal(isUntouchedStockDemo(null), false);
  assert.equal(isStockDemoName("Como usar o Guia"), true);
  assert.equal(isStockDemoName("Luminária Arco Liana"), true);
  assert.equal(isStockDemoName("Como solicitar um reembolso"), true);
  assert.equal(isStockDemoName("Meu tour"), false);
});

test("os exemplos empacotados existem no repositório", () => {
  assert.equal(STOCK_DEMOS.length, 3);
  for (const stock of STOCK_DEMOS) {
    assert.equal(existsSync(join(root, stock.url)), true, stock.url);
  }
});
