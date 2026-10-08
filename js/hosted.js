/**
 * IA e voz hospedadas no GuiaFlow Pro.
 * why: sem chave do usuário o editor pede POST /ai/complete e /tts/synthesize.
 *      Com chave própria o caminho BYOK não passa por aqui.
 */

import { cloudFetch } from "./cloudConfig.js";
import { getLocale } from "./i18n.js";
import { parseCopyJson } from "./llm.js";

export const HOSTED_AI_PATH = "/ai/complete";
export const HOSTED_TTS_PATH = "/tts/synthesize";

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

export function readHostedCopy(data) {
  const body = asObject(data) || {};
  const nested = asObject(body.copy) || asObject(body.result);
  const src = nested ? { ...body, ...nested } : body;
  const title = String(src.title || "").trim();
  const description = String(src.description || "").trim();
  const narration = String(src.narration || src.caption || "").trim();
  if (title && description && narration) return { title, description, narration };
  const choice = src.choices?.[0]?.message?.content;
  const content =
    (typeof src.content === "string" && src.content) ||
    (typeof src.text === "string" && src.text) ||
    (typeof choice === "string" && choice) ||
    "";
  return parseCopyJson(content);
}

export function readHostedAudio(data) {
  const body = asObject(data) || {};
  const nested = asObject(body.tts) || asObject(body.result) || asObject(body.audio);
  const src = nested ? { ...body, ...nested } : body;
  const mime = String(src.mime || src.contentType || "audio/mpeg").split(";")[0] || "audio/mpeg";
  const dataUrl = String(src.dataUrl || "").trim();
  if (dataUrl.startsWith("data:audio/")) return dataUrl;
  const remote = String(src.url || src.audioUrl || "").trim();
  if (/^https?:\/\//i.test(remote)) return remote;
  const raw = String(src.audioBase64 || (typeof body.audio === "string" ? body.audio : "") || src.base64 || "").trim();
  if (raw.startsWith("data:audio/")) return raw;
  const b64 = raw.replace(/\s/g, "");
  if (b64.length >= 4 && /^[A-Za-z0-9+/=]+$/.test(b64)) return `data:${mime};base64,${b64}`;
  return "";
}

export async function completeHostedCopy(messages, env) {
  const result = await cloudFetch(
    HOSTED_AI_PATH,
    {
      method: "POST",
      body: JSON.stringify({
        messages: Array.isArray(messages) ? messages : [],
        locale: getLocale(),
      }),
    },
    env
  );
  if (!result.ok) return result;
  const copy = readHostedCopy(result.data);
  if (!copy) return { ok: false, error: "bad_response", message: "", data: result.data };
  return { ok: true, copy, data: result.data };
}

export async function synthesizeHostedSpeech(text, { locale } = {}, env) {
  const trimmed = String(text || "").trim().slice(0, 4000);
  if (!trimmed) return { ok: false, error: "empty", message: "" };
  const result = await cloudFetch(
    HOSTED_TTS_PATH,
    {
      method: "POST",
      body: JSON.stringify({ text: trimmed, locale: locale || "pt-BR" }),
    },
    env
  );
  if (!result.ok) return result;
  const clip = readHostedAudio(result.data);
  if (!clip) return { ok: false, error: "bad_response", message: "", data: result.data };
  return { ok: true, clip, data: result.data };
}
