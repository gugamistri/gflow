/**
 * Presença (puro): avatares, cores estáveis, agrupamento por passo e anúncios para leitor de tela.
 * Sem cursores ao vivo: só "quem está em qual passo" e, discretamente, o campo em edição.
 */
import { contrastRatio } from "./a11y.js";

/** Paleta com texto branco ≥ 4,5:1 (conferido no teste). Cor estável por usuário. */
export const AVATAR_COLORS = Object.freeze(["#1d5fa8", "#a1295f", "#1b6e2f", "#7a3fd1", "#b04a00", "#006d77", "#9b2226", "#4a5568"]);
export const AVATAR_TEXT = "#ffffff";
export const IDLE_AFTER_MS = 60_000;

export function colorFor(userId) {
  let h = 0;
  const s = String(userId || "");
  for (let i = 0; i < s.length; i += 1) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function initialsOf(name) {
  const parts = String(name || "").replace(/@.*$/, "").trim().split(/[\s._-]+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = [...parts[0]][0] || "?";
  const second = parts.length > 1 ? [...parts[parts.length - 1]][0] : "";
  return (first + second).toUpperCase();
}

export function avatarContrastOk() {
  return AVATAR_COLORS.every((c) => contrastRatio(AVATAR_TEXT, c) >= 4.5);
}

/** Lista do servidor → pessoas (sem mim), com cor e iniciais. `idle` vem da ausência de mudança de passo/campo. */
export function peopleFrom(presence, selfId, { idleMap = null, now = Date.now() } = {}) {
  return (presence || [])
    .filter((p) => p && p.userId && p.userId !== selfId)
    .map((p) => ({
      userId: p.userId,
      name: p.name || "",
      role: p.role || "viewer",
      stepId: p.stepId || null,
      field: p.field || null,
      color: colorFor(p.userId),
      initials: initialsOf(p.name),
      idle: Boolean(idleMap && now - (idleMap.get(p.userId) ?? now) >= IDLE_AFTER_MS),
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId));
}

/** stepId → pessoas naquele passo. */
export function groupByStep(people) {
  const map = new Map();
  for (const p of people) {
    if (!p.stepId) continue;
    if (!map.has(p.stepId)) map.set(p.stepId, []);
    map.get(p.stepId).push(p);
  }
  return map;
}

/** Máximo `max` avatares + "+N". */
export function visibleAvatars(list, max = 2) {
  return { shown: list.slice(0, max), more: Math.max(0, list.length - max) };
}

/** Quem entrou/saiu entre duas listas (para o aria-live). */
export function diffPresence(prev, next) {
  const before = new Map((prev || []).map((p) => [p.userId, p]));
  const after = new Map((next || []).map((p) => [p.userId, p]));
  const joined = [...after.values()].filter((p) => !before.has(p.userId));
  const left = [...before.values()].filter((p) => !after.has(p.userId));
  return { joined, left };
}

/** Quem está num campo de um passo (indicador discreto). */
export function fieldEditors(people, stepId) {
  return people.filter((p) => p.stepId === stepId && p.field);
}

/** Texto do tooltip do avatar no filmstrip. */
export function presenceTitleKey(person) {
  return person.field ? `collab.editing.${person.field}` : "collab.viewing";
}
