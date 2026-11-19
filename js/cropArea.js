/**
 * Enquadrar: o passo mostra só a parte do print que importa, grande. Lógica pura (sem DOM).
 * why: o recorte vira a própria imagem do passo (pixels), então player, /p, /v, embed, HTML,
 *      vídeo, API e MCP funcionam sem mudança. O print inteiro fica só neste navegador
 *      (cropStore.js) para mudar o enquadramento ou voltar à tela inteira.
 * Destaque e clique simulado são remapeados: eles continuam em % da imagem mostrada.
 *
 * Retângulo do recorte em % do print inteiro (0..100), como o destaque.
 */

export const MIN_CROP_SIZE = 5;

const round2 = (n) => Math.round(n * 100) / 100;
const clampN = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const finite = (...v) => v.every((n) => Number.isFinite(Number(n)));

/** Recorte válido (≥ 5 % em cada lado) ou null. */
export function normalizeCropRect(rect) {
  if (!rect || typeof rect !== "object" || !finite(rect.x, rect.y, rect.w, rect.h)) return null;
  let { x, y, w, h } = { x: +rect.x, y: +rect.y, w: +rect.w, h: +rect.h };
  if (w < 0) {
    x += w;
    w = -w;
  }
  if (h < 0) {
    y += h;
    h = -h;
  }
  const x0 = clampN(x, 0, 100);
  const y0 = clampN(y, 0, 100);
  const x1 = clampN(x + w, 0, 100);
  const y1 = clampN(y + h, 0, 100);
  if (x1 - x0 < MIN_CROP_SIZE || y1 - y0 < MIN_CROP_SIZE) return null;
  return { x: round2(x0), y: round2(y0), w: round2(x1 - x0), h: round2(y1 - y0) };
}

/** O recorte cobre a imagem inteira (= sem recorte). */
export function isFullCrop(rect) {
  return !rect || (rect.x <= 0.01 && rect.y <= 0.01 && rect.w >= 99.98 && rect.h >= 99.98);
}

/** Ponto em % do print inteiro → % do recorte (sem prender). */
export function pointToCrop(p, crop) {
  return { x: ((p.x - crop.x) / crop.w) * 100, y: ((p.y - crop.y) / crop.h) * 100 };
}

/** Ponto em % do recorte → % do print inteiro. */
export function pointFromCrop(p, crop) {
  return { x: crop.x + (p.x / 100) * crop.w, y: crop.y + (p.y / 100) * crop.h };
}

function rectVia(rect, mapPoint) {
  const a = mapPoint({ x: rect.x, y: rect.y });
  const b = mapPoint({ x: rect.x + rect.w, y: rect.y + rect.h });
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
}

/** Destaque dentro da imagem mostrada: preso, com tamanho mínimo (nunca some). */
function clampHotspot(hs, min = 2) {
  const w = clampN(hs.w, min, 100);
  const h = clampN(hs.h, min, 100);
  const x0 = clampN(hs.x, 0, 100);
  const y0 = clampN(hs.y, 0, 100);
  const x1 = clampN(hs.x + hs.w, 0, 100);
  const y1 = clampN(hs.y + hs.h, 0, 100);
  let nw = Math.max(min, x1 - x0);
  let nh = Math.max(min, y1 - y0);
  nw = Math.min(nw, w, 100);
  nh = Math.min(nh, h, 100);
  return { x: round2(clampN(x0, 0, 100 - nw)), y: round2(clampN(y0, 0, 100 - nh)), w: round2(nw), h: round2(nh) };
}

const clampPoint = (p) => ({ x: round2(clampN(p.x, 0, 100)), y: round2(clampN(p.y, 0, 100)) });

function validRect(r) {
  return r && finite(r.x, r.y, r.w, r.h) && r.w > 0 && r.h > 0;
}
function validPoint(p) {
  return p && finite(p.x, p.y);
}

/**
 * Remapeia destaque e clique de um enquadramento para outro.
 * `from`/`to`: recorte em % do print inteiro, ou null = tela inteira.
 * Muta e devolve o passo. Passo sem destaque/clique fica igual.
 */
export function remapStepGeometry(step, from, to) {
  if (!step || typeof step !== "object") return step;
  const toFull = (p) => (from ? pointFromCrop(p, from) : { x: p.x, y: p.y });
  const toShown = (p) => (to ? pointToCrop(p, to) : p);
  const map = (p) => toShown(toFull(p));
  if (validRect(step.hotspot)) step.hotspot = clampHotspot(rectVia(step.hotspot, map));
  if (validPoint(step.clickPoint)) {
    const cp = clampPoint(map(step.clickPoint));
    // why: o clique fica dentro do destaque (mesma regra do editor)
    if (validRect(step.hotspot)) {
      const hs = step.hotspot;
      cp.x = round2(clampN(cp.x, hs.x, hs.x + hs.w));
      cp.y = round2(clampN(cp.y, hs.y, hs.y + hs.h));
    }
    step.clickPoint = cp;
  }
  return step;
}

/**
 * Tamanho da imagem recortada: amplia até caber no tamanho do print original.
 * why: um recorte de 400 px apareceria pequeno no player (a imagem não passa do tamanho natural);
 *      ampliado ele ocupa o palco como um print normal.
 */
export function cropOutputSize(srcW, srcH, crop) {
  const cw = Math.max(1, Math.round((crop.w / 100) * srcW));
  const ch = Math.max(1, Math.round((crop.h / 100) * srcH));
  const scale = Math.max(1, Math.min(srcW / cw, srcH / ch));
  return { sx: Math.round((crop.x / 100) * srcW), sy: Math.round((crop.y / 100) * srcH), sw: cw, sh: ch, width: Math.round(cw * scale), height: Math.round(ch * scale) };
}

/** Ficha do passo `{ id, key, rect }` ou null (tour antigo, ou ficha estragada). */
export function readStepCrop(step) {
  const c = step?.crop;
  if (!c || typeof c !== "object") return null;
  const id = typeof c.id === "string" && /^[A-Za-z0-9_-]{4,64}$/.test(c.id) ? c.id : "";
  const key = typeof c.key === "string" ? c.key : "";
  const rect = normalizeCropRect(c.rect);
  if (!id || !key || !rect) return null;
  return { id, key, rect };
}

export function cropMatchesStep(step) {
  const c = readStepCrop(step);
  return Boolean(c && step?.image === `custom:${c.key}`);
}

/** Tira a ficha do recorte do tour que sai do editor (/p, /v, HTML): a imagem já é o recorte. */
export function stripCropMeta(demo) {
  for (const step of Array.isArray(demo?.steps) ? demo.steps : []) {
    if (step && typeof step === "object") delete step.crop;
  }
  return demo;
}

export function customImageUsers(demo, key) {
  const ref = `custom:${key}`;
  return (demo?.steps || []).filter((s) => s?.image === ref).length;
}
