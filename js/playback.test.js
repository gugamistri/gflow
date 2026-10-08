import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_HOLD_SECONDS,
  createNarrationController,
  defaultNarration,
  defaultPlayback,
  ensureNarration,
  ensurePlayback,
  holdMs,
  liftCaptionAboveOverlay,
  minHoldSecondsForNarration,
  normalizeCaptionPlaybackRate,
  formatHoldClock,
  playableNarrationClips,
  resolveHoldSeconds,
  restoreCaptionHome,
  savedNarrationClips,
  stepShowsCaption,
  tourHoldSeconds,
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

test("duração do tour soma o hold efetivo de cada passo", () => {
  const demo = {
    playback: { defaultHoldSeconds: 6 },
    narration: { enabled: true, voiceURI: "pt-BR", rate: 1, background: null },
    steps: [
      { type: "slide", holdSeconds: 3 },
      { type: "screen" },
      {
        type: "screen",
        holdSeconds: 2,
        caption: "Olá",
        narrationAudio: {
          source: "upload",
          durationSeconds: 17.2,
          playbackRate: 1,
          clips: ["data:audio/mpeg;base64,YQ=="],
        },
      },
    ],
  };
  assert.equal(tourHoldSeconds(demo), 27);
  assert.equal(formatHoldClock(27), "0:27");
  assert.equal(formatHoldClock(220), "3:40");
  assert.equal(formatHoldClock(3600), "60:00");
  assert.equal(tourHoldSeconds({ steps: [] }), 0);
  assert.equal(formatHoldClock(0), "0:00");
});

test("mostrar texto fica visível salvo quando o passo desliga", () => {
  assert.equal(stepShowsCaption({ caption: "Olá" }), true);
  assert.equal(stepShowsCaption({ caption: "Olá", showCaption: true }), true);
  assert.equal(stepShowsCaption({ caption: "Olá", showCaption: false }), false);
  assert.equal(stepShowsCaption({}), true);
});

test("a legenda do preview sai do palco para ficar acima do véu", () => {
  const moved = [];
  const home = {
    appendChild(node) {
      node.parentElement = home;
      moved.push("home");
    },
  };
  const body = {
    appendChild(node) {
      node.parentElement = body;
      moved.push("body");
    },
  };
  const classNames = new Set();
  const caption = {
    parentElement: home,
    classList: {
      add(name) {
        classNames.add(name);
      },
      remove(name) {
        classNames.delete(name);
      },
    },
  };
  globalThis.document = { body };
  try {
    const previous = liftCaptionAboveOverlay(caption);
    assert.equal(previous, home);
    assert.equal(caption.parentElement, body);
    assert.equal(classNames.has("is-above-overlay"), true);
    assert.equal(liftCaptionAboveOverlay(caption), null);
    restoreCaptionHome(caption, previous);
    assert.equal(caption.parentElement, home);
    assert.equal(classNames.has("is-above-overlay"), false);
    assert.deepEqual(moved, ["body", "home"]);
  } finally {
    delete globalThis.document;
  }
});

test("defaultNarration traz campos esperados", () => {
  const n = defaultNarration();
  assert.equal(n.enabled, true);
  assert.equal(n.voiceURI, "");
  assert.equal(n.rate, 1);
  assert.equal(n.background, null);
});

test("enterStep não reproduz áudio quando narration.enabled é false", async () => {
  const captionEl = { textContent: "", hidden: true };
  const ctrl = createNarrationController({ captionEl });
  const step = {
    caption: "Olá",
    showCaption: true,
    narrationAudio: {
      source: "upload",
      clips: ["data:audio/mpeg;base64,YQ=="],
      playbackRate: 1,
    },
  };
  const demo = { narration: { enabled: false, voiceURI: "", rate: 1, background: null } };
  await ctrl.enterStep(step, demo, { speak: true });
  assert.equal(captionEl.textContent, "Olá");
  assert.equal(captionEl.hidden, false);
});
