/**
 * Conteúdo multi-idioma do tour (PRD multi-idioma §7). Puro, sem DOM.
 * O idioma de origem continua nos campos atuais; as traduções ficam em blocos `i18n`
 * opcionais (projeto, passo, passo inicial e final). Quem não conhece o bloco o ignora.
 */
import { LIMITS } from "./fixedSteps.js";

export const I18N_VERSION = 1;
export const MAX_TARGET_LANGS = 3;
export const LANG_TAG_RE = /^[a-z]{2,3}(-[A-Z]{2})?$/;
export const RTL_LANGS = ["ar", "he", "ur", "fa"];
/** Idiomas do Cartesia sonic-3.6 sem RTL (v1). */
export const CONTENT_LANGS = [
  "en", "de", "es", "fr", "ja", "pt", "zh", "hi", "ko", "it", "nl", "pl", "ru", "sv", "tr", "tl",
  "bg", "ro", "cs", "el", "fi", "hr", "ms", "sk", "da", "ta", "uk", "hu", "no", "vi", "bn", "th",
  "ka", "id", "te", "gu", "kn", "ml", "mr", "pa", "or",
];
export const LANG_NATIVE_NAMES = {
  en: "English", de: "Deutsch", es: "Español", fr: "Français", ja: "日本語", pt: "Português", zh: "中文",
  hi: "हिन्दी", ko: "한국어", it: "Italiano", nl: "Nederlands", pl: "Polski", ru: "Русский", sv: "Svenska",
  tr: "Türkçe", tl: "Tagalog", bg: "Български", ro: "Română", cs: "Čeština", el: "Ελληνικά", fi: "Suomi",
  hr: "Hrvatski", ms: "Bahasa Melayu", sk: "Slovenčina", da: "Dansk", ta: "தமிழ்", uk: "Українська",
  hu: "Magyar", no: "Norsk", vi: "Tiếng Việt", bn: "বাংলা", th: "ไทย", ka: "ქართული", id: "Bahasa Indonesia",
  te: "తెలుగు", gu: "ગુજરાતી", kn: "ಕನ್ನಡ", ml: "മലയാളം", mr: "मराठी", pa: "ਪੰਜਾਬੀ", or: "ଓଡ଼ିଆ",
};
const REGION_NAMES = { BR: "Brasil", PT: "Portugal", MX: "México", ES: "España", US: "US", GB: "UK", AR: "Argentina", CA: "Canada", FR: "France" };

/** Campos traduzíveis por dono (§7.2): chave → [caminho, limite, multilinha]. */
export const STEP_FIELDS = {
  title: ["popover.title", LIMITS.title, false],
  description: ["popover.description", LIMITS.body * 4, true],
  caption: ["caption", 2000, true],
  label: ["label", LIMITS.title, false],
  alt: ["alt", 300, false],
};
export const START_FIELDS = {
  title: ["title", LIMITS.title, false],
  body: ["body", LIMITS.body, true],
  consentText: ["consentText", LIMITS.consent, true],
  submitLabel: ["submitLabel", LIMITS.label, false],
  skipLabel: ["skipLabel", LIMITS.label, false],
};
export const END_FIELDS = {
  title: ["title", LIMITS.title, false],
  body: ["body", LIMITS.body, true],
  "whatsapp.message": ["whatsapp.message", LIMITS.message, true],
  "whatsapp.label": ["whatsapp.label", LIMITS.label, false],
  "contact.label": ["contact.label", LIMITS.label, false],
  "contact.consentText": ["contact.consentText", LIMITS.consent, true],
};
export const PROJECT_FIELDS = { name: ["name", 120, false] };
export const LEAD_LABEL_KEYS = ["name", "email", "phone"];
const CONSENT_KEYS = new Set(["consentText", "contact.consentText"]);

// ---------- hash (sha256 curto, 8 bytes hex) ----------
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
export function sha256Hex(input) {
  const bytes = new TextEncoder().encode(String(input ?? ""));
  const len = bytes.length;
  const total = ((len + 9 + 63) >> 6) << 6;
  const buf = new Uint8Array(total);
  buf.set(bytes);
  buf[len] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(total - 4, (len * 8) >>> 0);
  view.setUint32(total - 8, Math.floor((len * 8) / 2 ** 32));
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, "0")).join("");
}
/** sha256 curto (8 bytes hex) — detecta texto de origem alterado (§7.1). */
export function textHash(text) {
  return sha256Hex(String(text ?? "").trim()).slice(0, 16);
}

// ---------- tags ----------
export function normalizeLangTag(value) {
  const raw = String(value ?? "").trim().replace("_", "-");
  const m = /^([A-Za-z]{2,3})(?:-([A-Za-z]{2}))?$/.exec(raw);
  if (!m) return "";
  const tag = m[1].toLowerCase() + (m[2] ? `-${m[2].toUpperCase()}` : "");
  return LANG_TAG_RE.test(tag) ? tag : "";
}
export function baseLang(tag) {
  return String(tag || "").split("-")[0].toLowerCase();
}
export function isRtlLang(tag) {
  return RTL_LANGS.includes(baseLang(tag));
}
export function langLabel(tag) {
  const t = normalizeLangTag(tag);
  if (!t) return String(tag || "");
  const [b, r] = t.split("-");
  const name = LANG_NATIVE_NAMES[b] || b;
  return r ? `${name} (${REGION_NAMES[r] || r})` : name;
}
/** Casa um idioma pedido com a lista disponível: exato, depois base (Q3). */
export function matchLang(available = [], wanted) {
  const tag = normalizeLangTag(wanted);
  if (!tag) return "";
  if (available.includes(tag)) return tag;
  const base = baseLang(tag);
  return available.find((a) => a === base) || available.find((a) => baseLang(a) === base) || "";
}

// ---------- helpers de caminho ----------
function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), obj);
}
function clean(value, max, multi) {
  let s = String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").slice(0, max);
  if (!multi) s = s.replace(/[\r\n]+/g, " ");
  return s;
}
function fieldsFor(kind) {
  return kind === "start" ? START_FIELDS : kind === "end" ? END_FIELDS : kind === "project" ? PROJECT_FIELDS : STEP_FIELDS;
}

// ---------- configuração ----------
export function inferDefaultLang(project) {
  const uri = String(project?.narration?.voiceURI || "").trim();
  const tag = normalizeLangTag(uri);
  if (tag) return tag;
  return "pt-BR";
}

/** Configuração do projeto normalizada; `null` quando não há bloco. */
export function projectI18n(project) {
  const raw = project?.i18n;
  if (!raw || typeof raw !== "object") return null;
  const defaultLang = normalizeLangTag(raw.defaultLang) || inferDefaultLang(project);
  const seen = new Set([defaultLang]);
  const langs = [];
  for (const item of Array.isArray(raw.langs) ? raw.langs : []) {
    const lang = normalizeLangTag(item?.lang);
    if (!lang || seen.has(lang)) continue;
    seen.add(lang);
    const voiceId = /^[0-9a-f-]{36}$/i.test(String(item.voiceId || "")) ? String(item.voiceId) : "";
    const locale = normalizeLangTag(item.locale) || lang;
    langs.push({ lang, voiceId, locale, enabled: item.enabled !== false });
  }
  const glossary = (Array.isArray(raw.glossary) ? raw.glossary : [])
    .map((g) => clean(g, 80, false).trim())
    .filter(Boolean)
    .slice(0, 50);
  const tone = ["formal", "informal"].includes(raw.tone) ? raw.tone : "informal";
  const out = { v: I18N_VERSION, defaultLang, langs, glossary, tone };
  if (raw.toneNote) out.toneNote = clean(raw.toneNote, 200, false);
  return out;
}

/** Cria o bloco do projeto se faltar (§7.5). Muta e devolve `project.i18n`. */
export function ensureI18n(project) {
  if (!project.i18n || typeof project.i18n !== "object") {
    project.i18n = { v: I18N_VERSION, defaultLang: inferDefaultLang(project), langs: [], glossary: [], tone: "informal" };
  }
  project.i18n = projectI18n(project);
  return project.i18n;
}
export function targetLangs(project, { enabledOnly = false } = {}) {
  const cfg = projectI18n(project);
  if (!cfg) return [];
  return cfg.langs.filter((l) => !enabledOnly || l.enabled).map((l) => l.lang);
}
/** Origem + alvos habilitados no player. */
export function playerLangs(project) {
  const cfg = projectI18n(project);
  if (!cfg) return [];
  return [cfg.defaultLang, ...cfg.langs.filter((l) => l.enabled).map((l) => l.lang)];
}
export function addLang(project, lang, { voiceId = "", locale = "", max = Infinity } = {}) {
  const cfg = ensureI18n(project);
  const tag = normalizeLangTag(lang);
  if (!tag || isRtlLang(tag)) throw new Error("invalid_lang");
  if (tag === cfg.defaultLang || cfg.langs.some((l) => l.lang === tag)) return cfg;
  if (cfg.langs.length >= max) throw new Error("max_langs");
  project.i18n.langs.push({ lang: tag, voiceId, locale: normalizeLangTag(locale) || tag, enabled: true });
  project.i18n = projectI18n(project);
  return project.i18n;
}
function eachOwner(project, fn) {
  if (project.startStep) fn(project.startStep, "start", "start");
  for (const step of project.steps || []) fn(step, "step", step.id);
  if (project.endStep) fn(project.endStep, "end", "end");
}
/** Remove o idioma e apaga textos e áudios dele (RF5). */
export function removeLang(project, lang) {
  const cfg = projectI18n(project);
  if (!cfg) return;
  project.i18n = { ...cfg, langs: cfg.langs.filter((l) => l.lang !== lang) };
  eachOwner(project, (owner) => {
    if (owner.i18n?.[lang]) {
      delete owner.i18n[lang];
      if (!Object.keys(owner.i18n).length) delete owner.i18n;
    }
  });
  if (project.i18nProject?.[lang]) delete project.i18nProject[lang];
}

// ---------- campos ----------
/** Lista {key, owner, kind, field, text, hash} da origem (§7.3). */
export function translatableFields(project) {
  const out = [];
  const push = (owner, kind, id) => {
    for (const [field, [path]] of Object.entries(fieldsFor(kind))) {
      const text = String(getPath(owner, path) ?? "");
      if (!text.trim()) continue;
      out.push({ key: `${kind}:${id}:${field}`, kind, id, field, text, hash: textHash(text) });
    }
  };
  if (project?.startStep?.enabled) push(project.startStep, "start", "start");
  for (const step of project?.steps || []) push(step, "step", step.id);
  if (project?.endStep?.enabled) push(project.endStep, "end", "end");
  if (project?.name) push(project, "project", "project");
  return out;
}
function ownerOf(project, kind, id) {
  if (kind === "start") return project.startStep;
  if (kind === "end") return project.endStep;
  if (kind === "project") return project;
  return (project.steps || []).find((s) => s.id === id);
}
function bagOf(owner, kind, lang, create) {
  const host = kind === "project" ? "i18nProject" : "i18n";
  if (!owner[host] || typeof owner[host] !== "object") {
    if (!create) return null;
    owner[host] = {};
  }
  if (!owner[host][lang] || typeof owner[host][lang] !== "object") {
    if (!create) return null;
    owner[host][lang] = {};
  }
  return owner[host][lang];
}
export function getTranslation(project, kind, id, field, lang) {
  const owner = ownerOf(project, kind, id);
  if (!owner) return "";
  const bag = bagOf(owner, kind, lang, false);
  const v = bag ? getPath(bag, field) : "";
  return typeof v === "string" ? v : "";
}
/** Grava a tradução de um campo com status (`auto`|`reviewed`) e o hash da origem atual. */
export function setTranslation(project, { kind = "step", id, field, lang, text, status = "reviewed" }) {
  const owner = ownerOf(project, kind, id);
  const spec = fieldsFor(kind)[field];
  if (!owner || !spec || !normalizeLangTag(lang)) return false;
  const bag = bagOf(owner, kind, lang, true);
  const value = clean(text, spec[1], spec[2]);
  const parts = field.split(".");
  let node = bag;
  for (const p of parts.slice(0, -1)) node = node[p] && typeof node[p] === "object" ? node[p] : (node[p] = {});
  node[parts.at(-1)] = value;
  bag.meta = bag.meta && typeof bag.meta === "object" ? bag.meta : {};
  const src = String(getPath(owner, spec[0]) ?? "");
  if (value) bag.meta[field] = { status: status === "auto" ? "auto" : "reviewed", srcHash: textHash(src) };
  else delete bag.meta[field];
  return true;
}
/** Aprova (auto → reviewed) um campo ou todos de um idioma. */
export function approveTranslation(project, lang, { kind, id, field } = {}) {
  let n = 0;
  for (const f of translatableFields(project)) {
    if (kind && (f.kind !== kind || f.id !== id || (field && f.field !== field))) continue;
    const owner = ownerOf(project, f.kind, f.id);
    const bag = bagOf(owner, f.kind, lang, false);
    const meta = bag?.meta?.[f.field];
    if (meta && meta.status === "auto" && getTranslation(project, f.kind, f.id, f.field, lang)) {
      meta.status = "reviewed";
      meta.srcHash = f.hash;
      n++;
    }
  }
  return n;
}
/** Status do campo: missing | stale | auto | reviewed (§5.3 RF12). */
export function fieldStatus(project, f, lang) {
  const value = getTranslation(project, f.kind, f.id, f.field, lang);
  if (!value.trim()) return "missing";
  const owner = ownerOf(project, f.kind, f.id);
  const meta = bagOf(owner, f.kind, lang, false)?.meta?.[f.field];
  const hash = f.hash ?? textHash(f.text);
  if (meta?.srcHash && meta.srcHash !== hash) return "stale";
  return meta?.status === "auto" ? "auto" : "reviewed";
}
export function isConsentField(f) {
  return (f.kind === "start" || f.kind === "end") && CONSENT_KEYS.has(f.field);
}
/** Status do áudio do passo no idioma: ok | stale | missing. */
export function audioStatus(step, lang, { voiceId = "" } = {}) {
  const audio = step?.i18n?.[lang]?.narrationAudio;
  const caption = String(step?.i18n?.[lang]?.caption ?? "");
  if (!audio || !Array.isArray(audio.clips) || !audio.clips.length) return caption.trim() ? "missing" : "none";
  if (audio.textHash && audio.textHash !== textHash(caption)) return "stale";
  if (voiceId && audio.voiceId && audio.voiceId !== voiceId) return "stale";
  return "ok";
}
/** Contagens por idioma (§7.3). */
export function translationStatus(project) {
  const cfg = projectI18n(project);
  const out = {};
  if (!cfg) return out;
  const fields = translatableFields(project);
  for (const { lang, voiceId } of cfg.langs) {
    const c = { missing: 0, stale: 0, auto: 0, reviewed: 0, consentAuto: 0, audioMissing: 0, audioStale: 0, total: fields.length };
    for (const f of fields) {
      const s = fieldStatus(project, f, lang);
      c[s]++;
      if (s === "auto" && isConsentField(f)) c.consentAuto++;
    }
    for (const step of project.steps || []) {
      if (!String(step.caption || "").trim()) continue;
      const a = audioStatus(step, lang, { voiceId });
      if (a === "missing") c.audioMissing++;
      if (a === "stale") c.audioStale++;
    }
    out[lang] = c;
  }
  return out;
}

// ---------- normalização ----------
function normalizeBag(bag, kind) {
  if (!bag || typeof bag !== "object") return null;
  const out = {};
  for (const [field, [, max, multi]] of Object.entries(fieldsFor(kind))) {
    const v = getPath(bag, field);
    if (typeof v !== "string") continue;
    const parts = field.split(".");
    let node = out;
    for (const p of parts.slice(0, -1)) node = node[p] || (node[p] = {});
    node[parts.at(-1)] = clean(v, max, multi);
  }
  if (bag.meta && typeof bag.meta === "object") {
    const meta = {};
    for (const [k, m] of Object.entries(bag.meta)) {
      if (!fieldsFor(kind)[k] || !m || typeof m !== "object") continue;
      meta[k] = { status: m.status === "auto" ? "auto" : "reviewed" };
      if (/^[0-9a-f]{16}$/.test(String(m.srcHash || ""))) meta[k].srcHash = m.srcHash;
    }
    if (Object.keys(meta).length) out.meta = meta;
  }
  if (kind === "start" && bag.fieldLabels && typeof bag.fieldLabels === "object") {
    const labels = {};
    for (const k of LEAD_LABEL_KEYS) if (typeof bag.fieldLabels[k] === "string") labels[k] = clean(bag.fieldLabels[k], LIMITS.label, false);
    if (Object.keys(labels).length) out.fieldLabels = labels;
  }
  if (kind === "step" && bag.narrationAudio && typeof bag.narrationAudio === "object") {
    const a = bag.narrationAudio;
    const clips = (Array.isArray(a.clips) ? a.clips : []).filter((c) => typeof c === "string" && c);
    if (clips.length) {
      out.narrationAudio = { ...a, clips };
      if (a.language) out.narrationAudio.language = normalizeLangTag(a.language) || baseLang(a.language);
    }
  }
  return Object.keys(out).length ? out : null;
}
function normalizeOwnerI18n(owner, kind, host = "i18n") {
  if (!owner || !owner[host]) return owner;
  const map = {};
  for (const [lang, bag] of Object.entries(owner[host] || {})) {
    const tag = normalizeLangTag(lang);
    const nb = tag && normalizeBag(bag, kind);
    if (nb) map[tag] = nb;
  }
  const copy = { ...owner };
  if (Object.keys(map).length) copy[host] = map;
  else delete copy[host];
  return copy;
}
/** Limita textos, valida tags e vozes. Devolve uma cópia rasa; projeto sem i18n volta igual. */
export function normalizeI18n(project) {
  if (!project || typeof project !== "object") return project;
  const hasAny = project.i18n || project.i18nProject || project.startStep?.i18n || project.endStep?.i18n ||
    (project.steps || []).some((s) => s?.i18n);
  if (!hasAny) return project;
  const out = { ...project };
  const cfg = projectI18n(project);
  if (cfg) out.i18n = cfg;
  else delete out.i18n;
  if (out.startStep) out.startStep = normalizeOwnerI18n(out.startStep, "start");
  if (out.endStep) out.endStep = normalizeOwnerI18n(out.endStep, "end");
  if (Array.isArray(out.steps)) out.steps = out.steps.map((s) => (s && typeof s === "object" ? normalizeOwnerI18n(s, "step") : s));
  if (out.i18nProject) Object.assign(out, normalizeOwnerI18n(out, "project", "i18nProject"));
  return out;
}

// ---------- resolução ----------
function applyBag(owner, kind, bag, fallbacks, prefix) {
  const out = structuredCloneSafe(owner);
  for (const [field, [path]] of Object.entries(fieldsFor(kind))) {
    const src = getPath(owner, path);
    if (typeof src !== "string" || !src.trim()) continue;
    const v = bag ? getPath(bag, field) : undefined;
    if (typeof v === "string" && v.trim()) {
      const parts = path.split(".");
      let node = out;
      for (const p of parts.slice(0, -1)) node = node[p] = { ...(node[p] || {}) };
      node[parts.at(-1)] = v;
    } else fallbacks.push(`${prefix}:${field}`);
  }
  return out;
}
function structuredCloneSafe(o) {
  const copy = { ...o };
  for (const k of ["popover", "whatsapp", "contact"]) if (copy[k] && typeof copy[k] === "object") copy[k] = { ...copy[k] };
  return copy;
}
/**
 * Visão do tour em `lang` (§7.3), com fallback para a origem.
 * Devolve uma cópia com `fallback: [...]`, `textLang` e `fieldLabels` (passo inicial).
 * `audioLang` escolhe o áudio de cada passo (`narrationAudio`); sem áudio no idioma, usa o de origem.
 */
export function resolveContent(project, lang, { audioLang } = {}) {
  const cfg = projectI18n(project);
  const available = cfg ? [cfg.defaultLang, ...cfg.langs.map((l) => l.lang)] : [];
  const textLang = (cfg && matchLang(available, lang)) || cfg?.defaultLang || "";
  const aLang = audioLang === "none" ? "none" : (cfg && matchLang(available, audioLang ?? textLang)) || textLang;
  if (!cfg) return { ...project, textLang: "", audioLang: "", fallback: [], audioFallback: [] };
  const isSource = (l) => l === cfg.defaultLang;
  const fallback = [];
  const audioFallback = [];
  const out = { ...project, textLang, audioLang: aLang, fallback, audioFallback };
  out.steps = (project.steps || []).map((step) => {
    let s = isSource(textLang) ? { ...step } : applyBag(step, "step", step.i18n?.[textLang], fallback, step.id);
    if (aLang === "none") {
      s.narrationAudio = undefined;
    } else if (!isSource(aLang)) {
      const a = step.i18n?.[aLang]?.narrationAudio;
      if (a?.clips?.length) s.narrationAudio = a;
      else if (step.narrationAudio?.clips?.length) audioFallback.push(step.id);
    }
    return s;
  });
  if (!isSource(textLang)) {
    if (project.startStep) {
      out.startStep = applyBag(project.startStep, "start", project.startStep.i18n?.[textLang], fallback, "start");
      const labels = project.startStep.i18n?.[textLang]?.fieldLabels;
      if (labels) out.startStep.fieldLabels = labels;
    }
    if (project.endStep) out.endStep = applyBag(project.endStep, "end", project.endStep.i18n?.[textLang], fallback, "end");
    const pn = project.i18nProject?.[textLang]?.name;
    if (pn) out.name = pn;
  }
  return out;
}

/** Duração para o temporizador: a do idioma ativo, nunca abaixo do timer do autor (Q4). */
/** ~14 caracteres por segundo de fala (mesma conta do cloud, estimateSpeechSeconds). */
export function estimateSpeechSecondsI18n(text) {
  const n = String(text ?? "").trim().length;
  return n ? Math.max(1, Math.ceil(n / 14)) : 0;
}

/**
 * RF16/RF17: áudios a gerar por idioma — só `faltando` ou `desatualizado` (mesmo texto + voz = reaproveita,
 * sem cobrar). [{ stepId, lang, text, voiceId, locale, seconds }]
 */
export function langAudioPlan(project, { langs = null, stepIds = null } = {}) {
  const cfg = projectI18n(project);
  if (!cfg) return [];
  const want = langs?.length ? new Set(langs) : null;
  const only = stepIds?.length ? new Set(stepIds) : null;
  const out = [];
  for (const l of cfg.langs) {
    if (want && !want.has(l.lang)) continue;
    for (const step of project.steps || []) {
      if (only && !only.has(step.id)) continue;
      if (!String(step.caption || "").trim()) continue;
      const st = audioStatus(step, l.lang, { voiceId: l.voiceId });
      if (st !== "missing" && st !== "stale") continue;
      const text = String(step.i18n?.[l.lang]?.caption || "").trim();
      if (!text) continue;
      out.push({ stepId: step.id, lang: l.lang, text, voiceId: l.voiceId || "", locale: l.locale || l.lang, seconds: estimateSpeechSecondsI18n(text) });
    }
  }
  return out;
}

export function stepAudioSeconds(step, audioLang) {
  const a = (audioLang && step?.i18n?.[audioLang]?.narrationAudio) || step?.narrationAudio;
  return Number(a?.durationSeconds) || 0;
}

// ---------- variáveis (RF9) ----------
const VAR_RE = /\{[a-zA-Z_][\w]*\}|https?:\/\/[^\s)]+|[\w.+-]+@[\w-]+\.[\w.]+|\+?\d[\d\s().-]{7,}\d/g;
export function extractVars(text) {
  return [...String(text ?? "").matchAll(VAR_RE)].map((m) => m[0].replace(/\s+/g, "")).sort();
}
export function sameVars(source, translated) {
  const a = extractVars(source);
  const b = extractVars(translated);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Avisos antes de publicar: consentimento `auto` e áudio faltando em idioma habilitado. */
export function i18nPublishWarnings(project) {
  const cfg = projectI18n(project);
  if (!cfg) return [];
  const status = translationStatus(project);
  const out = [];
  for (const l of cfg.langs.filter((x) => x.enabled)) {
    const c = status[l.lang];
    if (!c) continue;
    if (c.consentAuto) out.push({ code: "consent_auto", lang: l.lang, count: c.consentAuto });
    if (c.auto) out.push({ code: "unreviewed", lang: l.lang, count: c.auto });
    if (c.stale) out.push({ code: "stale", lang: l.lang, count: c.stale });
    if (c.missing) out.push({ code: "missing", lang: l.lang, count: c.missing });
  }
  return out;
}
