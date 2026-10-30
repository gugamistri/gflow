/**
 * Clique no destaque (hotspot / marcador de clique) durante o tour = «Próximo».
 * Funções puras para o player e os testes.
 */

/** Folga do recorte do Driver em volta do hotspot (stagePadding). */
export const HIGHLIGHT_PAD = 6;

/** Controles que nunca contam como clique no destaque, mesmo sobre ele. */
export const HIGHLIGHT_CLICK_IGNORE = [
  "button",
  "a[href]",
  "input",
  "select",
  "textarea",
  "label",
  "dialog",
  "[role='dialog']",
  ".driver-popover",
  ".slide-card",
  "#canvas-slide",
  ".gf-video",
].join(", ");

/** true se (x, y) cai dentro do retângulo, com a folga do recorte. */
export function pointInHighlight(x, y, rect, pad = HIGHLIGHT_PAD) {
  if (!rect || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  const w = Number(rect.width) || 0;
  const h = Number(rect.height) || 0;
  if (w <= 0 || h <= 0) return false;
  const left = Number(rect.left) - pad;
  const top = Number(rect.top) - pad;
  return x >= left && x <= left + w + pad * 2 && y >= top && y <= top + h + pad * 2;
}

/**
 * Decide se um clique deve avançar o tour como o botão Próximo.
 * @param {{ presenting: boolean, driverActive: boolean, stepType?: string,
 *   button?: number, target?: Element|null, x: number, y: number, rect?: DOMRect|null }} info
 */
export function highlightClickAdvances(info) {
  if (!info?.presenting || !info.driverActive) return false;
  if (info.stepType === "slide") return false;
  if (typeof info.button === "number" && info.button !== 0) return false;
  const node = info.target?.nodeType === 3 ? info.target.parentElement : info.target;
  if (node?.closest?.(HIGHLIGHT_CLICK_IGNORE)) return false;
  return pointInHighlight(info.x, info.y, info.rect);
}
