/**
 * Geometria do passo: destaque (hotspot) e clique simulado, em % da imagem (0..100).
 * Puro (sem DOM) — usado pelo editor, pelo player e pela API pública.
 */

/** Centro do retângulo de destaque — fallback do ponto de clique */
export function clickPointFromHotspot(hotspot) {
  const hs = hotspot || { x: 40, y: 40, w: 14, h: 8 };
  return {
    x: hs.x + hs.w / 2,
    y: hs.y + hs.h / 2,
  };
}

/** Margem (pontos percentuais da imagem) para o marcador não ficar metade fora do destaque */
export const CLICK_INSET = 1;

/** Destaque utilizável: retângulo finito com área positiva */
export function hasHotspot(hotspot) {
  return Boolean(
    hotspot &&
      Number.isFinite(hotspot.x) &&
      Number.isFinite(hotspot.y) &&
      Number.isFinite(hotspot.w) &&
      Number.isFinite(hotspot.h) &&
      hotspot.w > 0 &&
      hotspot.h > 0
  );
}

/**
 * Prende o clique simulado dentro do destaque (com margem).
 * Sem destaque válido, devolve o ponto como veio (posição livre).
 * Nunca muta o ponto recebido.
 */
export function clampClickToHotspot(point, hotspot, { inset = CLICK_INSET } = {}) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return point;
  if (!hasHotspot(hotspot)) return { x: point.x, y: point.y };
  // why: destaque menor que 2× a margem → o centro é o único ponto "dentro"
  const ix = Math.min(Math.max(0, inset), hotspot.w / 2);
  const iy = Math.min(Math.max(0, inset), hotspot.h / 2);
  return {
    x: Math.min(Math.max(point.x, hotspot.x + ix), hotspot.x + hotspot.w - ix),
    y: Math.min(Math.max(point.y, hotspot.y + iy), hotspot.y + hotspot.h - iy),
  };
}

/** Ponto (em % da imagem) cai dentro do destaque, bordas incluídas */
export function pointInHotspot(point, hotspot) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !hasHotspot(hotspot)) return false;
  return (
    point.x >= hotspot.x &&
    point.x <= hotspot.x + hotspot.w &&
    point.y >= hotspot.y &&
    point.y <= hotspot.y + hotspot.h
  );
}

/**
 * Clique simples no canvas: novo ponto do clique simulado, ou null para não mexer.
 * Com destaque, só um clique dentro dele move o clique (fora dele é ignorado,
 * sem "pular" para a borda). Sem destaque, o clique continua livre.
 */
export function clickPointForCanvasClick(point, hotspot) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  if (!hasHotspot(hotspot)) return { x: point.x, y: point.y };
  if (!pointInHotspot(point, hotspot)) return null;
  return clampClickToHotspot(point, hotspot);
}

/**
 * Novo clique quando o destaque muda: se só moveu (mesmo tamanho), o clique
 * acompanha o deslocamento; se redimensionou, fica onde estava e é preso dentro.
 */
export function followHotspot(point, prevHotspot, nextHotspot) {
  if (!hasHotspot(nextHotspot)) return point;
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return clickPointFromHotspot(nextHotspot);
  }
  let p = { x: point.x, y: point.y };
  if (
    hasHotspot(prevHotspot) &&
    Math.abs(prevHotspot.w - nextHotspot.w) < 0.05 &&
    Math.abs(prevHotspot.h - nextHotspot.h) < 0.05
  ) {
    p = { x: p.x + nextHotspot.x - prevHotspot.x, y: p.y + nextHotspot.y - prevHotspot.y };
  }
  return clampClickToHotspot(p, nextHotspot);
}

/**
 * Ponto de clique para exibir: o salvo (ou o centro do destaque), sempre preso
 * dentro do destaque. Não muta o passo — projetos antigos com clique fora só
 * são regravados quando o usuário edita o passo.
 */
export function ensureClickPoint(step) {
  const raw =
    step?.clickPoint && Number.isFinite(step.clickPoint.x) && Number.isFinite(step.clickPoint.y)
      ? step.clickPoint
      : clickPointFromHotspot(step?.hotspot);
  return clampClickToHotspot(raw, step?.hotspot);
}

/** Capturas novas (extensão): grava o clique já preso ao destaque. Muta os passos. */
export function clampStepClickPoints(steps) {
  if (!Array.isArray(steps)) return steps;
  for (const step of steps) {
    if (!step?.clickPoint || !hasHotspot(step.hotspot)) continue;
    const p = clampClickToHotspot(step.clickPoint, step.hotspot);
    if (p) step.clickPoint = p;
  }
  return steps;
}
