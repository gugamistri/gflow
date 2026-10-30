/**
 * Tradução por IA do tour (PRD multi-idioma §5.2, RF6–RF10). Puro: prompt, parse e aplicação.
 * Usado pelo editor (BYOK, OSS) e pela API hospedada (Pro) — mesma regra nos dois lados.
 */
import {
  END_FIELDS,
  PROJECT_FIELDS,
  START_FIELDS,
  STEP_FIELDS,
  fieldStatus,
  langLabel,
  projectI18n,
  sameVars,
  setTranslation,
  translatableFields,
} from "./i18n.js";

export const TRANSLATE_MAX_ITEMS = 300;
export const TRANSLATE_MAX_CHARS = 40000;
export const TRANSLATE_BATCH_CHARS = 6000;

function limitOf(f) {
  const map = f.kind === "start" ? START_FIELDS : f.kind === "end" ? END_FIELDS : f.kind === "project" ? PROJECT_FIELDS : STEP_FIELDS;
  return map[f.field]?.[1] || 280;
}

/**
 * Itens a traduzir num idioma (RF6/RF7): faltando e desatualizados; `auto` só com `includeAuto`;
 * revisados só com `overwriteReviewed`. `keys` força campos específicos (Retraduzir).
 */
export function translationItems(project, lang, { overwriteReviewed = false, includeAuto = false, keys = null } = {}) {
  return translatableFields(project)
    .filter((f) => !keys || keys.includes(f.key))
    .filter((f) => {
      const s = fieldStatus(project, f, lang);
      if (keys) return true;
      if (s === "missing" || s === "stale") return true;
      if (s === "auto") return includeAuto || overwriteReviewed;
      return overwriteReviewed;
    })
    .map((f) => ({ id: f.key, text: f.text, max: limitOf(f) }));
}

/** Divide os itens em lotes por tamanho (a coerência fica no prompt com nome e glossário). */
export function batchItems(items, maxChars = TRANSLATE_BATCH_CHARS) {
  const out = [];
  let cur = [];
  let size = 0;
  for (const it of items) {
    if (cur.length && size + it.text.length > maxChars) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(it);
    size += it.text.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Mensagens do chat para um lote (RF6): nome do tour, glossário, tom e limites. */
export function buildTranslateMessages({ items, source, target, name = "", glossary = [], tone = "informal" }) {
  const toneLine = tone === "formal"
    ? "Use a formal register (e.g. 'usted' in Spanish, 'vous' in French, 'Sie' in German)."
    : "Use a friendly, informal register (e.g. 'tú' in Spanish, 'tu' in French, 'du' in German), like a product walkthrough.";
  const system = [
    "You are a professional software localization translator for interactive product demo tours.",
    `Translate every value from ${langLabel(source)} (${source}) to ${langLabel(target)} (${target}).`,
    toneLine,
    glossary.length ? `Never translate these terms; keep them exactly as written: ${glossary.join(", ")}.` : "",
    "Keep placeholders in curly braces like {nome}, {tour}, {link} byte-for-byte as they are (never translate the word inside the braces). Keep URLs, e-mail addresses and phone numbers unchanged.",
    "Keep text formatting markers exactly as in the source, around the translated words: **bold**, *italic*, ++underline++, and lines starting with \"- \" (list items). Never add new markers, markdown, HTML or links.",
    "Respect each item's max length in characters (\"max\"). Keep line breaks where they exist. Do not add quotes or explanations.",
    "Legal consent texts must stay faithful to the original meaning.",
    'Answer ONLY with a JSON object mapping EVERY id (including the tour name) to its translation: {"<id>": "<translation>", ...}.',
  ].filter(Boolean).join("\n");
  const payload = { tour: String(name || "").slice(0, 120), items: items.map((i) => ({ id: i.id, max: i.max, text: i.text })) };
  return [
    { role: "system", content: system },
    { role: "user", content: JSON.stringify(payload) },
  ];
}

function extractJson(raw) {
  const text = String(raw ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  try {
    return JSON.parse(text);
  } catch {
    const a = text.indexOf("{");
    const b = text.lastIndexOf("}");
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(text.slice(a, b + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Mapa id → texto. Aceita também o formato que alguns modelos devolvem ecoando o pedido:
 * `{ tour, items: [{ id, text }] }`, `{ translations: [{ id, translation }] }` ou uma lista.
 */
function translationMap(data) {
  const fromList = (list) => Object.fromEntries(
    list
      .filter((it) => it && typeof it === "object" && typeof it.id === "string")
      .map((it) => [it.id, it.translation ?? it.text ?? it.value]),
  );
  if (Array.isArray(data)) return fromList(data);
  if (Array.isArray(data.translations)) return fromList(data.translations);
  if (data.translations && typeof data.translations === "object") return data.translations;
  if (Array.isArray(data.items)) return { ...data, ...fromList(data.items) };
  return data;
}

/** Valida a resposta (RF9): só ids pedidos, string não vazia, mesmas variáveis; corta no limite. */
export function parseTranslateResult(raw, items) {
  const data = typeof raw === "object" && raw ? raw : extractJson(raw);
  const translations = {};
  const rejected = [];
  const reasons = {};
  if (!data || typeof data !== "object") {
    for (const i of items) reasons[i.id] = "invalid_json";
    return { ok: false, translations, rejected: items.map((i) => i.id), reasons };
  }
  const map = translationMap(data);
  for (const it of items) {
    const v = map[it.id];
    // why: o motivo (sem o texto) explica a célula pendente na grade e no retorno da API
    const why = v === undefined ? "missing" : typeof v !== "string" || !v.trim() ? "empty" : !sameVars(it.text, v) ? "vars" : "";
    if (why) {
      rejected.push(it.id);
      reasons[it.id] = why;
      continue;
    }
    translations[it.id] = v.trim().slice(0, it.max);
  }
  return { ok: true, translations, rejected, reasons };
}

function splitKey(key) {
  const [kind, ...rest] = key.split(":");
  const field = rest.pop();
  return { kind, id: rest.join(":"), field };
}

/** Grava as traduções como `auto` (RF6). Devolve quantas entraram. */
export function applyTranslations(project, lang, translations) {
  let n = 0;
  for (const [key, text] of Object.entries(translations || {})) {
    const { kind, id, field } = splitKey(key);
    if (setTranslation(project, { kind, id, field, lang, text, status: "auto" })) n++;
  }
  return n;
}

/** Pedido para a API hospedada (`POST /ai/translate`). */
export function hostedTranslateRequest(project, lang, opts = {}) {
  const cfg = projectI18n(project);
  return {
    source: cfg?.defaultLang || "pt-BR",
    target: lang,
    name: project.name || "",
    glossary: cfg?.glossary || [],
    tone: cfg?.tone || "informal",
    items: translationItems(project, lang, opts),
  };
}
