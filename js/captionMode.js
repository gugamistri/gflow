/**
 * Celular em pé: um bloco só por passo.
 * - Legenda curta = título do balão (popover.title), que já traz o atributo-chave ("2 dorms. · 32,06 m² · Torres A e C").
 * - Descrição, ficha e o aviso de IA ficam em "Detalhes", fechado por padrão.
 * - A narração vira legenda mínima (até ~2 linhas), em pedaços sincronizados com o áudio.
 * why: o balão e a legenda empilhados cobriam metade da tela e repetiam o mesmo conteúdo.
 * Funções puras (testáveis em node); o DOM fica no player.
 */

/** Mesmo critério do CSS do celular em pé (theme.css / player.css). */
export const PORTRAIT_QUERY = "(hover: none) and (pointer: coarse) and (max-width: 900px) and (orientation: portrait)";

export function isPortraitCompact(mm = globalThis.matchMedia) {
  try {
    return Boolean(mm?.(PORTRAIT_QUERY)?.matches);
  } catch {
    return false;
  }
}

/**
 * Quais partes o passo mostra no modo de legenda única.
 * Sem campo novo: a legenda curta é o título (ou o rótulo); "Detalhes" só existe quando há título E texto
 * — sem título, o texto é a própria legenda e não fica escondido.
 */
export function stepCaptionParts(step) {
  const title = String(step?.popover?.title || step?.label || "").trim();
  const details = String(step?.popover?.description || "").trim();
  return { title, details, hasDetails: Boolean(title && details) };
}

const SENTENCE_RE = /[^.!?…]+(?:[.!?…]+["'”’)]*|$)\s*/g;

function splitWords(text, maxChars) {
  const out = [];
  let cur = "";
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= maxChars) cur += " " + w;
    else {
      out.push(cur);
      cur = w;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function splitClauses(sentence, maxChars) {
  if (sentence.length <= maxChars) return [sentence];
  // why: corta primeiro em vírgula/ponto e vírgula/dois-pontos (pausa natural da fala), depois em palavras
  const parts = sentence.match(/[^,;:—]+[,;:—]?\s*/g) || [sentence];
  const out = [];
  let cur = "";
  for (const raw of parts) {
    const p = raw.trim();
    if (!p) continue;
    if (p.length > maxChars) {
      if (cur) out.push(cur);
      cur = "";
      const words = splitWords(p, maxChars);
      cur = words.pop() || "";
      out.push(...words);
      continue;
    }
    if (!cur) cur = p;
    else if ((cur + " " + p).length <= maxChars) cur += " " + p;
    else {
      out.push(cur);
      cur = p;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Quebra a narração em pedaços de até `maxChars` (≈ 2 linhas), respeitando frase > vírgula > palavra.
 * Frases curtas vizinhas se juntam enquanto couberem.
 */
export function splitSubtitleChunks(text, maxChars = 84) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const max = Math.max(20, Math.floor(Number(maxChars) || 84));
  if (clean.length <= max) return [clean];
  const sentences = (clean.match(SENTENCE_RE) || [clean]).map((s) => s.trim()).filter(Boolean);
  const pieces = sentences.flatMap((s) => splitClauses(s, max));
  const out = [];
  for (const p of pieces) {
    const last = out[out.length - 1];
    if (last && (last + " " + p).length <= max) out[out.length - 1] = last + " " + p;
    else out.push(p);
  }
  return out;
}

/** Quantos caracteres cabem em `lines` linhas (estimativa conservadora: ~0,56 em por caractere). */
export function subtitleMaxChars(widthPx, fontPx = 14, lines = 2) {
  const w = Number(widthPx) || 0;
  const f = Number(fontPx) || 14;
  if (w <= 0) return 84;
  return Math.max(24, Math.floor((w / (f * 0.56)) * lines));
}

/**
 * Pedaço da vez para um progresso 0..1 da fala, ponderado pelo tamanho de cada pedaço
 * (pedaço longo fica mais tempo na tela).
 */
export function subtitleChunkAt(chunks, progress) {
  const n = Array.isArray(chunks) ? chunks.length : 0;
  if (n <= 1) return 0;
  const p = Number(progress);
  if (!Number.isFinite(p) || p <= 0) return 0;
  if (p >= 1) return n - 1;
  const total = chunks.reduce((s, c) => s + c.length, 0) || 1;
  let acc = 0;
  for (let i = 0; i < n; i += 1) {
    acc += chunks[i].length / total;
    if (p < acc - 1e-9) return i;
  }
  return n - 1;
}

/** Progresso 0..1 da fala com vários clipes: (clipe atual + fração do clipe) / clipes. */
export function speechProgress({ index = 0, count = 1, currentTime = 0, duration = 0 } = {}) {
  const c = Math.max(1, Number(count) || 1);
  const i = Math.min(c - 1, Math.max(0, Number(index) || 0));
  const d = Number(duration);
  const frac = Number.isFinite(d) && d > 0 ? Math.min(1, Math.max(0, (Number(currentTime) || 0) / d)) : 0;
  return (i + frac) / c;
}

/** Sem áudio: ritmo de leitura (≈15 caracteres/s, mínimo 1,6 s por pedaço). */
export const READING_CPS = 15;
export const MIN_CHUNK_MS = 1600;

export function readingChunkAt(chunks, elapsedMs) {
  const n = Array.isArray(chunks) ? chunks.length : 0;
  if (n <= 1) return 0;
  let t = Math.max(0, Number(elapsedMs) || 0);
  for (let i = 0; i < n; i += 1) {
    const d = Math.max(MIN_CHUNK_MS, (chunks[i].length / READING_CPS) * 1000);
    if (t < d) return i;
    t -= d;
  }
  return n - 1;
}

/** Tempo total de leitura de todos os pedaços (o autoplay sem áudio espera pelo menos isso). */
export function readingTotalMs(chunks) {
  return (chunks || []).reduce((s, c) => s + Math.max(MIN_CHUNK_MS, (c.length / READING_CPS) * 1000), 0);
}
