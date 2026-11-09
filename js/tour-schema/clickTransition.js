/**
 * Transição opcional do passo guiado: a imagem seguinte nasce no clickPoint.
 * Sem o campo, o player troca a tela na hora, como sempre.
 * Pendência: o MP4 (js/exportPack.js) não desenha este círculo — só o player ao vivo.
 */

export const CLICK_TRANSITION_DEFAULT_MS = 400;
export const CLICK_TRANSITION_MAX_MS = 600;

const isNum = (n) => typeof n === "number" && Number.isFinite(n);

/**
 * Lê `transition` vindo do agente ou já gravado no passo.
 * `null` apaga. Objeto sem fromClick true também apaga (não grava lixo).
 * @returns {{ ok: boolean, transition: {fromClick:true, ms?:number}|null, warnings: string[], errors: {field:string,message:string}[] }}
 */
export function readStepTransition(raw) {
  const warnings = [];
  const errors = [];
  if (raw == null) return { ok: true, transition: null, warnings, errors };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    errors.push({ field: "transition", message: "transition precisa ser { fromClick: true, ms?: number } ou null." });
    return { ok: false, transition: null, warnings, errors };
  }
  if (raw.fromClick !== true) {
    if (raw.fromClick != null && raw.fromClick !== false) {
      errors.push({ field: "transition.fromClick", message: "fromClick só aceita true. Omita transition para a troca de tela de sempre." });
      return { ok: false, transition: null, warnings, errors };
    }
    return { ok: true, transition: null, warnings, errors };
  }
  const transition = { fromClick: true };
  if (raw.ms != null) {
    if (!isNum(raw.ms) || raw.ms < 0) {
      errors.push({ field: "transition.ms", message: "ms precisa ser um número de 0 a 600 (milissegundos). O padrão é 400." });
      return { ok: false, transition: null, warnings, errors };
    }
    const ms = Math.round(raw.ms);
    if (ms > CLICK_TRANSITION_MAX_MS) {
      warnings.push(`transition.ms foi limitado a ${CLICK_TRANSITION_MAX_MS}.`);
      transition.ms = CLICK_TRANSITION_MAX_MS;
    } else transition.ms = ms;
  }
  return { ok: true, transition, warnings, errors };
}

/** `?transition=click` no preview liga o efeito sem gravar o campo no tour. */
export function previewClickTransitionRequested(search) {
  const raw = String(search ?? "");
  const q = raw.startsWith("?") ? raw.slice(1) : raw;
  try {
    return new URLSearchParams(q).get("transition") === "click";
  } catch {
    return false;
  }
}

/**
 * Plano da revelação, ou null para a troca instantânea de sempre.
 * @param {object} step passo de onde sai o clique
 * @param {{ preview?: boolean, reducedMotion?: boolean, nextIsImage?: boolean }} [opts]
 */
export function clickRevealPlan(step, { preview = false, reducedMotion = false, nextIsImage = true } = {}) {
  if (reducedMotion || !nextIsImage) return null;
  if (!step || step.type === "slide") return null;
  const pt = step.clickPoint;
  if (!pt || !isNum(pt.x) || !isNum(pt.y)) return null;
  const own = readStepTransition(step.transition);
  const enabled = Boolean(own.ok && own.transition?.fromClick);
  if (!enabled && preview !== true) return null;
  let ms = CLICK_TRANSITION_DEFAULT_MS;
  if (enabled && own.transition.ms != null) ms = own.transition.ms;
  if (ms <= 0) return null;
  return {
    xPct: Math.min(100, Math.max(0, pt.x)),
    yPct: Math.min(100, Math.max(0, pt.y)),
    ms: Math.min(CLICK_TRANSITION_MAX_MS, ms),
  };
}

/** Círculo em pixels do elemento, do clique até cobrir o canto mais longe. */
export function clickRevealCircle(xPct, yPct, width, height) {
  const w = Math.max(0, width);
  const h = Math.max(0, height);
  const x = (Math.min(100, Math.max(0, xPct)) / 100) * w;
  const y = (Math.min(100, Math.max(0, yPct)) / 100) * h;
  const r = Math.ceil(Math.hypot(Math.max(x, w - x), Math.max(y, h - y)));
  return {
    x,
    y,
    r,
    from: `circle(0px at ${x}px ${y}px)`,
    to: `circle(${r}px at ${x}px ${y}px)`,
  };
}
