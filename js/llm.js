/**
 * Cliente OpenAI-compatível (OpenRouter / OpenAI / URL custom).
 * why: a chave e o modelo ficam fora do JSON do projeto; a captura do passo é a entrada principal.
 */

import { t, getLocale } from "./i18n.js";

export const LLM_DEFAULT_PROVIDER = "openrouter";
export const LLM_DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash";
/** why: 512 era pouco — o DeepSeek gastava tudo em reasoning e o content vinha vazio (finish_reason=length). */
export const LLM_MAX_TOKENS = 1024;
/**
 * why: copy JSON não precisa pensar; none evita reasoning_tokens cobrados e content vazio.
 * hazard: omitir o campo `reasoning` no DeepSeek V4.1 volta ao padrão high.
 */
export const LLM_REASONING = { effort: "none", exclude: true };
export const LLM_CONTEXT_STEPS = 12;
export const LLM_TEXT_CLIP = 280;
export const LLM_IMAGE_MAX_SIDE = 1600;

export const LLM_PROVIDERS = {
  openrouter: {
    id: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    keysUrl: "https://openrouter.ai/keys",
  },
  openai: {
    id: "openai",
    baseUrl: "https://api.openai.com/v1",
    keysUrl: "https://platform.openai.com/api-keys",
  },
  custom: {
    id: "custom",
    baseUrl: "",
    keysUrl: "",
  },
};

const KEY_MIN = 8;
const KEY_MAX = 512;

export function isPlausibleLlmKey(value) {
  const key = String(value || "").trim();
  if (key.length < KEY_MIN || key.length > KEY_MAX) return false;
  if (/\s/.test(key)) return false;
  return true;
}

export function maskLlmKey(value) {
  const key = String(value || "").trim();
  if (!isPlausibleLlmKey(key)) return "";
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

/** hazard: mensagens de erro podem ecoar a chave; só devolvemos o texto redatado. */
export function redactSecret(text, secret) {
  const raw = String(text || "");
  const key = String(secret || "");
  if (!key || key.length < 8) return raw;
  return raw.split(key).join("****");
}

export function normalizeBaseUrl(value) {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
  } catch {
    return "";
  }
}

export function resolveProvider(providerId, customBaseUrl = "") {
  const id = String(providerId || LLM_DEFAULT_PROVIDER);
  if (id === "custom") {
    return {
      id: "custom",
      baseUrl: normalizeBaseUrl(customBaseUrl),
      keysUrl: "",
    };
  }
  const preset = LLM_PROVIDERS[id] || LLM_PROVIDERS.openrouter;
  return { id: preset.id, baseUrl: preset.baseUrl, keysUrl: preset.keysUrl };
}

export function defaultLlmSettings() {
  return {
    provider: LLM_DEFAULT_PROVIDER,
    baseUrl: LLM_PROVIDERS.openrouter.baseUrl,
    model: LLM_DEFAULT_MODEL,
    apiKey: "",
  };
}

function clipText(value, limit = LLM_TEXT_CLIP) {
  const raw = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return "";
  return raw.length > limit ? `${raw.slice(0, limit - 1)}…` : raw;
}

/**
 * Passos anteriores ao índice atual — só texto, para storytelling.
 * invariant: nunca inclui o passo atual nem os seguintes.
 */
export function buildStepContext(steps, currentIndex, { limit = LLM_CONTEXT_STEPS } = {}) {
  const list = Array.isArray(steps) ? steps : [];
  const idx = Math.max(0, Number(currentIndex) || 0);
  const prior = list.slice(0, idx).slice(-limit);
  return prior.map((step, i) => {
    const n = idx - prior.length + i + 1;
    const title = clipText(step?.popover?.title || step?.label || "");
    const description = clipText(step?.popover?.description || "");
    const caption = clipText(step?.caption || "");
    const type = step?.type === "slide" ? "slide" : "screen";
    const scene = Number(step?.scene) || 1;
    return { n, type, scene, title, description, caption };
  });
}

export function formatContextBlock(context) {
  if (!Array.isArray(context) || !context.length) return "";
  return context
    .map((c) => {
      const parts = [`#${c.n} (${c.type}, cena ${c.scene})`];
      if (c.title) parts.push(`título: ${c.title}`);
      if (c.description) parts.push(`descrição: ${c.description}`);
      if (c.caption) parts.push(`narração: ${c.caption}`);
      return parts.join(" | ");
    })
    .join("\n");
}

export function buildUserPrompt({ context, draft, locale } = {}) {
  const lang = locale || getLocale() || "pt";
  const lines = [
    "Write product-demo step copy from the screenshot.",
    "The image is the primary source. Prior steps are storytelling context only.",
    `Respond in locale "${lang}".`,
    'Return ONLY compact JSON: {"title":"...","description":"...","narration":"..."}',
    "title: one short line.",
    "description: one short glanceable sentence (about 80–140 characters). No fine UI detail — readable in a glance.",
    "narration: 2–4 spoken sentences with more detail for voiceover; name what the screen shows and continue the demo story.",
  ];
  const ctx = formatContextBlock(context);
  if (ctx) {
    lines.push("Prior steps:");
    lines.push(ctx);
  }
  const title = clipText(draft?.title || "");
  const description = clipText(draft?.description || "");
  const caption = clipText(draft?.caption || "");
  if (title || description || caption) {
    lines.push("Current draft to refine (do not ignore the image):");
    if (title) lines.push(`title: ${title}`);
    if (description) lines.push(`description: ${description}`);
    if (caption) lines.push(`narration: ${caption}`);
  }
  return lines.join("\n");
}

export function buildChatMessages({ imageDataUrl, context, draft, locale } = {}) {
  const content = [
    { type: "text", text: buildUserPrompt({ context, draft, locale }) },
  ];
  const image = String(imageDataUrl || "").trim();
  if (image.startsWith("data:image/")) {
    content.push({
      type: "image_url",
      image_url: { url: image },
    });
  }
  return [{ role: "user", content }];
}

export function buildChatBody({
  model,
  messages,
  maxTokens = LLM_MAX_TOKENS,
  includeReasoning = true,
  forceReasoningNone = false,
} = {}) {
  const body = {
    model: String(model || LLM_DEFAULT_MODEL).trim() || LLM_DEFAULT_MODEL,
    messages: Array.isArray(messages) ? messages : [],
    max_tokens: Math.max(64, Number(maxTokens) || LLM_MAX_TOKENS),
    temperature: 0.4,
  };
  if (forceReasoningNone) {
    body.reasoning = { effort: "none", exclude: true };
  } else if (includeReasoning) {
    body.reasoning = { ...LLM_REASONING };
  }
  return body;
}

export function parseCopyJson(raw) {
  let text = String(raw || "").trim();
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const title = String(data?.title || "").trim();
  const description = String(data?.description || "").trim();
  const narration = String(data?.narration || data?.caption || "").trim();
  if (!title || !description || !narration) return null;
  return { title, description, narration };
}

function clipError(text) {
  const raw = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return "";
  return raw.length > 180 ? `${raw.slice(0, 179)}…` : raw;
}

async function readErrorMessage(response, apiKey) {
  const detail = redactSecret(await response.text().catch(() => ""), apiKey);
  let message = "";
  try {
    const parsed = JSON.parse(detail);
    message = parsed.error?.message || parsed.message || "";
  } catch {
    message = detail;
  }
  return clipError(redactSecret(message, apiKey));
}

function isReasoningRejected(status, message) {
  if (status === 400 || status === 422) {
    const lower = String(message || "").toLowerCase();
    return lower.includes("reasoning") || lower.includes("unknown parameter");
  }
  return false;
}

export async function chatCompletions({
  apiKey,
  baseUrl,
  model,
  messages,
  maxTokens = LLM_MAX_TOKENS,
  fetchImpl = fetch,
  includeReasoning = true,
  forceReasoningNone = false,
} = {}) {
  const key = String(apiKey || "").trim();
  const root = normalizeBaseUrl(baseUrl);
  if (!isPlausibleLlmKey(key)) return { ok: false, error: t("llm.noKey") };
  if (!root) return { ok: false, error: t("llm.badBaseUrl") };
  const body = buildChatBody({
    model,
    messages,
    maxTokens,
    includeReasoning,
    forceReasoningNone,
  });
  if (!body.messages.length) return { ok: false, error: t("llm.noMessages") };

  let response;
  try {
    response = await fetchImpl(`${root}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: t("llm.unreachable") };
  }

  if (!response.ok) {
    const message = await readErrorMessage(response, key);
    if ((includeReasoning || forceReasoningNone) && isReasoningRejected(response.status, message)) {
      return chatCompletions({
        apiKey: key,
        baseUrl: root,
        model,
        messages,
        maxTokens,
        fetchImpl,
        includeReasoning: false,
        forceReasoningNone: false,
      });
    }
    return { ok: false, error: message || t("llm.requestFail") };
  }

  let data;
  try {
    data = await response.json();
  } catch {
    return { ok: false, error: t("llm.badResponse") };
  }
  const content = data?.choices?.[0]?.message?.content;
  const text = typeof content === "string" ? content : Array.isArray(content)
    ? content.map((part) => (typeof part?.text === "string" ? part.text : "")).join("")
    : "";
  const finish = data?.choices?.[0]?.finish_reason;
  // why: se o modelo esgotar o teto só no raciocínio, content fica vazio — tenta de novo sem thinking.
  if (!String(text || "").trim() && !forceReasoningNone && finish === "length") {
    return chatCompletions({
      apiKey: key,
      baseUrl: root,
      model,
      messages,
      maxTokens: Math.max(Number(maxTokens) || 0, 1024),
      fetchImpl,
      includeReasoning: false,
      forceReasoningNone: true,
    });
  }
  return { ok: true, content: text, raw: data };
}

export async function listModels({ apiKey, baseUrl, fetchImpl = fetch } = {}) {
  const key = String(apiKey || "").trim();
  const root = normalizeBaseUrl(baseUrl);
  if (!isPlausibleLlmKey(key)) return { ok: false, error: t("llm.noKey"), models: [] };
  if (!root) return { ok: false, error: t("llm.badBaseUrl"), models: [] };
  let response;
  try {
    response = await fetchImpl(`${root}/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
    });
  } catch {
    return { ok: false, error: t("llm.unreachable"), models: [] };
  }
  if (!response.ok) {
    const message = await readErrorMessage(response, key);
    return { ok: false, error: message || t("llm.requestFail"), models: [] };
  }
  let data;
  try {
    data = await response.json();
  } catch {
    return { ok: false, error: t("llm.badResponse"), models: [] };
  }
  const rows = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  const models = rows
    .map((row) => String(row?.id || "").trim())
    .filter(Boolean)
    .slice(0, 400);
  return { ok: true, models };
}

/**
 * Reduz uma data URL de imagem para JPEG menor antes do envio.
 * hazard: imagens grandes estouram o custo de tokens; o PNG original não sai na requisição.
 */
export async function shrinkImageDataUrl(src, { maxSide = LLM_IMAGE_MAX_SIDE, quality = 0.82 } = {}) {
  const url = String(src || "").trim();
  if (!url.startsWith("data:image/") && !/^https?:/i.test(url) && !url.startsWith("blob:")) {
    return "";
  }
  if (typeof document === "undefined" || typeof Image === "undefined") {
    return url.startsWith("data:image/") ? url : "";
  }
  const img = new Image();
  img.decoding = "async";
  const loaded = new Promise((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("image"));
  });
  img.src = url;
  await loaded;
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return "";
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(img, 0, 0, tw, th);
  return canvas.toDataURL("image/jpeg", quality);
}
