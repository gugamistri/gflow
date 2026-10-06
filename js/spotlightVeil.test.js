import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  SPOTLIGHT_VEIL_OPACITY,
  spotlightVeilFill,
  spotlightVeilPaint,
  themeOverlayPaint,
} from "./store.js";

test("o véu do destaque é o mesmo preto 0.48 do vídeo exportado", () => {
  assert.equal(SPOTLIGHT_VEIL_OPACITY, 0.48);
  assert.deepEqual(spotlightVeilPaint(), { color: "#000000", opacity: 0.48 });
  assert.equal(spotlightVeilFill(), "rgba(0,0,0,0.48)");
  assert.deepEqual(themeOverlayPaint(), spotlightVeilPaint());
});

test("preview e export usam o véu compartilhado", () => {
  const pack = readFileSync(new URL("./exportPack.js", import.meta.url), "utf8");
  const player = readFileSync(new URL("./player.js", import.meta.url), "utf8");
  const standalone = readFileSync(new URL("./standalonePlayer.js", import.meta.url), "utf8");
  assert.match(pack, /spotlightVeilFill\(\)/);
  assert.doesNotMatch(pack, /rgba\(0,\s*0,\s*0,\s*0\.48\)/);
  assert.match(player, /spotlightVeilPaint\(\)/);
  assert.match(
    standalone,
    new RegExp(`const SPOTLIGHT_VEIL_OPACITY = ${SPOTLIGHT_VEIL_OPACITY}`)
  );
  assert.match(standalone, /const overlay = "#000000"/);
  assert.match(standalone, /const overlayOpacity = SPOTLIGHT_VEIL_OPACITY/);
  assert.match(standalone, /is-above-overlay/);
  assert.match(player, /liftCaptionAboveOverlay/);
});
