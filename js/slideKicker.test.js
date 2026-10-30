// Regressão: slide de texto não mostra mais "CENA N" acima do título (player, /p, /v, embed, HTML offline e editor).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { slideKickerText } from "./playback.js";

const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const sceneText = (n) => `Cena ${n}`;

test("slide com título: sem rótulo de cena", () => {
  const demo = { sceneLabels: { 1: "Boas-vindas" } };
  assert.equal(slideKickerText({ scene: 1, popover: { title: "Bem-vindo ao GuiaFlow" } }, demo, sceneText), "");
  assert.equal(slideKickerText({ scene: 2, label: "Rótulo" }, demo, sceneText), "");
});

test("slide sem título: reserva = nome da cena, sem o prefixo; senão Cena N", () => {
  const demo = { sceneLabels: { "1": "Boas-vindas" } };
  assert.equal(slideKickerText({ scene: 1, popover: { title: "  " } }, demo, sceneText), "Boas-vindas");
  assert.equal(slideKickerText({ scene: 3, popover: { title: "" } }, demo, sceneText), "Cena 3");
  assert.equal(slideKickerText({ popover: {} }, {}, (n) => `Scene ${n}`), "Scene 1");
});

test("player, player offline e editor não montam mais 'Cena N · nome'", () => {
  const player = read("./player.js");
  assert.match(player, /slideKickerText\(step, demo, \(n\) => t\("player\.scene", \{ n \}\)\)/);
  assert.match(player, /els\.slideKicker\.hidden = !kicker;/);
  assert.doesNotMatch(player, /slideKicker\.textContent = t\("player\.scene"/);
  const standalone = read("./standalonePlayer.js");
  assert.match(standalone, /const kicker = slideTitle \? "" : sceneName \|\| gfT\("player\.scene"/);
  assert.match(standalone, /els\.slideKicker\.hidden = !kicker;/);
  const editor = read("./editor.js");
  const paint = editor.slice(editor.indexOf("function paintSceneKicker("), editor.indexOf("function startKickerRename("));
  assert.match(paint, /slideKickerText\(/);
  assert.doesNotMatch(paint, /· /);
  assert.doesNotMatch(editor, /kicker-scene-n"/);
});
