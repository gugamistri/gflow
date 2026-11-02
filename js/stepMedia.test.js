// Mídia do passo: OU imagem OU vídeo. Alternar na sessão não destrói dados; passo de vídeo não tem narração.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { minHoldSecondsForStep, playableNarrationClips, resolveHoldSeconds, savedNarrationClips, stepShowsCaption } from "./playback.js";
import { chooseStepMedia, createStepMediaMemory, rememberStepImage, settleStepVideo, stepMediaKind } from "./stepMedia.js";
import { applyVideoToStep, stepAllowsNarration } from "./tour-schema/video.js";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

function imageStep() {
  return {
    id: "step-1",
    type: "screen",
    image: "custom:img-a",
    hotspot: { x: 10, y: 20, w: 30, h: 15 },
    clickPoint: { x: 25, y: 27 },
    simulateClick: true,
    zoomHighlight: true,
    popover: { title: "Pedido", description: "Clique aqui", side: "bottom", align: "center" },
    caption: "Clique em novo pedido",
  };
}

const VIDEO = { kind: "youtube", id: "aqz-KE-bpKQ" };

function withVideo(memory) {
  const step = imageStep();
  rememberStepImage(step, memory);
  applyVideoToStep(step, VIDEO, "custom:poster");
  settleStepVideo(step, memory);
  return step;
}

test("tipo de mídia: imagem por padrão, vídeo quando há step.video, nada em slide", () => {
  const memory = createStepMediaMemory();
  assert.equal(stepMediaKind(imageStep(), memory), "image");
  assert.equal(stepMediaKind({ type: "slide", video: VIDEO }, memory), null);
  // dado antigo com imagem E vídeo: é vídeo (a imagem é o pôster)
  assert.equal(stepMediaKind({ ...imageStep(), video: VIDEO }), "video");
});

test("Vídeo sem link guardado: só a UI muda (pendente), os dados ficam intactos", () => {
  const memory = createStepMediaMemory();
  const step = imageStep();
  const before = JSON.stringify(step);
  assert.deepEqual(chooseStepMedia(step, "video", memory), { kind: "video", changed: false });
  assert.equal(stepMediaKind(step, memory), "video");
  assert.equal(JSON.stringify(step), before);
  assert.deepEqual(chooseStepMedia(step, "image", memory), { kind: "image", changed: false });
  assert.equal(stepMediaKind(step, memory), "image");
  assert.equal(JSON.stringify(step), before);
});

test("Vídeo → Imagem → Vídeo na mesma sessão: devolve a imagem original e depois o vídeo + pôster", () => {
  const memory = createStepMediaMemory();
  const step = withVideo(memory);
  assert.equal(step.image, "custom:poster");
  assert.equal(step.simulateClick, false);

  assert.deepEqual(chooseStepMedia(step, "image", memory), { kind: "image", changed: true });
  assert.equal(step.video, undefined);
  assert.equal(step.image, "custom:img-a");
  assert.deepEqual(step.hotspot, { x: 10, y: 20, w: 30, h: 15 });
  assert.deepEqual(step.clickPoint, { x: 25, y: 27 });
  assert.equal(step.simulateClick, true);
  assert.equal(step.zoomHighlight, true);
  assert.equal(step.caption, "Clique em novo pedido", "a narração do modo imagem não se perde");

  assert.deepEqual(chooseStepMedia(step, "video", memory), { kind: "video", changed: true });
  assert.deepEqual(step.video, VIDEO);
  assert.equal(step.image, "custom:poster");
  assert.deepEqual(step.hotspot, { x: 0, y: 0, w: 100, h: 100 });
  assert.equal(step.simulateClick, false);
  assert.equal(step.zoomHighlight, false);

  // e de novo para imagem: continua a imagem original
  chooseStepMedia(step, "image", memory);
  assert.equal(step.image, "custom:img-a");
});

test("passo carregado já com vídeo (sem memória): Imagem deixa o pôster como imagem", () => {
  const memory = createStepMediaMemory();
  const step = { ...imageStep(), image: "custom:poster", video: VIDEO };
  chooseStepMedia(step, "image", memory);
  assert.equal(step.video, undefined);
  assert.equal(step.image, "custom:poster");
  chooseStepMedia(step, "video", memory);
  assert.deepEqual(step.video, VIDEO);
});

test("escolher a mídia atual não muda nada; tipo inválido é ignorado", () => {
  const memory = createStepMediaMemory();
  const step = withVideo(memory);
  const before = JSON.stringify(step);
  assert.equal(chooseStepMedia(step, "video", memory).changed, false);
  assert.equal(chooseStepMedia(step, "gif", memory).changed, false);
  assert.equal(chooseStepMedia({ type: "slide" }, "video", memory).changed, false);
  assert.equal(JSON.stringify(step), before);
});

function narratedVideoStep() {
  return {
    ...imageStep(),
    image: "custom:poster",
    video: VIDEO,
    showCaption: true,
    holdSeconds: 3,
    narrationAudio: {
      source: "upload",
      name: "voz.mp3",
      caption: "Clique em novo pedido",
      playbackRate: 1,
      durationSeconds: 12,
      clips: ["data:audio/mpeg;base64,YQ=="],
    },
  };
}

test("player: passo de vídeo ignora narração/TTS e legenda mesmo com dados antigos", () => {
  const demo = { playback: { defaultHoldSeconds: 4 }, narration: { enabled: true, voiceURI: "", rate: 1 } };
  const step = narratedVideoStep();
  assert.equal(stepAllowsNarration(step), false);
  assert.deepEqual(savedNarrationClips(step, demo), []);
  assert.deepEqual(playableNarrationClips(step, demo), []);
  assert.equal(stepShowsCaption(step), false);
  assert.equal(minHoldSecondsForStep(step, demo), null);
  assert.equal(resolveHoldSeconds(step, demo), 3, "sem o piso de 12 s do áudio");
  // o mesmo passo como imagem toca a narração (regra só vale para vídeo)
  const asImage = { ...step };
  delete asImage.video;
  assert.equal(playableNarrationClips(asImage, demo).length, 1);
  assert.equal(stepShowsCaption(asImage), true);
  assert.equal(resolveHoldSeconds(asImage, demo), 12);
  // slide com resto de `video` não é passo de vídeo
  assert.equal(stepAllowsNarration({ type: "slide", video: VIDEO }), true);
});

test("player offline (standalonePlayer.js) e export também ignoram narração no passo de vídeo", () => {
  const sp = read("./standalonePlayer.js");
  assert.match(sp, /function playableCaptionClips\(step\) \{\s*\/\/[^\n]*\n\s*if \(stepVideoLink\(step\)\) return \[\];/);
  assert.match(sp, /const audio = stepVideoLink\(step\) \? null : step\?\.narrationAudio;/);
  assert.match(sp, /setCaption\(caption, step\?\.showCaption !== false && !stepVideoLink\(step\)\);/);
  assert.match(read("./player.js"), /captions: steps\.some\(\(st\) => stepAllowsNarration\(st\) && /);
  assert.match(read("./exportPack.js"), /&& !stepVideo\(step\)/);
});

test("editor: seletor Imagem | Vídeo no padrão do Slide | Tela, i18n e sem narração no vídeo", () => {
  const html = read("../editor.html");
  const media = html.match(/<div class="topbar-modes type-toggle media-toggle" id="prop-media"[\s\S]*?<\/div>/)?.[0];
  assert.ok(media, "#prop-media");
  assert.match(media, /role="radiogroup"/);
  assert.match(media, /class="mode-btn" data-value="image"[\s\S]*data-i18n="media.image"/);
  assert.match(media, /class="mode-btn" data-value="video"[\s\S]*data-i18n="media.video"/);
  assert.doesNotMatch(html, /video-link-head|btn-video-remove/);
  const js = read("./editor.js");
  assert.match(js, /narrSec\.hidden = noNarration/);
  assert.match(js, /railNarr\.hidden = noNarration/);
  assert.match(js, /if \(isVideoMedia\(step\)\) setCanvasCaption\(""/);
  assert.match(read("./mobileBar.js"), /btn\.disabled = off;/);
});
