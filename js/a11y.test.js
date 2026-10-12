import test from "node:test";
import assert from "node:assert/strict";
import { stepImageAlt, contrastRatio, ensureContrast, themeContrastIssues } from "./a11y.js";

test("stepImageAlt usa alt, depois título/texto, e respeita decorativa", () => {
  assert.equal(stepImageAlt({ alt: " Painel de vendas ", popover: { title: "T" } }), "Painel de vendas");
  assert.equal(stepImageAlt({ popover: { title: "Clique", description: "Abra<br/>o menu" } }), "Clique: Abra o menu");
  assert.equal(stepImageAlt({ alt: "x", altDecorative: true }), "");
});

test("ensureContrast escurece o destaque até 4,5:1", () => {
  assert.ok(contrastRatio("#2a9d8f", "#ffffff") < 4.5);
  const fixed = ensureContrast("#2a9d8f", "#ffffff");
  assert.ok(contrastRatio(fixed, "#ffffff") >= 4.5);
  const light = ensureContrast("#1a4d6d", "#111111");
  assert.ok(contrastRatio(light, "#111111") >= 4.5);
  assert.equal(ensureContrast("#000000", "#ffffff"), "#000000");
});

test("themeContrastIssues aponta pares fracos", () => {
  const issues = themeContrastIssues({ title: "#000000", text: "#cccccc", popoverBg: "#ffffff", accent: "#2a9d8f", button: "#1a4d6d" });
  assert.deepEqual(issues.map((i) => i.key), ["text", "accent"]);
});
