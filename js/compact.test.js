import assert from "node:assert/strict";
import test from "node:test";
import { isCompactLandscape, isCompactTouch } from "./compact.js";

function fakeMatch(matches) {
  return () => ({ matches });
}

test("compacto é falso quando matchMedia não existe", () => {
  assert.equal(isCompactTouch(undefined), false);
  assert.equal(isCompactLandscape(undefined), false);
});

test("compacto segue o resultado do matchMedia", () => {
  assert.equal(isCompactTouch(fakeMatch(true)), true);
  assert.equal(isCompactTouch(fakeMatch(false)), false);
  assert.equal(isCompactLandscape(fakeMatch(true)), true);
  assert.equal(isCompactLandscape(fakeMatch(false)), false);
});
