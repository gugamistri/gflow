import { t, getLocale } from "./i18n.js";
/**
 * Narração via Cartesia Sonic (pt, es, en).
 * why: a chave não entra aqui; o app desktop cifra ela no chaveiro do sistema.
 */

export const CARTESIA_VERSION = "2026-08-14";
export const CARTESIA_MODEL = "sonic-3.6";
/** Voz antiga (Skylar, multilíngue americana): fallback quando o idioma não tem catálogo. */
export const CARTESIA_VOICE_ID = "db6b0ed5-d5d3-463d-ae85-518a07d3c2b4";

/** Idiomas da Sonic 3.6 (docs.cartesia.ai, 44 idiomas): narração por idioma do tour (PRD multi-idioma §5.4). */
export const CARTESIA_LANGUAGES = Object.freeze(["en", "fr", "de", "es", "pt", "zh", "ja", "hi", "it", "ko", "nl", "pl", "ru", "sv", "tr", "tl", "bg", "ro", "ar", "cs", "el", "fi", "hr", "ms", "sk", "da", "ta", "uk", "hu", "no", "vi", "bn", "th", "he", "ka", "id", "te", "gu", "kn", "ml", "mr", "pa", "or", "ur"]);

/** Vozes padrão curadas (Q9) para os demais idiomas do top 10; a lista completa vem de /voices. */
export const CARTESIA_CURATED_DEFAULTS = Object.freeze({
  fr: { id: "7c58f4a4-a72c-42fa-a503-41b9408820f3", name: "Inès" },
  de: { id: "57a3a9e0-a91c-4c94-a2bb-e6cbab3ae649", name: "Clemens" },
  it: { id: "00e9ec78-2002-41dd-8d19-6b1d3b17a461", name: "Elena" },
  ja: { id: "cb21b4af-0e46-44f7-9128-51be7f898311", name: "Yuzuki" },
  zh: { id: "6eb8965c-e295-47bd-a9e4-3eeebb3abcff", name: "Jing" },
  ko: { id: "1a602be4-3b57-4bef-a270-dfa5efed0541", name: "Yeji" },
  hi: { id: "4459a9a5-69d6-4680-b970-e13dc51845b6", name: "Siya" },
});

/** Idioma da narração (locale da Sonic). O id é o voiceURI salvo no projeto (compatível). */
export const CARTESIA_VOICES = [
  { id: "pt-BR", labelKey: "cartesia.voice.pt-BR", locale: "pt-BR", language: "pt" },
  { id: "pt-PT", labelKey: "cartesia.voice.pt-PT", locale: "pt-PT", language: "pt" },
  { id: "es-ES", labelKey: "cartesia.voice.es-ES", locale: "es-ES", language: "es" },
  { id: "es-MX", labelKey: "cartesia.voice.es-MX", locale: "es-MX", language: "es" },
  { id: "en-US", labelKey: "cartesia.voice.en-US", locale: "en-US", language: "en" },
  { id: "en-GB", labelKey: "cartesia.voice.en-GB", locale: "en-GB", language: "en" },
];

/**
 * Vozes nativas por idioma (catálogo da Cartesia, /voices?language=…). O primeiro item é o padrão.
 * why: uma voz multilíngue fala outro idioma com sotaque; cada idioma precisa de voz nativa.
 */
export const CARTESIA_VOICE_CATALOG = {
  pt: [
    { id: "c9611be8-aae9-4a93-bb1c-98dd6b7d52a4", name: "Isabella", gender: "f" },
    { id: "6a360542-a117-4ed5-9e09-e8bf9b05eabb", name: "Tiago", gender: "m" },
    { id: "cb2694c3-715f-4da9-99f3-1c974fff2928", name: "Eloá", gender: "f" },
    { id: "616c64d7-f541-436b-9b8d-e79cfbe19ef9", name: "Felipe", gender: "m" },
    { id: "d4b44b9a-82bc-4b65-b456-763fce4c52f9", name: "Beatriz", gender: "f" },
    { id: "28a942b5-74f3-47bb-9b56-4c3f2562d3ba", name: "Gustavo", gender: "m" },
  ],
  en: [
    { id: "a33f7a4c-100f-41cf-a1fd-5822e8fc253f", name: "Lauren", gender: "f" },
    { id: "79f8b5fb-2cc8-479a-80df-29f7a7cf1a3e", name: "Theo", gender: "m" },
    { id: "db6b0ed5-d5d3-463d-ae85-518a07d3c2b4", name: "Skylar", gender: "f" },
    { id: "0ee8beaa-db49-4024-940d-c7ea09b590b3", name: "Morgan", gender: "f" },
    { id: "a5136bf9-224c-4d76-b823-52bd5efcffcc", name: "Jameson", gender: "m" },
    { id: "62ae83ad-4f6a-430b-af41-a9bede9286ca", name: "Gemma (UK)", gender: "f" },
  ],
  es: [
    { id: "3597a26f-80ef-4bd5-8101-9699bc764917", name: "Ximena", gender: "f" },
    { id: "2fc4f1ec-bfd0-46f1-8e6d-d4279eaaf838", name: "Mateo", gender: "m" },
    { id: "b4b8e2af-6139-466e-a93a-30c20d2e1fc5", name: "Fernanda", gender: "f" },
    { id: "de38f545-c574-44e8-9b54-a7d6fec1c6b1", name: "Marta (ES)", gender: "f" },
    { id: "b5aa8098-49ef-475d-89b0-c9262ecf33fd", name: "Luis (ES)", gender: "m" },
    { id: "bef24f4f-adc9-4cef-acbf-cc1ceb98224b", name: "Santiago", gender: "m" },
  ],
};

export const DEFAULT_VOICE_BY_LANGUAGE = Object.fromEntries(
  Object.entries(CARTESIA_VOICE_CATALOG).map(([lang, list]) => [lang, list[0].id])
);

const API_KEY = /^sk_car_[A-Za-z0-9_-]{12,180}$/;
const VOICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCALES = new Set(CARTESIA_VOICES.map((voice) => voice.locale));

/** Voz padrão alinhada ao idioma da interface (pt / es / en). */
export function defaultVoiceURI(uiLocale = getLocale()) {
  if (uiLocale === "es") return "es-ES";
  if (uiLocale === "en") return "en-US";
  return "pt-BR";
}

export function isVoiceId(value) {
  return VOICE_ID.test(String(value || "").trim());
}

/** Idioma base (pt / en / es) do voiceURI/locale da narração. */
export function narrationLanguage(voiceURI) {
  const raw = String(voiceURI || "");
  const match = CARTESIA_VOICES.find((voice) => voice.id === raw || voice.locale === raw);
  if (match) return match.language;
  const base = raw.slice(0, 2).toLowerCase();
  return CARTESIA_VOICE_CATALOG[base] ? base : "pt";
}

export function voicesForLanguage(language) {
  return CARTESIA_VOICE_CATALOG[language] || [];
}

/** Idioma ao qual uma voz do catálogo pertence (ou "" se não é do catálogo). */
export function voiceLanguage(voiceId) {
  const id = String(voiceId || "").trim();
  for (const [lang, list] of Object.entries(CARTESIA_VOICE_CATALOG)) {
    if (list.some((voice) => voice.id === id)) return lang;
  }
  return "";
}

/**
 * Voz efetiva para o idioma: a escolhida (se for desse idioma) ou a padrão nativa.
 * why: uma voz salva para pt não pode vazar para um tour em inglês.
 */
export function voiceForLanguage(language, chosen) {
  const id = String(chosen || "").trim();
  if (isVoiceId(id)) {
    const owner = voiceLanguage(id);
    if (!owner || owner === language) return id;
  }
  return DEFAULT_VOICE_BY_LANGUAGE[language] || CARTESIA_VOICE_ID;
}

export function resolveNarration(voiceURI, voiceId = "") {
  const id = String(voiceURI || "");
  const match = CARTESIA_VOICES.find((voice) => voice.id === id || voice.locale === id);
  const voice = match || CARTESIA_VOICES[0];
  return {
    locale: voice.locale,
    language: voice.language,
    voiceId: voiceForLanguage(voice.language, voiceId),
  };
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

export function ttsRequest({ text, voiceURI, voiceId, rate, language } = {}) {
  const lang = String(language || "").trim().toLowerCase().split(/[-_]/)[0];
  if (lang && CARTESIA_LANGUAGES.includes(lang) && !CARTESIA_VOICE_CATALOG[lang]) {
    // why: idioma-alvo fora do catálogo curado (fr, de…): a voz vem do painel Idiomas
    if (!isVoiceId(voiceId)) throw new Error(t("cartesia.needVoice"));
    return {
      model_id: CARTESIA_MODEL,
      transcript: String(text || "").trim(),
      voice: { id: String(voiceId).trim() },
      language: lang,
      output_format: { container: "mp3", sample_rate: 44100, bit_rate: 64000 },
      generation_config: { speed: speechSpeed(rate) },
    };
  }
  const narration = resolveNarration(voiceURI, voiceId);
  if (!LOCALES.has(narration.locale)) {
    throw new Error(t("cartesia.badLocale"));
  }
  return {
    model_id: CARTESIA_MODEL,
    transcript: String(text || "").trim(),
    voice: { id: narration.voiceId },
    // why: language define a pronúncia (a Cartesia não aceita language e locale juntos)
    language: narration.language,
    // why: voz não precisa de 128 kbps; 64 kbps corta a narração pela metade e segue MP3 (toca no iOS)
    output_format: { container: "mp3", sample_rate: 44100, bit_rate: 64000 },
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

export async function synthesizeCartesia({ apiKey, text, voiceURI, voiceId, rate, language, fetchImpl = fetch } = {}) {
  const key = String(apiKey || "");
  let body;
  try {
    body = ttsRequest({ text, voiceURI, voiceId, rate, language });
  } catch (err) {
    return { ok: false, error: err.message };
  }
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

/** Vozes da Cartesia para um idioma, com a chave do autor (BYOK). [{ id, name, gender }] */
export async function listCartesiaVoices({ apiKey, language, fetchImpl = fetch } = {}) {
  const lang = String(language || "").trim().toLowerCase().split(/[-_]/)[0];
  if (!CARTESIA_LANGUAGES.includes(lang)) return [];
  const url = `https://api.cartesia.ai/voices?language=${encodeURIComponent(lang)}&limit=100`;
  const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${String(apiKey || "")}`, "Cartesia-Version": CARTESIA_VERSION } });
  if (!response.ok) return [];
  const data = await response.json().catch(() => null);
  return voicesFromCartesia(data, lang);
}

/** Normaliza a resposta de /voices (data[] ou array), só vozes do idioma. */
export function voicesFromCartesia(data, lang) {
  const list = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
  return list
    .filter((v) => isVoiceId(v?.id) && String(v.language || "").toLowerCase().split(/[-_]/)[0] === lang)
    .slice(0, 60)
    .map((v) => ({ id: String(v.id).toLowerCase(), name: String(v.name || v.id).slice(0, 60), gender: /^f/i.test(v.gender || "") ? "f" : /^m/i.test(v.gender || "") ? "m" : "" }));
}
