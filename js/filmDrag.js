/**
 * Reordenar passos arrastando o cartão no celular.
 *
 * why: o drag-and-drop do HTML (dragstart/drop) não existe no toque, e as setas ← → de cada
 * cartão gastavam uma linha inteira da filmstrip. Segurar o cartão e arrastar resolve o mesmo
 * problema sem ocupar espaço. A conta de "onde o dedo solta" fica aqui, sem DOM, para testar.
 */

/** Quanto o dedo pode andar antes de o toque longo virar rolagem da faixa. */
export const TOUCH_DRAG_SLOP = 10;

/** Tempo de dedo parado que arma o arraste. */
export const TOUCH_DRAG_HOLD_MS = 260;

/** Faixa junto da borda que rola a filmstrip sozinha para alcançar cartões fora da tela. */
export const TOUCH_DRAG_EDGE = 56;

/** Velocidade máxima da rolagem automática, em pixels por quadro. */
const TOUCH_DRAG_SPEED = 12;

/**
 * Cartão sob o dedo (ou o mais próximo, quando o dedo está num vão ou fora da faixa).
 *
 * @param {{
 *   x: number,
 *   y: number,
 *   horizontal: boolean,
 *   cards: Array<{ index: number, scene: number, rect: { left: number, top: number, width: number, height: number } }>,
 * }} input
 * @returns {{ index: number, scene: number, before: boolean } | null} `before` = entra antes do cartão
 */
export function dropTargetAt({ x, y, horizontal, cards }) {
  if (!Array.isArray(cards) || !cards.length) return null;
  const pos = horizontal ? x : y;
  const startKey = horizontal ? "left" : "top";
  const sizeKey = horizontal ? "width" : "height";
  const last = cards[cards.length - 1];

  for (const card of cards) {
    const from = Number(card.rect[startKey]) || 0;
    const size = Number(card.rect[sizeKey]) || 0;
    const to = from + size;
    if (pos >= to) continue;
    return { index: card.index, scene: card.scene, before: pos < from + size / 2 };
  }
  return { index: last.index, scene: last.scene, before: false };
}

/** Índice de inserção que `reorderStepGroup` espera (0..length) para o alvo do dedo. */
export function insertBeforeFor(target) {
  if (!target) return null;
  return target.before ? target.index : target.index + 1;
}

/**
 * Rolagem automática quando o dedo encosta na borda da faixa: px por quadro (negativo = volta).
 * Fora da borda, zero.
 */
export function edgeScrollSpeed({ pos, min, max, edge = TOUCH_DRAG_EDGE }) {
  if (![pos, min, max].every((n) => Number.isFinite(n)) || max <= min) return 0;
  const span = Math.min(edge, (max - min) / 2);
  if (span <= 0) return 0;
  if (pos < min + span) return -Math.ceil(((min + span - pos) / span) * TOUCH_DRAG_SPEED);
  if (pos > max - span) return Math.ceil(((pos - (max - span)) / span) * TOUCH_DRAG_SPEED);
  return 0;
}
