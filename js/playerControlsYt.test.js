import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { playerShortcut, captionsOn, setCaptions, onCaptionsChange } from "./playerControls.js";

test("atalhos estilo YouTube: K/Espaço pausa, M mudo, C legendas", () => {
  const k = (key, tag = "DIV") => playerShortcut({ key, target: { tagName: tag } });
  assert.equal(k("k"), "pause");
  assert.equal(k(" "), "pause");
  assert.equal(k(" ", "BUTTON"), "");
  assert.equal(k("m"), "mute");
  assert.equal(k("c"), "cc");
  assert.equal(k("C"), "cc");
  assert.equal(k("c", "INPUT"), "");
  assert.equal(playerShortcut({ key: "c", ctrlKey: true, target: { tagName: "DIV" } }), "");
});

test("legendas: estado único com aviso aos ouvintes (botão CC e menu ⚙ ficam em sincronia)", () => {
  const seen = [];
  const off = onCaptionsChange((on) => seen.push(on));
  const start = captionsOn();
  setCaptions(!start);
  setCaptions(!start);
  setCaptions(start);
  off();
  assert.deepEqual(seen, [!start, start]);
});

test("barra única: pausa, som, autoplay, CC e ⚙ no mesmo grupo; menu estilo YouTube com › e bandeiras", () => {
  const ctl = readFileSync(new URL("./playerControls.js", import.meta.url), "utf8");
  assert.match(ctl, /root\.append\(pauseBtn, muteBtn, sep, autoBtn, ccBtn\)/);
  assert.match(ctl, /autoBtn\.setAttribute\("aria-pressed"/);
  assert.match(ctl, /ccBtn\.setAttribute\("aria-pressed"/);
  const menu = readFileSync(new URL("./langMenu.js", import.meta.url), "utf8");
  assert.match(menu, /host\.append\(btn\)/);
  assert.match(menu, /gf-set-chev/);
  assert.match(menu, /flagSvg\(o\.flag\)/);
  const player = readFileSync(new URL("./player.js", import.meta.url), "utf8");
  assert.match(player, /autoplay: autoplayEnabled/);
  assert.match(player, /isAutoplay: \(\) => autoplayEnabled/);
  const css = ["shell", "player", "editor"].map((n) => readFileSync(new URL(`../css/${n}.css`, import.meta.url), "utf8")).join("\n");
  assert.match(css, /body\.gf-cc-off\.gf-player-on #canvas-caption/);
});
