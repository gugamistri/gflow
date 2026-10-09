/**
 * Edição no palco: texto inline e encaixe do balão.
 * O arraste grava só popover.side e popover.align (os mesmos enums do Driver).
 * Não há deslocamento em pixels — player e export continuam iguais.
 */

export const POPOVER_SIDES = ["top", "right", "bottom", "left"];
export const POPOVER_ALIGNS = ["start", "center", "end"];

/** Folga entre o destaque e o balão — perto do stagePadding + popoverOffset do Driver. */
export const POPOVER_GAP = 16;

export function isTypingTarget(target) {
  if (!target || typeof target !== "object") return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return Boolean(target.isContentEditable);
}

/** Texto plano de um contenteditable. O navegador costuma acrescentar um \\n final. */
export function readInlineText(value) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/\n$/, "");
}

export function placePopoverBox(hotspot, popSize, side, align, gap = POPOVER_GAP) {
  const hs = normalizeRect(hotspot);
  const pw = Math.max(0, Number(popSize?.width) || 0);
  const ph = Math.max(0, Number(popSize?.height) || 0);
  const resolvedSide = POPOVER_SIDES.includes(side) ? side : "bottom";
  const resolvedAlign = POPOVER_ALIGNS.includes(align) ? align : "center";
  let left;
  let top;
  if (resolvedSide === "right") {
    left = hs.left + hs.width + gap;
    top = alignCross(hs.top, hs.height, ph, resolvedAlign);
  } else if (resolvedSide === "left") {
    left = hs.left - gap - pw;
    top = alignCross(hs.top, hs.height, ph, resolvedAlign);
  } else if (resolvedSide === "top") {
    top = hs.top - gap - ph;
    left = alignCross(hs.left, hs.width, pw, resolvedAlign);
  } else {
    top = hs.top + hs.height + gap;
    left = alignCross(hs.left, hs.width, pw, resolvedAlign);
  }
  return { left, top, side: resolvedSide, align: resolvedAlign };
}

/**
 * Ponto no mesmo espaço do retângulo do destaque → lado e alinhamento do Driver.
 * Fora do retângulo, o lado é a borda mais próxima; o alinhamento divide essa borda em terços.
 */
export function snapPopoverPlacement(hotspot, point) {
  const hs = normalizeRect(hotspot);
  const x = Number(point?.x) || 0;
  const y = Number(point?.y) || 0;
  const cx = hs.left + hs.width / 2;
  const cy = hs.top + hs.height / 2;
  const distLeft = hs.left - x;
  const distRight = x - (hs.left + hs.width);
  const distTop = hs.top - y;
  const distBottom = y - (hs.top + hs.height);
  const outside = Math.max(distLeft, distRight, distTop, distBottom);
  let side;
  if (outside > 0) {
    if (distRight >= distLeft && distRight >= distTop && distRight >= distBottom) side = "right";
    else if (distLeft >= distTop && distLeft >= distBottom) side = "left";
    else if (distBottom >= distTop) side = "bottom";
    else side = "top";
  } else if (Math.abs(x - cx) >= Math.abs(y - cy)) {
    side = x >= cx ? "right" : "left";
  } else {
    side = y >= cy ? "bottom" : "top";
  }
  const span = side === "left" || side === "right" ? hs.height : hs.width;
  const origin = side === "left" || side === "right" ? hs.top : hs.left;
  const coord = side === "left" || side === "right" ? y : x;
  const along = span ? (coord - origin) / span : 0.5;
  const align = along < 1 / 3 ? "start" : along > 2 / 3 ? "end" : "center";
  return { side, align };
}

function alignCross(origin, span, popSpan, align) {
  if (align === "start") return origin;
  if (align === "end") return origin + span - popSpan;
  return origin + span / 2 - popSpan / 2;
}

function normalizeRect(rect) {
  return {
    left: Number(rect?.left) || 0,
    top: Number(rect?.top) || 0,
    width: Math.max(0, Number(rect?.width) || 0),
    height: Math.max(0, Number(rect?.height) || 0),
  };
}

/**
 * Deslocamento para o campo editável ficar dentro do visualViewport (acima do teclado).
 * Medir o campo depois de zerar o deslocamento anterior — o retorno já é o total, não um delta acumulado.
 * @param {{ top?: number, bottom?: number }} rect
 * @param {{ offsetTop?: number, height?: number }} viewport
 */
export function keyboardInsetShift(rect, viewport) {
  const offsetTop = Number(viewport?.offsetTop) || 0;
  const height = Number(viewport?.height) || 0;
  const topLimit = offsetTop + 8;
  const bottomLimit = offsetTop + height - 12;
  const fieldTop = Number(rect?.top) || 0;
  const fieldBottom = Number(rect?.bottom) || 0;
  if (fieldBottom > bottomLimit) return fieldBottom - bottomLimit;
  if (fieldTop < topLimit) return 0;
  return 0;
}
