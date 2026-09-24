/**
 * Temporizador e narração (TTS + áudio de fundo) do tour.
 */

import { synthesizeCartesia } from "./cartesia.js";
import { readCartesiaKey } from "./cartesia-store.js";

export { CARTESIA_VOICES as NARRATION_VOICES } from "./cartesia.js";

export const DEFAULT_HOLD_SECONDS = 6;
export const BG_VOLUME = 0.22;
export const BG_DUCK_VOLUME = 0.06;
export const CAPTION_PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2];

export function defaultPlayback() {
  return { defaultHoldSeconds: DEFAULT_HOLD_SECONDS };
}

export function defaultNarration() {
  return {
    enabled: true,
    voiceURI: "",
    rate: 1,
    background: null,
  };
}

export function ensurePlayback(demo) {
  if (!demo.playback || typeof demo.playback !== "object") {
    demo.playback = defaultPlayback();
  }
  const n = Number(demo.playback.defaultHoldSeconds);
  if (!Number.isFinite(n) || n <= 0) {
    demo.playback.defaultHoldSeconds = DEFAULT_HOLD_SECONDS;
  }
  return demo.playback;
}

export function ensureNarration(demo) {
  if (!demo.narration || typeof demo.narration !== "object") {
    demo.narration = defaultNarration();
  }
  const n = demo.narration;
  if (typeof n.enabled !== "boolean") n.enabled = true;
  if (typeof n.voiceURI !== "string") n.voiceURI = "";
  const rate = Number(n.rate);
  n.rate = Number.isFinite(rate) ? Math.min(1.4, Math.max(0.7, rate)) : 1;
  if (n.background && typeof n.background === "object") {
    if (!n.background.dataUrl) n.background = null;
  } else {
    n.background = null;
  }
  return demo.narration;
}

export function normalizeCaptionPlaybackRate(rate) {
  const n = Number(rate);
  return CAPTION_PLAYBACK_RATES.includes(n) ? n : 1;
}

/**
 * why: o temporizador do passo não pode terminar antes do áudio, já na velocidade escolhida.
 * @returns {number|null} segundos inteiros, ou null quando não há duração
 */
export function minHoldSecondsForNarration(durationSeconds, playbackRate) {
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const rate = normalizeCaptionPlaybackRate(playbackRate);
  return Math.max(1, Math.ceil(duration / rate - 1e-9));
}

export function minHoldSecondsForStep(step, demo) {
  if (!playableNarrationClips(step, demo).length) return null;
  return minHoldSecondsForNarration(step?.narrationAudio?.durationSeconds, step?.narrationAudio?.playbackRate);
}

export function resolveHoldSeconds(step, demo) {
  const fromStep = Number(step?.holdSeconds);
  let hold;
  if (Number.isFinite(fromStep) && fromStep > 0) hold = fromStep;
  else {
    const playback = demo?.playback || defaultPlayback();
    const fromDemo = Number(playback.defaultHoldSeconds);
    hold = Number.isFinite(fromDemo) && fromDemo > 0 ? fromDemo : DEFAULT_HOLD_SECONDS;
  }
  const floor = minHoldSecondsForStep(step, demo);
  if (floor != null) return Math.max(hold, floor);
  return hold;
}

export function holdMs(step, demo) {
  return Math.round(resolveHoldSeconds(step, demo) * 1000);
}


export function listSpeechVoices() {
  if (typeof window === "undefined" || !window.speechSynthesis) return [];
  return window.speechSynthesis.getVoices() || [];
}

export function pickVoice(voiceURI) {
  const voices = listSpeechVoices();
  if (!voices.length) return null;
  if (voiceURI) {
    const exact = voices.find((v) => v.voiceURI === voiceURI);
    if (exact) return exact;
  }
  return (
    voices.find((v) => /^pt(-|$)/i.test(v.lang || "")) ||
    voices.find((v) => /portugu/i.test(v.name || "")) ||
    voices[0] ||
    null
  );
}

let speakToken = 0;
let currentSpeech = null;

export function stopSpeech() {
  speakToken += 1;
  if (currentSpeech) {
    currentSpeech.pause();
    currentSpeech.removeAttribute("src");
    currentSpeech.load();
    currentSpeech = null;
  }
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

function narrationLang(voiceURI) {
  return voiceURI === "pt-PT" ? "pt-PT" : "pt-BR";
}

function splitForSpeech(text, max = 180) {
  const parts = [];
  let rest = String(text || "").trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf(" ", max);
    if (cut < 40) cut = max;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

function playSpeechUrl(url, rate, token) {
  return new Promise((resolve, reject) => {
    if (token !== speakToken || typeof Audio === "undefined") {
      resolve();
      return;
    }
    const audio = new Audio();
    currentSpeech = audio;
    const speed = Math.min(2, Math.max(0.7, Number(rate) || 1));
    audio.referrerPolicy = "no-referrer";
    audio.preload = "auto";
    const applyRate = () => {
      audio.playbackRate = speed;
    };
    audio.addEventListener("loadedmetadata", applyRate);
    audio.addEventListener("ended", () => resolve(), { once: true });
    audio.addEventListener("error", () => reject(new Error("tts")), { once: true });
    audio.src = url;
    applyRate();
    audio.play().catch(reject);
  });
}

function speakWithBrowser(text, rate, token) {
  return new Promise((resolve) => {
    if (token !== speakToken || typeof window === "undefined" || !window.speechSynthesis) {
      resolve();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "pt-BR";
    utterance.rate = Math.min(1.4, Math.max(0.7, Number(rate) || 1));
    const voice = pickVoice("");
    if (voice) {
      utterance.voice = voice;
      if (voice.lang) utterance.lang = voice.lang;
    }
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.speak(utterance);
  });
}

/**
 * why: no navegador a chave vem do banco local; no app desktop, do chaveiro.
 * @returns {Promise<boolean>} true quando algum trecho Cartesia tocou
 */
async function speakWithCartesia(text, voiceURI, rate, token) {
  const bridge = typeof window !== "undefined" ? window.guiaDesktopApp?.cartesiaSpeak : null;
  let apiKey = "";
  if (!bridge) {
    try {
      apiKey = await readCartesiaKey();
    } catch {
      return false;
    }
    if (!apiKey) return false;
  }
  const parts = splitForSpeech(text, 1500);
  let played = false;
  try {
    for (const part of parts) {
      if (token !== speakToken) return true;
      const result = bridge
        ? await bridge({ text: part, voiceURI, rate })
        : await synthesizeCartesia({ apiKey, text: part, voiceURI, rate });
      if (token !== speakToken) return true;
      if (!result?.ok || !result.audioBase64) return played;
      const mime = result.mime || "audio/mpeg";
      await playSpeechUrl(`data:${mime};base64,${result.audioBase64}`, 1, token);
      played = true;
    }
  } catch {
    return played;
  }
  return played;
}

function audioDataClips(audio) {
  if (!Array.isArray(audio?.clips)) return [];
  return audio.clips.filter((url) => typeof url === "string" && url.startsWith("data:audio/"));
}

/**
 * why: upload fica válido ao editar o texto; TTS só vale com o mesmo texto, voz e taxa.
 */
export function savedNarrationClips(step, demo) {
  const audio = step?.narrationAudio;
  if (!audio) return [];
  const clips = audioDataClips(audio);
  if (!clips.length) return [];
  if (audio.source === "upload") return clips;
  const caption = String(step?.caption || "").trim();
  if (!caption || audio.caption !== caption) return [];
  ensureNarration(demo);
  if ((audio.voiceURI || "") !== (demo.narration.voiceURI || "")) return [];
  const savedRate = Number(audio.rate);
  const rate = Number(demo.narration.rate);
  if (!Number.isFinite(savedRate) || Math.abs(savedRate - rate) > 0.001) return [];
  return clips;
}

/**
 * why: na reprodução/preview tocamos o áudio salvo mesmo se o TTS estiver desatualizado.
 */
export function playableNarrationClips(step, demo) {
  const saved = savedNarrationClips(step, demo);
  if (saved.length) return saved;
  return audioDataClips(step?.narrationAudio);
}

export function stepShowsCaption(step) {
  return step?.showCaption !== false;
}

/**
 * why: a API só entra aqui; a reprodução usa os clipes já salvos no passo.
 */
export async function generateNarrationClips(text, { voiceURI, rate } = {}) {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw new Error("Escreva uma legenda para gerar o áudio.");
  const bridge = typeof window !== "undefined" ? window.guiaDesktopApp?.cartesiaSpeak : null;
  let apiKey = "";
  if (!bridge) {
    apiKey = await readCartesiaKey();
    if (!apiKey) throw new Error("Salve a chave da Cartesia antes de gerar.");
  }
  const parts = splitForSpeech(trimmed, 1500);
  const clips = [];
  for (const part of parts) {
    const result = bridge
      ? await bridge({ text: part, voiceURI, rate })
      : await synthesizeCartesia({ apiKey, text: part, voiceURI, rate });
    if (!result?.ok || !result.audioBase64) {
      throw new Error(result?.error || "A síntese falhou.");
    }
    clips.push(`data:${result.mime || "audio/mpeg"};base64,${result.audioBase64}`);
  }
  return clips;
}

export function playNarrationClips(clips, rate = 1) {
  stopSpeech();
  const token = speakToken;
  const list = Array.isArray(clips) ? clips : [];
  const speed = normalizeCaptionPlaybackRate(rate);
  return (async () => {
    for (const url of list) {
      if (token !== speakToken || !url) return;
      await playSpeechUrl(url, speed, token);
    }
  })();
}

/**
 * Fala um texto com a voz/velocidade do projeto.
 * @returns {Promise<void>}
 */
export function speakText(text, { voiceURI, rate } = {}) {
  stopSpeech();
  const token = speakToken;
  const trimmed = String(text || "").trim();
  if (!trimmed || typeof window === "undefined") return Promise.resolve();
  const lang = narrationLang(voiceURI);
  const parts = splitForSpeech(trimmed);
  return (async () => {
    const usedCartesia = await speakWithCartesia(trimmed, voiceURI, rate, token);
    if (usedCartesia || token !== speakToken) return;
    let played = false;
    try {
      for (const part of parts) {
        if (token !== speakToken) return;
        const url =
          "https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=" +
          encodeURIComponent(lang) +
          "&q=" +
          encodeURIComponent(part);
        await playSpeechUrl(url, rate, token);
        played = true;
      }
    } catch {
      if (token !== speakToken || played) return;
      await speakWithBrowser(trimmed, rate, token);
    }
  })();
}

/**
 * Controla legenda, TTS e áudio de fundo durante a reprodução.
 */
export function createNarrationController({ captionEl } = {}) {
  let bgAudio = null;
  let speakToken = 0;
  let speakDone = Promise.resolve();

  function setCaption(text, { visible = true } = {}) {
    if (!captionEl) return;
    const trimmed = String(text || "").trim();
    captionEl.textContent = trimmed;
    captionEl.hidden = !visible || !trimmed;
  }

  function duck(active) {
    if (!bgAudio) return;
    bgAudio.volume = active ? BG_DUCK_VOLUME : BG_VOLUME;
  }

  async function ensureBackground(demo) {
    ensureNarration(demo);
    const src = demo.narration.background?.dataUrl;
    if (!src) {
      stopBackground();
      return;
    }
    if (bgAudio && bgAudio.dataset.src === src) {
      if (bgAudio.paused) {
        try {
          await bgAudio.play();
        } catch {
          /* autoplay bloqueado até gesto */
        }
      }
      return;
    }
    stopBackground();
    bgAudio = new Audio(src);
    bgAudio.dataset.src = src;
    bgAudio.loop = true;
    bgAudio.volume = BG_VOLUME;
    try {
      await bgAudio.play();
    } catch {
      /* gesto do usuário (Assistir) costuma liberar na próxima */
    }
  }

  function stopBackground() {
    if (!bgAudio) return;
    bgAudio.pause();
    bgAudio.src = "";
    bgAudio = null;
  }

  return {
    setCaption,

    async startTour(demo) {
      await ensureBackground(demo);
    },

    /**
     * Atualiza legenda e, se `speak` for true e narração ligada, fala o caption.
     * @returns {Promise<void>} resolvida quando a fala terminar (ou imediatamente)
     */
    enterStep(step, demo, { speak = false } = {}) {
      ensureNarration(demo);
      const caption = String(step?.caption || "").trim();
      setCaption(caption, { visible: stepShowsCaption(step) });

      const runId = ++speakToken;
      stopSpeech();
      duck(false);

      const clips = playableNarrationClips(step, demo);
      if (!speak || !clips.length) {
        speakDone = Promise.resolve();
        return speakDone;
      }

      duck(true);
      speakDone = playNarrationClips(clips, step?.narrationAudio?.playbackRate).then(() => {
        if (runId === speakToken) duck(false);
      });
      return speakDone;
    },

    whenSpeechDone() {
      return speakDone;
    },

    stop() {
      speakToken += 1;
      stopSpeech();
      stopBackground();
      setCaption("");
      speakDone = Promise.resolve();
    },
  };
}
