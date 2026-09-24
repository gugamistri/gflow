import { t, getLocale } from "./i18n.js";
/**
 * Narração via Cartesia Sonic (pt, es, en).
 * why: a chave não entra aqui; o app desktop cifra ela no chaveiro do sistema.
 */

export const CARTESIA_VERSION = "2026-08-14";
export const CARTESIA_MODEL = "sonic-3.6";
/** Voz multilíngue Katie — o locale do pedido define o idioma/sotaque. */
export const CARTESIA_VOICE_ID = "db6b0ed5-d5d3-463d-ae85-518a07d3c2b4";

export const CARTESIA_VOICES = [
  { id: "pt-BR", labelKey: "cartesia.voice.pt-BR", locale: "pt-BR" },
  { id: "pt-PT", labelKey: "cartesia.voice.pt-PT", locale: "pt-PT" },
  { id: "es-ES", labelKey: "cartesia.voice.es-ES", locale: "es-ES" },
  { id: "es-MX", labelKey: "cartesia.voice.es-MX", locale: "es-MX" },
  { id: "en-US", labelKey: "cartesia.voice.en-US", locale: "en-US" },
  { id: "en-GB", labelKey: "cartesia.voice.en-GB", locale: "en-GB" },
];

const API_KEY = /^sk_car_[A-Za-z0-9_-]{12,180}$/;
const LOCALES = new Set(CARTESIA_VOICES.map((voice) => voice.locale));

/** Voz padrão alinhada ao idioma da interface (pt / es / en). */
export function defaultVoiceURI(uiLocale = getLocale()) {
  if (uiLocale === "es") return "es-ES";
  if (uiLocale === "en") return "en-US";
  return "pt-BR";
}

export function resolveNarration(voiceURI) {
  const id = String(voiceURI || "");
  const match = CARTESIA_VOICES.find((voice) => voice.id === id || voice.locale === id);
  const voice = match || CARTESIA_VOICES[0];
  return { locale: voice.locale, voiceId: voice.voiceId || CARTESIA_VOICE_ID };
}

/** Locale BCP-47 para fallback (Google TTS / speechSynthesis). */
export function narrationLang(voiceURI) {
  return resolveNarration(voiceURI).locale;
}

export function isPlausibleApiKey(value) {
  return API_KEY.test(String(value || "").trim());
}

export function isCartesiaKeysUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && url.hostname === "play.cartesia.ai";
  } catch {
    return false;
  }
}

export function maskApiKey(value) {
  const key = String(value || "").trim();
  if (!isPlausibleApiKey(key)) return "";
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

/**
 * hazard: mensagens de erro podem ecoar a chave; só devolvemos o texto redatado.
 */
export function redactSecret(text, secret) {
  const raw = String(text || "");
  const key = String(secret || "");
  if (!key || key.length < 8) return raw;
  return raw.split(key).join("****");
}

export function speechSpeed(rate) {
  const speed = Number(rate);
  if (!Number.isFinite(speed)) return 1;
  return Math.min(1.5, Math.max(0.6, Math.round(speed * 20) / 20));
}

export function ttsRequest({ text, voiceURI, rate } = {}) {
  const narration = resolveNarration(voiceURI);
  if (!LOCALES.has(narration.locale)) {
    throw new Error(t("cartesia.badLocale"));
  }
  return {
    model_id: CARTESIA_MODEL,
    transcript: String(text || "").trim(),
    voice: { id: narration.voiceId },
    locale: narration.locale,
    output_format: { container: "mp3", sample_rate: 44100, bit_rate: 128000 },
    generation_config: { speed: speechSpeed(rate) },
  };
}

const AUDIO_LIMIT = 1024 * 1024 * 8;

function toBase64(buffer) {
  if (typeof Buffer !== "undefined") return Buffer.from(buffer).toString("base64");
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function clip(text) {
  const raw = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return "";
  return raw.length > 180 ? `${raw.slice(0, 179)}…` : raw;
}

export async function synthesizeCartesia({ apiKey, text, voiceURI, rate, fetchImpl = fetch } = {}) {
  const key = String(apiKey || "");
  const body = ttsRequest({ text, voiceURI, rate });
  if (!body.transcript) return { ok: false, error: t("cartesia.noText") };
  let response;
  try {
    response = await fetchImpl("https://api.cartesia.ai/tts/bytes", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Cartesia-Version": CARTESIA_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: t("cartesia.unreachable") };
  }
  if (!response.ok) {
    const detail = redactSecret(await response.text().catch(() => ""), key);
    let message = "";
    try {
      message = JSON.parse(detail).message || "";
    } catch {
      message = detail;
    }
    return { ok: false, error: clip(redactSecret(message, key)) || t("cartesia.synthFail") };
  }
  const audio = await response.arrayBuffer();
  if (!audio.byteLength || audio.byteLength > AUDIO_LIMIT) {
    return { ok: false, error: t("cartesia.badAudio") };
  }
  return { ok: true, audioBase64: toBase64(audio), mime: "audio/mpeg" };
}
