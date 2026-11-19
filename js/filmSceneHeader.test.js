import assert from "node:assert/strict";
import test from "node:test";
import { filmSceneHeaderText } from "./filmSceneHeader.js";
import { getLocale, setLocale, t } from "./i18n.js";

function withLocale(locale, fn) {
  const prev = getLocale();
  setLocale(locale, { persist: false });
  try {
    return fn();
  } finally {
    setLocale(prev, { persist: false });
  }
}

for (const [locale, fallback, custom] of [
  ["pt", "Cena 1", "Boas-vindas"],
  ["en", "Scene 1", "Welcome"],
  ["es", "Escena 1", "Bienvenida"],
]) {
  test(`filmstrip: o rótulo padrão da cena 1 não se repete (${locale})`, () => {
    withLocale(locale, () => {
      assert.equal(filmSceneHeaderText("", 1, t), fallback);
      assert.equal(filmSceneHeaderText(null, 1, t), fallback);
      assert.equal(filmSceneHeaderText(fallback, 1, t), fallback);
      assert.equal(filmSceneHeaderText(fallback.toLowerCase(), 1, t), fallback);
      assert.equal(filmSceneHeaderText(` ${fallback} `, 1, t), fallback);
    });
  });

  test(`filmstrip: cena com nome próprio aparece depois de ${fallback.split(" ")[0]} N (${locale})`, () => {
    withLocale(locale, () => {
      assert.equal(filmSceneHeaderText(custom, 1, t), `${fallback} · ${custom}`);
      const two = t("filmstrip.scene", { n: 2 });
      assert.equal(filmSceneHeaderText("", 2, t), two);
      assert.equal(filmSceneHeaderText(custom, 2, t), `${two} · ${custom}`);
    });
  });
}
