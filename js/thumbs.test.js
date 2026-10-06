import assert from "node:assert/strict";
import test from "node:test";
import {
  isHeavyDataUrl,
  LIBRARY_THUMB_MAX_CHARS,
  shouldDownscaleSrc,
  thumbKey,
} from "./thumbs.js";

test("thumbKey é estável e muda com o conteúdo", () => {
  const a = "data:image/png;base64," + "A".repeat(400);
  const b = "data:image/png;base64," + "B".repeat(400);
  assert.equal(thumbKey(a), thumbKey(a));
  assert.notEqual(thumbKey(a), thumbKey(b));
  assert.equal(thumbKey(""), "");
  assert.match(thumbKey(a), /^[0-9a-z]+$/);
});

test("só data e blob de imagem pedem miniatura", () => {
  assert.equal(shouldDownscaleSrc("data:image/png;base64,abc"), true);
  assert.equal(shouldDownscaleSrc("blob:http://localhost/x"), true);
  assert.equal(shouldDownscaleSrc("demo/como-usar/01-biblioteca.png"), false);
  assert.equal(shouldDownscaleSrc("custom:img-1"), false);
  assert.equal(shouldDownscaleSrc(""), false);
});

test("dataUrl longo é pesado para a biblioteca", () => {
  assert.equal(isHeavyDataUrl("data:image/jpeg;base64," + "A".repeat(LIBRARY_THUMB_MAX_CHARS)), true);
  assert.equal(isHeavyDataUrl("data:image/jpeg;base64,aa"), false);
  assert.equal(isHeavyDataUrl("demo/a.png"), false);
  assert.equal(isHeavyDataUrl(null), false);
});
