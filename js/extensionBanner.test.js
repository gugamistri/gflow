import assert from "node:assert/strict";
import test from "node:test";
import { shouldShowExtensionBanner } from "./extensionBanner.js";

test("mostra o aviso quando a extensão não está instalada", () => {
  assert.equal(shouldShowExtensionBanner({}), true);
  assert.equal(
    shouldShowExtensionBanner({ dismissed: false, isDesktop: false, installed: false }),
    true
  );
});

test("esconde o aviso se a pessoa dispensou, está no desktop ou a extensão está instalada", () => {
  assert.equal(shouldShowExtensionBanner({ dismissed: true }), false);
  assert.equal(shouldShowExtensionBanner({ isDesktop: true }), false);
  assert.equal(shouldShowExtensionBanner({ installed: true }), false);
});
