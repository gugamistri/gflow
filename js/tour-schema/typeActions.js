/**
 * Digitação reencenada. Sem `actions`, o player não faz nada.
 * x/y são % da imagem (0–100), como o clickPoint.
 */

export const TYPE_TEXT_MAX = 200;

const round = (n) => Math.round(n * 1000) / 1000;

export function normalizeStepActions(raw) {
  if (raw == null) return { ok: true, actions: null };
  if (!Array.isArray(raw)) {
    return { ok: false, actions: null, message: "actions precisa ser uma lista ({ t, kind, text, x, y }) ou null." };
  }
  const actions = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    if (item.kind !== "type" && item.kind !== "click") continue;
    const x = Number(item.x);
    const y = Number(item.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 100 || y < 0 || y > 100) continue;
    const t = Number.isFinite(Number(item.t)) ? Math.max(0, Math.round(Number(item.t))) : 0;
    if (item.kind === "click") {
      actions.push({ t, kind: "click", x: round(x), y: round(y) });
      continue;
    }
    const text = String(item.text ?? "")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
      .slice(0, TYPE_TEXT_MAX);
    if (!text) continue;
    actions.push({ t, kind: "type", text, x: round(x), y: round(y) });
  }
  return { ok: true, actions: actions.length ? actions : null };
}

/** null = não reencenar (tour antigo ou reduced-motion ainda devolve o plano instantâneo só se houver texto). */
export function typeReplayPlan(step, { reducedMotion = false } = {}) {
  const read = normalizeStepActions(step?.actions);
  const actions = (read.actions || []).filter((item) => item.kind === "type");
  if (!actions.length) return null;
  return { reducedMotion: reducedMotion === true, actions };
}
