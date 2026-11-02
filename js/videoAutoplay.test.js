// Passo com vídeo: toca sozinho ao abrir o passo (mudo; com som só depois de interagir), sem balão nem
// texto nosso por cima; só a navegação do tour. Sem duração do autor, não avança antes do vídeo acabar.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { VIDEO_END_ADVANCE_MS, videoStepAdvance } from "./playback.js";
import { SOUND_FALLBACK_MS, SOUND_READY_GRACE_MS } from "./videoStage.js";
import { VIDEO_STRINGS } from "./videoI18n.js";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("avanço automático do passo de vídeo: duração do autor, senão só depois do fim", () => {
  assert.deepEqual(videoStepAdvance({ video: { kind: "youtube", id: "aqz-KE-bpKQ" } }), { holdMs: null, afterEnd: true });
  assert.deepEqual(videoStepAdvance({ holdSeconds: 0 }), { holdMs: null, afterEnd: true });
  assert.deepEqual(videoStepAdvance({ holdSeconds: "abc" }), { holdMs: null, afterEnd: true });
  assert.deepEqual(videoStepAdvance({ holdSeconds: 12 }), { holdMs: 12000, afterEnd: false });
  assert.ok(VIDEO_END_ADVANCE_MS > 0 && VIDEO_END_ADVANCE_MS <= 3000);
});

test("videoStage: autoplay ao mostrar, com som só se pedir e cai para mudo; sem texto sobre o vídeo", () => {
  const src = read("./videoStage.js");
  assert.match(src, /if \(interactive && autoplay\) play\(\{ sound, focus: false \}\);/);
  assert.match(src, /videoEmbedUrl\(video, \{ origin: embedOrigin, muted: !sound \}\)/);
  assert.match(src, /if \(iframe === frameEl && !heardPlaying\) frameEl\.src = mutedSrc;/);
  assert.match(src, /if \(update\.ready && soundRetry && !heardPlaying\)/);
  assert.match(src, /el\.querySelector\("\.gf-video-bar"\)\.hidden = true;/);
  assert.doesNotMatch(src, /\.gf-video-bar"\)\.hidden = false/);
  assert.ok(SOUND_READY_GRACE_MS >= 1000 && SOUND_READY_GRACE_MS <= 3000);
  assert.ok(SOUND_FALLBACK_MS >= 5000 && SOUND_FALLBACK_MS <= 10000);
  // o play conta quando o vídeo toca de verdade (postMessage), não ao montar
  assert.match(src, /heardPlaying = true;[\s\S]{0,200}opts\.onPlay\?\.\(/);
  assert.doesNotMatch(src, /gf-video-note|gf-video-play-text|gf-video-open|loadsOnClick/);
  // sair do passo derruba o iframe
  assert.match(src, /iframe\?\.remove\(\);/);
});

test("player: passo de vídeo sem título/descrição no balão (só navegação), autoplay e som do tour", () => {
  const src = read("./player.js");
  assert.match(src, /title: isVid \? "" : popoverTitleHtml\(/);
  assert.match(src, /description: isVid \? "" : popoverBodyHtml\(/);
  assert.match(src, /side: isVid \? "bottom"/);
  assert.match(src, /paintVideoNav\(isVideo\);/);
  assert.match(src, /video\.show\(step, \{ index: activeIndex, interactive: true, autoplay: true, sound: videoSound\(\) \}\)/);
  assert.match(src, /if \(controls\.isMuted\(\)\) return false;/);
  assert.match(src, /video\.setMuted\(muted\);/);
  assert.match(src, /const rule = videoStepAdvance\(step\);/);
  const css = read("../css/theme.css");
  assert.match(css, /\.is-video-nav \.driver-popover-title,[\s\S]*?\.is-video-nav \.driver-popover-description,[\s\S]*?display: none !important;/);
});

test("Galeria e HTML offline: vídeo toca sozinho (http/https); slide de vídeo sem legenda", () => {
  assert.match(read("./galleryPlayer.js"), /videoStage\.show\(step, \{ index, interactive: true, autoplay: true, sound \}\)/);
  const gal = read("./gallery.js");
  assert.match(gal, /const noText = kind === "card" \|\| kind === "video";/);
  const sp = read("./standalonePlayer.js");
  assert.match(sp, /function canEmbedVideo\(\) \{\s*return typeof location !== "undefined" && \/\^https\?:\$\/\.test\(location\.protocol\);/);
  assert.match(sp, /youtube-nocookie\.com\/embed\//);
  assert.match(sp, /autoplay=1&mute=" \+ mute \+ "&playsinline=1&rel=0&modestbranding=1&iv_load_policy=3/);
  assert.match(sp, /autoplay=1&muted=" \+ mute \+ "&playsinline=1&dnt=1&title=0&byline=0&portrait=0/);
  assert.match(sp, /title: stepVideoLink\(step\) \? "" : gfEscapeHtml\(/);
  assert.match(sp, /classList\.toggle\("is-video-nav", isVid\)/);
  assert.match(sp, /mountVideo: \(host, step\) => \{\s*if \(!canEmbedVideo\(\)\) return null;/);
  assert.match(sp, /syncVideoLink\(null\);/);
});

test("editor: sem a explicação do link; passo de vídeo esconde descrição, IA de textos e posição do balão", () => {
  const html = read("../editor.html");
  assert.doesNotMatch(html, /prop-video-hint|prop-video-no-narration|data-i18n="video\.hint"/);
  for (const loc of ["pt", "en", "es"]) {
    assert.equal(VIDEO_STRINGS[loc]["video.hint"], undefined);
    assert.ok(VIDEO_STRINGS[loc]["media.stepName"], loc);
  }
  const js = read("./editor.js");
  assert.match(js, /if \(desc\) desc\.hidden = video;/);
  assert.match(js, /if \(posSec\) posSec\.hidden = video;/);
  assert.match(js, /const key = video \? "media\.stepName" : "props\.title";/);
  assert.match(js, /step\.type === "slide" \|\| isVideoMedia\(step\)\) \{\s*pop\.hidden = true;/);
});
