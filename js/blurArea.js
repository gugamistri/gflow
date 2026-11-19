/**
 * Desfoque de áreas do print. Lógica pura (sem DOM): o editor desenha, isto mexe nos pixels.
 * why: o desfoque é gravado nos pixels da imagem do passo. Nada de camada CSS por cima:
 *      o tour publicado (/p, /v, embed, HTML, vídeo) só conhece a imagem já borrada.
 *      O original fica só neste navegador (blurStore.js) para mover ou remover os retângulos.
 *
 * Retângulos em % da imagem (0..100), como o destaque (`hotspot`).
 */

/** Teto de retângulos por passo. */
export const MAX_BLUR_RECTS = 24;
/** Lado mínimo de um retângulo, em % da imagem. */
export const MIN_BLUR_SIZE = 0.5;

const round2 = (n) => Math.round(n * 100) / 100;
const clampN = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** Retângulo válido dentro da imagem, ou null. */
export function normalizeBlurRect(rect) {
  if (!rect || typeof rect !== "object") return null;
  let x = Number(rect.x);
  let y = Number(rect.y);
  let w = Number(rect.w);
  let h = Number(rect.h);
  if (![x, y, w, h].every(Number.isFinite)) return null;
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
  if (x1 - x0 < MIN_BLUR_SIZE || y1 - y0 < MIN_BLUR_SIZE) return null;
  return { x: round2(x0), y: round2(y0), w: round2(x1 - x0), h: round2(y1 - y0) };
}

export function normalizeBlurRects(rects) {
  if (!Array.isArray(rects)) return [];
  const out = [];
  for (const r of rects) {
    const n = normalizeBlurRect(r);
    if (n) out.push(n);
    if (out.length >= MAX_BLUR_RECTS) break;
  }
  return out;
}

/** Move um retângulo sem deixá-lo sair da imagem (mantém o tamanho). */
export function moveBlurRect(rect, dx, dy) {
  const w = clampN(Number(rect.w) || 0, 0, 100);
  const h = clampN(Number(rect.h) || 0, 0, 100);
  return {
    x: round2(clampN((Number(rect.x) || 0) + dx, 0, 100 - w)),
    y: round2(clampN((Number(rect.y) || 0) + dy, 0, 100 - h)),
    w: round2(w),
    h: round2(h),
  };
}

/** % → pixels inteiros (arredonda para fora: a borda do texto não escapa). */
export function blurRectToPixels(rect, width, height) {
  const x0 = clampN(Math.floor((rect.x / 100) * width), 0, width);
  const y0 = clampN(Math.floor((rect.y / 100) * height), 0, height);
  const x1 = clampN(Math.ceil(((rect.x + rect.w) / 100) * width), 0, width);
  const y1 = clampN(Math.ceil(((rect.y + rect.h) / 100) * height), 0, height);
  return { x0, y0, x1, y1 };
}

/**
 * Raio do desfoque para o tamanho da imagem. Forte de propósito: texto de interface
 * (12–20 px) vira mancha. 1280 px → 21, 1920 px → 32, 2560 px → 43.
 */
export function blurRadiusFor(width, height) {
  const side = Math.max(Number(width) || 0, Number(height) || 0);
  return clampN(Math.round(side / 60), 12, 48);
}

function boxPass(src, dst, w, h, r, horizontal) {
  const lineLen = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const win = 2 * r + 1;
  for (let line = 0; line < lines; line += 1) {
    for (let c = 0; c < 4; c += 1) {
      const at = (i) => {
        const k = i < 0 ? 0 : i >= lineLen ? lineLen - 1 : i; // borda presa dentro do retângulo
        return horizontal ? (line * w + k) * 4 + c : (k * w + line) * 4 + c;
      };
      let sum = 0;
      for (let i = -r; i <= r; i += 1) sum += src[at(i)];
      for (let i = 0; i < lineLen; i += 1) {
        dst[at(i)] = sum / win;
        sum += src[at(i + r + 1)] - src[at(i - r)];
      }
    }
  }
}

/**
 * Desfoca, no lugar, a região de um RGBA (Uint8ClampedArray, largura × altura).
 * 1) média por blocos (apaga o detalhe fino de vez), 2) três passadas de caixa ≈ gaussiano.
 * Só lê pixels de dentro da região: nada de fora vaza para dentro e vice-versa.
 */
export function blurPixels(data, width, height, px, radius = blurRadiusFor(width, height)) {
  const { x0, y0, x1, y1 } = px;
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return;
  let buf = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const from = ((y0 + y) * width + x0) * 4;
    for (let i = 0; i < w * 4; i += 1) buf[y * w * 4 + i] = data[from + i];
  }
  const block = Math.max(2, Math.round(radius / 2));
  for (let by = 0; by < h; by += block) {
    for (let bx = 0; bx < w; bx += block) {
      const ex = Math.min(w, bx + block);
      const ey = Math.min(h, by + block);
      const n = (ex - bx) * (ey - by);
      const acc = [0, 0, 0, 0];
      for (let y = by; y < ey; y += 1) for (let x = bx; x < ex; x += 1) for (let c = 0; c < 4; c += 1) acc[c] += buf[(y * w + x) * 4 + c];
      for (let y = by; y < ey; y += 1) for (let x = bx; x < ex; x += 1) for (let c = 0; c < 4; c += 1) buf[(y * w + x) * 4 + c] = acc[c] / n;
    }
  }
  let tmp = new Float32Array(buf.length);
  const r = Math.max(1, Math.round(radius));
  for (let pass = 0; pass < 3; pass += 1) {
    boxPass(buf, tmp, w, h, r, true);
    boxPass(tmp, buf, w, h, r, false);
  }
  tmp = null;
  for (let y = 0; y < h; y += 1) {
    const to = ((y0 + y) * width + x0) * 4;
    for (let i = 0; i < w * 4; i += 1) data[to + i] = Math.round(buf[y * w * 4 + i]);
  }
  buf = null;
}

/** Aplica todos os retângulos num ImageData-like `{ data, width, height }`. */
export function applyBlurRects(image, rects, { radius } = {}) {
  const { data, width, height } = image;
  const r = radius || blurRadiusFor(width, height);
  for (const rect of normalizeBlurRects(rects)) blurPixels(data, width, height, blurRectToPixels(rect, width, height), r);
  return image;
}

/** Ficha do passo: `{ id, key, rects }`. `key` = id da imagem em customImages que recebeu o desfoque. */
export function readStepBlur(step) {
  const b = step?.blur;
  if (!b || typeof b !== "object") return null;
  const id = typeof b.id === "string" && /^[A-Za-z0-9_-]{4,64}$/.test(b.id) ? b.id : "";
  const key = typeof b.key === "string" ? b.key : "";
  const rects = normalizeBlurRects(b.rects);
  if (!id || !key || !rects.length) return null;
  return { id, key, rects };
}

/** A ficha ainda descreve a imagem atual do passo? (Trocar a imagem desfaz o vínculo.) */
export function blurMatchesStep(step) {
  const b = readStepBlur(step);
  return Boolean(b && step?.image === `custom:${b.key}`);
}

/**
 * Tira a ficha do desfoque do tour que sai do editor (/p, /v, HTML).
 * why: o player não usa; e o JSON público não precisa saber onde houve desfoque.
 */
export function stripBlurMeta(demo) {
  for (const step of Array.isArray(demo?.steps) ? demo.steps : []) {
    if (step && typeof step === "object") delete step.blur;
  }
  return demo;
}

/** Quantos passos usam a mesma imagem da biblioteca. */
export function customImageUsers(demo, key) {
  const ref = `custom:${key}`;
  return (demo?.steps || []).filter((s) => s?.image === ref).length;
}
