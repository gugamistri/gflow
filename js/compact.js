/** Celular / tablet estreito em pé. */
export const COMPACT_PORTRAIT_MQ =
  "(hover: none) and (pointer: coarse) and (max-width: 900px)";

/** Celular deitado — a largura passa de 720px e o breakpoint de largura não pega. */
export const COMPACT_LANDSCAPE_MQ =
  "(hover: none) and (pointer: coarse) and (max-height: 500px)";

/** Player compacto: em pé ou deitado. */
export const COMPACT_TOUCH_MQ = `${COMPACT_PORTRAIT_MQ}, ${COMPACT_LANDSCAPE_MQ}`;

/**
 * @param {((query: string) => { matches: boolean }) | undefined} matchMediaFn
 */
export function isCompactTouch(matchMediaFn = globalThis.matchMedia) {
  if (typeof matchMediaFn !== "function") return false;
  return Boolean(matchMediaFn(COMPACT_TOUCH_MQ)?.matches);
}

/**
 * @param {((query: string) => { matches: boolean }) | undefined} matchMediaFn
 */
export function isCompactLandscape(matchMediaFn = globalThis.matchMedia) {
  if (typeof matchMediaFn !== "function") return false;
  return Boolean(matchMediaFn(COMPACT_LANDSCAPE_MQ)?.matches);
}
