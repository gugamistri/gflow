/**
 * IA e voz hospedadas no GuiaFlow Pro.
 * why: sem chave do usuário o editor pede POST /ai/complete e /tts/synthesize.
 *      Com chave própria o caminho BYOK não passa por aqui.
 *
 * Contrato: { prompt } → { ok, result, usage }
 *           { text, voice? } → { ok, audio: { contentType, base64 }, seconds, usage }
 */

import { cloudFetch } from "./cloudConfig.js";
import { getLocale, t } from "./i18n.js";

export const HOSTED_AI_PATH = "/ai/complete";
export const HOSTED_TTS_PATH = "/tts/synthesize";
export const HOSTED_PROMPT_MAX = 8000;
export const HOSTED_TTS_MAX = 4000;

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function messageText(message) {
  const content = message?.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (typeof block === "string") return block.trim();
      if (block?.type === "text") return String(block.text || "").trim();
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

/** Um único prompt. A imagem fica de fora: a rota só aceita texto. */
export function buildHostedPrompt(messages, locale = getLocale()) {
  const lang = locale || "pt";
  const body = (Array.isArray(messages) ? messages : []).map(messageText).filter(Boolean).join("\n\n");
  const head = [
    `Respond in locale "${lang}".`,
    'Answer ONLY with JSON {"title":"...","description":"...","narration":"..."} using only the keys that apply.',
  ].join("\n");
  const prompt = body ? `${head}\n\n${body}` : head;
  return prompt.slice(0, HOSTED_PROMPT_MAX);
}

function stripFences(raw) {
  return String(raw || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

/**
 * Lê o texto de `result`. JSON entre cercas vira campos.
 * Um pedido de um campo só aceita o texto cru. Vários campos sem JSON falham.
 */
export function parseHostedResult(raw, expected = ["title", "description", "narration"]) {
  const text = stripFences(raw);
  const keys = expected.length ? expected : ["title", "description", "narration"];
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const data = JSON.parse(text.slice(start, end + 1));
      const out = {
        title: String(data?.title || "").trim(),
        description: String(data?.description || "").trim(),
        narration: String(data?.narration || data?.caption || "").trim(),
      };
      const filled = keys.filter((key) => out[key]);
      if (filled.length === keys.length) return { ok: true, ...out };
      if (keys.length === 1 && text && !out[keys[0]]) {
        return { ok: true, title: "", description: "", narration: "", [keys[0]]: text };
      }
    } catch {
      /* o texto não era JSON */
    }
  }
  if (keys.length === 1 && text) {
    return { ok: true, title: "", description: "", narration: "", [keys[0]]: text };
  }
  return { ok: false, title: "", description: "", narration: "" };
}

export function readHostedAudio(data) {
  const audio = asObject(data)?.audio;
  const src = asObject(audio);
  if (!src) return "";
  const mime = String(src.contentType || "audio/mpeg").split(";")[0] || "audio/mpeg";
  const b64 = String(src.base64 || "").replace(/\s/g, "");
  if (b64.length < 4 || !/^[A-Za-z0-9+/=]+$/.test(b64)) return "";
  return `data:${mime};base64,${b64}`;
}

export async function completeHostedCopy(messages, env) {
  const prompt = buildHostedPrompt(messages);
  const result = await cloudFetch(
    HOSTED_AI_PATH,
    {
      method: "POST",
      body: JSON.stringify({ prompt }),
    },
    env
  );
  if (!result.ok) return result;
  const parsed = parseHostedResult(result.data?.result);
  if (!parsed.ok) {
    return { ok: false, error: "bad_response", message: t("billing.badCopy"), data: result.data };
  }
  return {
    ok: true,
    copy: {
      title: parsed.title,
      description: parsed.description,
      narration: parsed.narration,
    },
    data: result.data,
  };
}

export async function synthesizeHostedSpeech(text, { voice } = {}, env) {
  const trimmed = String(text || "").trim().slice(0, HOSTED_TTS_MAX);
  if (!trimmed) return { ok: false, error: "empty", message: "" };
  const body = { text: trimmed };
  const voiceId = String(voice || "").trim();
  if (voiceId) body.voice = voiceId;
  const result = await cloudFetch(
    HOSTED_TTS_PATH,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    env
  );
  if (!result.ok) return result;
  const clip = readHostedAudio(result.data);
  if (!clip) return { ok: false, error: "bad_response", message: t("billing.badAudio"), data: result.data };
  return { ok: true, clip, data: result.data };
}
