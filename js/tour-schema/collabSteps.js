/**
 * Fundação da colaboração (Fase 1, PR 1): IDs de passo únicos, ordem fracionária (`step.pos`)
 * e a migração preguiçosa de um projeto para o modo colaborativo.
 * JS puro, sem DOM. Nada aqui roda sozinho: o projeto que nunca é compartilhado para edição
 * não é tocado (sem `collab`, sem `pos`). A ordem exibida continua sendo o array `steps`.
 */

export const COLLAB_PAYLOAD_VERSION = 1;

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const ID_LENGTH = 12;

function randomBytes(n) {
  const out = new Uint8Array(n);
  const c = globalThis.crypto;
  if (c?.getRandomValues) c.getRandomValues(out);
  else for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

/** `step-` + 12 caracteres aleatórios (≈62 bits). IDs antigos (`step-xxxxxxx`) continuam válidos. */
export function createStableStepId() {
  const bytes = randomBytes(ID_LENGTH);
  let id = "step-";
  // why: 256 % 36 != 0 → descarta o viés com módulo sobre 252 (7*36)
  for (let i = 0; i < ID_LENGTH; i++) id += ID_ALPHABET[(bytes[i] % 252) % ID_ALPHABET.length];
  return id;
}

export function isValidStepId(id) {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

/**
 * Garante id válido e único em todos os passos. Passos sem id, inválidos ou duplicados (do segundo
 * em diante) recebem id novo. Devolve { steps, changed, idMap } sem mutar a entrada; `idMap`
 * só tem ids inválidos que foram trocados (antigo → novo); id duplicado mantém o id no 1º uso.
 */
export function ensureUniqueStepIds(steps, { create = createStableStepId } = {}) {
  const list = Array.isArray(steps) ? steps : [];
  const seen = new Set();
  const idMap = {};
  let changed = false;
  const out = list.map((step) => {
    const s = step && typeof step === "object" ? step : {};
    if (isValidStepId(s.id) && !seen.has(s.id)) {
      seen.add(s.id);
      return s;
    }
    let id = create();
    while (seen.has(id)) id = create();
    seen.add(id);
    changed = true;
    // why: duplicado válido mantém o id no 1º uso (referências seguem valendo); só id inválido é remapeado
    if (typeof s.id === "string" && s.id && !isValidStepId(s.id) && !(s.id in idMap)) idMap[s.id] = id;
    return { ...s, id };
  });
  return { steps: out, changed, idMap };
}

/* ---------- ordem fracionária (base 62, chaves nunca terminam em "0") ---------- */

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = DIGITS.length;
const idx = (ch) => DIGITS.indexOf(ch);

export function isValidPos(pos) {
  return typeof pos === "string" && pos.length > 0 && pos.length <= 64 && /^[0-9A-Za-z]+$/.test(pos) && !pos.endsWith("0");
}

function midpoint(a, b) {
  if (b !== null && a >= b) throw new Error(`pos: ${a} >= ${b}`);
  if (a.endsWith("0") || (b && b.endsWith("0"))) throw new Error("pos: chave termina em 0");
  if (b) {
    let n = 0;
    while ((a[n] || "0") === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const da = a ? idx(a[0]) : 0;
  const db = b !== null ? idx(b[0]) : BASE;
  if (db - da > 1) return DIGITS[Math.round(0.5 * (da + db))];
  if (b && b.length > 1) return b.slice(0, 1);
  return DIGITS[da] + midpoint(a.slice(1), null);
}

/** Chave entre `a` e `b` (null = sem limite). `a` < `b` obrigatório. */
export function posBetween(a = null, b = null) {
  const lo = a || "";
  if (lo && !isValidPos(lo)) throw new Error("pos inválido");
  if (b !== null && b !== undefined && !isValidPos(b)) throw new Error("pos inválido");
  return midpoint(lo, b ?? null);
}

/** `n` chaves crescentes entre `a` e `b`, bem espalhadas (profundidade ~log n). */
export function posesBetween(a, b, n) {
  if (n <= 0) return [];
  if (n === 1) return [posBetween(a, b)];
  const c = posBetween(a, b);
  const left = Math.floor((n - 1) / 2);
  return [...posesBetween(a, c, left), c, ...posesBetween(c, b, n - 1 - left)];
}

/** Compara por `pos` e desempata por id (determinístico entre clientes). */
export function comparePos(x, y) {
  const px = x?.pos ?? "";
  const py = y?.pos ?? "";
  if (px !== py) return px < py ? -1 : 1;
  const ix = String(x?.id ?? "");
  const iy = String(y?.id ?? "");
  return ix < iy ? -1 : ix > iy ? 1 : 0;
}

export function sortStepsByPos(steps) {
  return [...(steps || [])].sort(comparePos);
}

/**
 * Dá `pos` a todos os passos pela ordem atual do array. Se todos já têm `pos` válido e estritamente
 * crescente na ordem do array, não muda nada. Devolve { steps, changed }.
 */
export function assignStepPositions(steps) {
  const list = Array.isArray(steps) ? steps : [];
  const ok =
    list.every((s) => isValidPos(s?.pos)) && list.every((s, i) => i === 0 || list[i - 1].pos < s.pos);
  if (ok) return { steps: list, changed: false };
  const poses = posesBetween(null, null, list.length);
  return { steps: list.map((s, i) => ({ ...s, pos: poses[i] })), changed: list.length > 0 };
}

/** Projeto já foi preparado para colaboração? */
export function isCollabProject(project) {
  return Number(project?.collab?.v) >= 1;
}

/**
 * Migração preguiçosa (chamada só no primeiro "compartilhar para edição"): ids únicos, `pos` pela
 * ordem atual, referências a ids que mudaram (`coverStepId`) e `collab.v`. Não muta a entrada.
 * Idempotente: um projeto já migrado volta igual (`changed: false`).
 */
export function prepareProjectForCollab(project) {
  if (!project || typeof project !== "object" || !Array.isArray(project.steps)) {
    return { project, changed: false, idMap: {} };
  }
  const ids = ensureUniqueStepIds(project.steps);
  const pos = assignStepPositions(ids.steps);
  const had = isCollabProject(project);
  const changed = ids.changed || pos.changed || !had;
  if (!changed) return { project, changed: false, idMap: {} };
  const next = { ...project, steps: pos.steps, collab: { ...(project.collab || {}), v: COLLAB_PAYLOAD_VERSION } };
  for (const key of ["coverStepId"]) {
    if (typeof next[key] === "string" && ids.idMap[next[key]]) next[key] = ids.idMap[next[key]];
  }
  return { project: next, changed: true, idMap: ids.idMap };
}
