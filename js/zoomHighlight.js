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

/*
 * ---- Câmera com área segura (celular em pé/deitado) e zoom do visitante (pinça/arrastar) ----
 * Tudo em px de tela. O transform do frame é `translate(tx,ty) scale(s)` com origem no centro,
 * então um ponto p do frame (relativo ao centro, em 1×) vai para: centro + t + s·p.
 * frame = { cx, cy, w, h }: centro e tamanho do frame SEM transform (layout).
 * safe  = { left, top, right, bottom }: parte do palco que não fica sob controles, legenda ou balão.
 */

const SAFE_MARGIN = 8;
/** Abaixo disso o close-up não ajuda (o destaque já ocupa quase toda a área). */
const MIN_USEFUL_SCALE = 1.08;

function finite(n, fallback = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function validFrame(frame) {
  return frame && finite(frame.w) > 0 && finite(frame.h) > 0 && Number.isFinite(Number(frame.cx)) && Number.isFinite(Number(frame.cy));
}

function validSafe(safe) {
  return safe && finite(safe.right) - finite(safe.left) > 0 && finite(safe.bottom) - finite(safe.top) > 0;
}

/**
 * Faixa de translate num eixo: se a imagem ampliada é maior que a área segura, ela continua cobrindo a
 * área (sem faixa vazia); se é menor, fica inteira dentro dela.
 * @returns {[number, number]}
 */
export function panAxisRange(safeLo, safeHi, center, scaledSize) {
  const a = safeLo - center + scaledSize / 2;
  const b = safeHi - center - scaledSize / 2;
  return a <= b ? [a, b] : [b, a];
}

function clampTo(v, [lo, hi]) {
  return Math.min(hi, Math.max(lo, v));
}

function intersect([a, b], [c, d]) {
  const lo = Math.max(a, c);
  const hi = Math.min(b, d);
  return lo <= hi ? [lo, hi] : null;
}

/** Prende o arraste do visitante: a foto não sai da área segura nem deixa faixa vazia quando ampliada. */
export function clampPan(view, frame, safe) {
  const scale = Math.max(MIN_SCALE, finite(view?.scale, 1));
  const tx = finite(view?.translateX);
  const ty = finite(view?.translateY);
  if (!validFrame(frame) || !validSafe(safe)) return { scale, translateX: tx, translateY: ty };
  return {
    scale,
    translateX: clampTo(tx, panAxisRange(safe.left, safe.right, frame.cx, scale * frame.w)),
    translateY: clampTo(ty, panAxisRange(safe.top, safe.bottom, frame.cy, scale * frame.h)),
  };
}

/**
 * Close-up do destaque que nunca corta o retângulo marcado: escala para caber na área segura
 * (TARGET_FILL), centraliza nela e, se precisar escolher, prefere o destaque inteiro a cobrir a área.
 * @param {{ x?: number, y?: number, w?: number, h?: number } | null | undefined} hotspot  % sobre a imagem
 * @param {{ cx: number, cy: number, w: number, h: number }} frame
 * @param {{ left: number, top: number, right: number, bottom: number }} safe
 * @returns {{ scale: number, translateX: number, translateY: number }}
 */
export function computeSafeZoomCamera(hotspot, frame, safe, { fill = TARGET_FILL, maxScale = MAX_SCALE, margin = SAFE_MARGIN } = {}) {
  const none = { scale: 1, translateX: 0, translateY: 0 };
  if (!validFrame(frame) || !validSafe(safe)) return none;
  const w = finite(frame.w);
  const h = finite(frame.h);
  const safeW = safe.right - safe.left;
  const safeH = safe.bottom - safe.top;
  const hs = hotspot || { x: 40, y: 40, w: 12, h: 8 };
  const x0 = (finite(hs.x) / 100) * w - w / 2;
  const y0 = (finite(hs.y) / 100) * h - h / 2;
  const hsW = Math.max(1, (finite(hs.w) / 100) * w);
  const hsH = Math.max(1, (finite(hs.h) / 100) * h);
  const x1 = x0 + hsW;
  const y1 = y0 + hsH;

  const fit = Math.min(safeW / hsW, safeH / hsH) * fill;
  // why: com a folga, o destaque inteiro ainda cabe; só limita quando 1× já cabe
  const roomW = (safeW - 2 * margin) / hsW;
  const roomH = (safeH - 2 * margin) / hsH;
  const room = Math.min(roomW, roomH);
  let scale = Math.min(maxScale, Math.max(MIN_SCALE, fit));
  if (room >= MIN_SCALE) scale = Math.min(scale, room);

  const axis = (safeLo, safeHi, center, lo, hi, size) => {
    const desired = (safeLo + safeHi) / 2 - center - scale * ((lo + hi) / 2);
    const keep = [safeLo + margin - center - scale * lo, safeHi - margin - center - scale * hi];
    const cover = panAxisRange(safeLo, safeHi, center, scale * size);
    if (keep[0] > keep[1]) return clampTo(desired, cover);
    const both = intersect(keep, cover);
    return clampTo(desired, both || keep);
  };

  // why: close-up de quase 1× só sacode a foto; se o destaque já aparece inteiro, fica parado
  if (scale < MIN_USEFUL_SCALE) {
    const still = { left: frame.cx + x0, right: frame.cx + x1, top: frame.cy + y0, bottom: frame.cy + y1 };
    if (still.left >= safe.left && still.right <= safe.right && still.top >= safe.top && still.bottom <= safe.bottom) return none;
  }
  return {
    scale,
    translateX: axis(safe.left, safe.right, frame.cx, x0, x1, w),
    translateY: axis(safe.top, safe.bottom, frame.cy, y0, y1, h),
  };
}

/** Retângulo (px de tela) do destaque depois do transform — para testes e para conferir o enquadramento. */
export function hotspotScreenRect(hotspot, frame, camera) {
  const s = finite(camera?.scale, 1);
  const tx = finite(camera?.translateX);
  const ty = finite(camera?.translateY);
  const w = finite(frame?.w);
  const h = finite(frame?.h);
  const left = frame.cx + tx + s * ((finite(hotspot?.x) / 100) * w - w / 2);
  const top = frame.cy + ty + s * ((finite(hotspot?.y) / 100) * h - h / 2);
  return { left, top, right: left + s * (finite(hotspot?.w) / 100) * w, bottom: top + s * (finite(hotspot?.h) / 100) * h };
}

/** Teto do zoom do visitante: até a resolução real da foto (mín. 3×, máx. 6×). */
export function maxUserScale(naturalW, displayedW) {
  const ratio = finite(naturalW) / Math.max(1, finite(displayedW, 1));
  return Math.min(6, Math.max(3, Number.isFinite(ratio) ? ratio : 3));
}

/**
 * Pinça: o ponto da foto que estava sob o meio dos dedos segue o meio dos dedos.
 * start = câmera no início do gesto; startMid/mid = {x,y}; startDist/dist = distância entre os dedos.
 */
export function pinchCamera(start, startMid, startDist, mid, dist, frame, { maxScale = 4 } = {}) {
  const s0 = Math.max(MIN_SCALE, finite(start?.scale, 1));
  const t0x = finite(start?.translateX);
  const t0y = finite(start?.translateY);
  const px = (finite(startMid?.x) - frame.cx - t0x) / s0;
  const py = (finite(startMid?.y) - frame.cy - t0y) / s0;
  const ratio = finite(startDist) > 0 ? finite(dist, startDist) / finite(startDist) : 1;
  const scale = Math.min(Math.max(maxScale, s0), Math.max(MIN_SCALE, s0 * ratio));
  return {
    scale,
    translateX: finite(mid?.x) - frame.cx - scale * px,
    translateY: finite(mid?.y) - frame.cy - scale * py,
  };
}

/** Dois toques rápidos e perto um do outro. */
export function isDoubleTap(prev, cur, { maxMs = 320, maxDist = 32 } = {}) {
  if (!prev || !cur) return false;
  const dt = finite(cur.at) - finite(prev.at);
  if (dt <= 0 || dt > maxMs) return false;
  return Math.hypot(finite(cur.x) - finite(prev.x), finite(cur.y) - finite(prev.y)) <= maxDist;
}

/**
 * Área segura: o retângulo do palco menos o que fica por cima (controles, aviso, legenda, balão, CTA).
 * Para cada peça que invade, corta pelo lado que preserva mais área.
 * @param {{ left: number, top: number, right: number, bottom: number }} base
 * @param {Array<{ left: number, top: number, right: number, bottom: number }>} occluders
 */
export function safeAreaRect(base, occluders = [], gap = 6) {
  let r = { left: finite(base.left), top: finite(base.top), right: finite(base.right), bottom: finite(base.bottom) };
  for (const o of occluders) {
    if (!o) continue;
    const ol = finite(o.left);
    const ot = finite(o.top);
    const or = finite(o.right);
    const ob = finite(o.bottom);
    if (or - ol <= 0 || ob - ot <= 0) continue;
    if (or <= r.left || ol >= r.right || ob <= r.top || ot >= r.bottom) continue;
    const options = [
      { ...r, top: Math.max(r.top, ob + gap) },
      { ...r, bottom: Math.min(r.bottom, ot - gap) },
      { ...r, left: Math.max(r.left, or + gap) },
      { ...r, right: Math.min(r.right, ol - gap) },
    ].filter((c) => c.right > c.left && c.bottom > c.top);
    if (!options.length) continue;
    const area = (c) => (c.right - c.left) * (c.bottom - c.top);
    r = options.reduce((best, c) => (area(c) > area(best) ? c : best));
  }
  return r;
}
