import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_HOLD_SECONDS,
  defaultNarration,
  defaultPlayback,
  ensureNarration,
  ensurePlayback,
  holdMs,
  minHoldSecondsForNarration,
  normalizeCaptionPlaybackRate,
  playableNarrationClips,
  resolveHoldSeconds,
  savedNarrationClips,
} from "./playback.js";

test("padrão de hold é 6 segundos", () => {
  assert.equal(DEFAULT_HOLD_SECONDS, 6);
  assert.equal(defaultPlayback().defaultHoldSeconds, 6);
});

test("resolveHoldSeconds usa passo, depois projeto, depois padrão", () => {
  assert.equal(resolveHoldSeconds({ holdSeconds: 3 }, { playback: { defaultHoldSeconds: 9 } }), 3);
  assert.equal(resolveHoldSeconds({}, { playback: { defaultHoldSeconds: 9 } }), 9);
  assert.equal(resolveHoldSeconds({}, {}), 6);
  assert.equal(holdMs({ holdSeconds: 2 }, {}), 2000);
});

test("ensurePlayback e ensureNarration preenchem ausentes", () => {
  const demo = {};
  ensurePlayback(demo);
  ensureNarration(demo);
  assert.equal(demo.playback.defaultHoldSeconds, 6);
  assert.equal(demo.narration.enabled, true);
  assert.equal(demo.narration.rate, 1);
  assert.equal(demo.narration.background, null);
});

test("savedNarrationClips exige o mesmo texto, voz e taxa no TTS", () => {
  const step = {
    caption: "Olá",
    narrationAudio: {
      source: "tts",
      caption: "Olá",
      voiceURI: "pt-BR",
      rate: 1,
      clips: ["data:audio/mpeg;base64,YQ=="],
    },
  };
  const demo = { narration: { enabled: true, voiceURI: "pt-BR", rate: 1, background: null } };
  assert.deepEqual(savedNarrationClips(step, demo), ["data:audio/mpeg;base64,YQ=="]);
  step.caption = "Oi";
  assert.deepEqual(savedNarrationClips(step, demo), []);
  step.caption = "Olá";
  step.narrationAudio.clips = ["https://evil.test/a.mp3"];
  assert.deepEqual(savedNarrationClips(step, demo), []);
});

test("áudio enviado permanece válido ao mudar o texto", () => {
  const step = {
    caption: "Texto A",
    narrationAudio: {
      source: "upload",
      name: "voz.mp3",
      caption: "Texto A",
      playbackRate: 1,
      durationSeconds: 4,
      clips: ["data:audio/mpeg;base64,YQ=="],
    },
  };
  const demo = { narration: { enabled: true, voiceURI: "pt-PT", rate: 1.2, background: null } };
  assert.deepEqual(savedNarrationClips(step, demo), ["data:audio/mpeg;base64,YQ=="]);
  step.caption = "Texto B";
  assert.deepEqual(savedNarrationClips(step, demo), ["data:audio/mpeg;base64,YQ=="]);
  assert.equal(resolveHoldSeconds({ ...step, holdSeconds: 1 }, { ...demo, playback: { defaultHoldSeconds: 6 } }), 4);
});

test("playableNarrationClips usa áudio TTS mesmo desatualizado", () => {
  const step = {
    caption: "Novo",
    narrationAudio: {
      source: "tts",
      caption: "Antigo",
      voiceURI: "pt-BR",
      rate: 1,
      clips: ["data:audio/mpeg;base64,YQ=="],
    },
  };
  const demo = { narration: { enabled: true, voiceURI: "pt-BR", rate: 1, background: null } };
  assert.deepEqual(savedNarrationClips(step, demo), []);
  assert.deepEqual(playableNarrationClips(step, demo), ["data:audio/mpeg;base64,YQ=="]);
});

test("temporizador não fica abaixo da duração do áudio", () => {
  assert.equal(minHoldSecondsForNarration(17.47, 1), 18);
  assert.equal(minHoldSecondsForNarration(10, 2), 5);
  assert.equal(minHoldSecondsForNarration(10, 9), 10);
  assert.equal(minHoldSecondsForNarration(0, 1), null);
  assert.equal(normalizeCaptionPlaybackRate(1.25), 1.25);
  assert.equal(normalizeCaptionPlaybackRate(1.3), 1);

  const demo = {
    narration: { enabled: true, voiceURI: "pt-BR", rate: 1, background: null },
    playback: { defaultHoldSeconds: 6 },
  };
  const step = {
    caption: "Olá",
    holdSeconds: 2,
    narrationAudio: {
      source: "tts",
      caption: "Olá",
      voiceURI: "pt-BR",
      rate: 1,
      playbackRate: 1,
      durationSeconds: 9.2,
      clips: ["data:audio/mpeg;base64,YQ=="],
    },
  };
  assert.equal(resolveHoldSeconds(step, demo), 10);
  step.holdSeconds = 30;
  assert.equal(resolveHoldSeconds(step, demo), 30);
  delete step.holdSeconds;
  assert.equal(resolveHoldSeconds(step, demo), 10);
  step.narrationAudio.playbackRate = 2;
  assert.equal(resolveHoldSeconds(step, demo), 6);
  step.caption = "Outro";
  step.holdSeconds = 2;
  // why: o áudio antigo ainda toca na reprodução, então o piso permanece
  assert.equal(resolveHoldSeconds(step, demo), 5);
});

test("defaultNarration traz campos esperados", () => {
  const n = defaultNarration();
  assert.equal(n.enabled, true);
  assert.equal(n.voiceURI, "");
  assert.equal(n.rate, 1);
  assert.equal(n.background, null);
});
