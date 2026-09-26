/**
 * Foco de apresentação no destaque: “recorta” a região do hotspot e amplifica
 * até ela ocupar boa parte do palco (como um close-up do trecho marcado).
 * Porcentagens do hotspot são 0–100 sobre a imagem.
 */

/** Quanto do palco o retângulo do hotspot deve ocupar (mantendo proporção). */
const TARGET_FILL = 0.55;
const MAX_SCALE = 3.2;
const MIN_SCALE = 1;

/**
 * @param {{ x?: number, y?: number, w?: number, h?: number } | null | undefined} hotspot
 * @param {{ w: number, h: number }} imageSize
 * @param {{ w: number, h: number }} stageSize
 * @param {boolean} enabled
 * @returns {{ scale: number, translateX: number, translateY: number }}
 */
export function computeZoomCamera(hotspot, imageSize, stageSize, enabled) {
  if (!enabled) {
    return { scale: 1, translateX: 0, translateY: 0 };
  }

  const imgW = Number(imageSize?.w) || 0;
  const imgH = Number(imageSize?.h) || 0;
  const stageW = Number(stageSize?.w) || 0;
  const stageH = Number(stageSize?.h) || 0;
  if (imgW <= 0 || imgH <= 0 || stageW <= 0 || stageH <= 0) {
    return { scale: 1, translateX: 0, translateY: 0 };
  }

  const hs = hotspot || { x: 40, y: 40, w: 12, h: 8 };
  const hsW = Math.max(1, ((Number(hs.w) || 0) / 100) * imgW);
  const hsH = Math.max(1, ((Number(hs.h) || 0) / 100) * imgH);
  const hsCx = (((Number(hs.x) || 0) + (Number(hs.w) || 0) / 2) / 100) * imgW;
  const hsCy = (((Number(hs.y) || 0) + (Number(hs.h) || 0) / 2) / 100) * imgH;

  // why: encaixa o retângulo do destaque no palco — barra fina também cresce de verdade
  const fit = Math.min(stageW / hsW, stageH / hsH) * TARGET_FILL;
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, fit));

  const imgCx = imgW / 2;
  const imgCy = imgH / 2;
  let translateX = scale * (imgCx - hsCx);
  let translateY = scale * (imgCy - hsCy);
  translateX = clampCover(translateX, scale * imgW, stageW);
  translateY = clampCover(translateY, scale * imgH, stageH);

  return { scale, translateX, translateY };
}

/**
 * Evita faixas vazias quando a imagem ampliada ainda cabe no palco num eixo.
 * @param {number} translate
 * @param {number} scaledSize
 * @param {number} stageSize
 */
function clampCover(translate, scaledSize, stageSize) {
  if (scaledSize <= stageSize) return 0;
  const max = (scaledSize - stageSize) / 2;
  return Math.min(max, Math.max(-max, translate));
}

/**
 * @param {{ scale?: number, translateX?: number, translateY?: number }} camera
 * @returns {{ transform: string, transformOrigin: string }}
 */
export function zoomCameraStyle(camera) {
  const scale = camera?.scale ?? 1;
  const tx = camera?.translateX ?? 0;
  const ty = camera?.translateY ?? 0;
  if (scale === 1 && tx === 0 && ty === 0) {
    return { transform: "none", transformOrigin: "center center" };
  }
  return {
    transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
    transformOrigin: "center center",
  };
}

/** @deprecated use zoomCameraStyle — mantido para callers que só precisam do transform */
export function zoomCameraCss(camera) {
  return zoomCameraStyle(camera).transform;
}
