/**
 * Transições automáticas do player guiado (sem opção para quem edita):
 * - câmera: dois passos seguidos recortados do MESMO print (step.crop.group igual) andam/aproximam entre os recortes;
 * - troca só do que mudou: print seguinte quase igual → só a área diferente faz fade;
 * - o resto (diferença grande, tamanhos diferentes, leitura falhou) cai na revelação do clique que já existe.
 * Liga só em tours novos (playback.autoTransitions) e nunca na galeria; `?transitions=off|on` compara no preview.
 * Parte pura aqui; o DOM fica em autoTransitionDom.js.
 */

import { isGalleryMode } from "./tour-schema/playbackMode.js";

export const AUTO_TRANSITION_MS = 450;
export const AUTO_TRANSITION_MAX_MS = 600;

/** Grade da comparação: a imagem vira 160×90 em tons de cinza antes de comparar. */
export const DIFF_GRID = Object.freeze({ w: 160, h: 90 });
/** Diferença mínima de cinza (0–255) para a célula contar como mudada. */
export const DIFF_PIXEL = 24;
/** Mais que isto de células mudadas: tela diferente, não "quase igual". */
export const DIFF_MAX_FRACTION = 0.2;
/** A caixa do que mudou não pode passar disto da tela (senão o fade parece um corte). */
export const DIFF_MAX_BOX_AREA = 0.45;
/** Folga em células em volta da caixa (antialias e sombra não ficam de fora). */
export const DIFF_PAD = 2;

const GROUP = /^[a-z0-9]{8,64}$/;
const isNum = (n) => typeof n === "number" && Number.isFinite(n);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** "on" | "off": galeria nunca; ?transitions= vence; senão só tours que nasceram com a flag. */
export function autoTransitionsMode(demo, search = "") {
  if (isGalleryMode(demo)) return "off";
  let forced = null;
  try {
    const raw = String(search ?? "");
    forced = new URLSearchParams(raw.startsWith("?") ? raw.slice(1) : raw).get("transitions");
  } catch {
    forced = null;
  }
  if (forced === "off") return "off";
  if (forced === "on") return "on";
  return demo?.playback?.autoTransitions === true ? "on" : "off";
}

/** Recorte publicado do passo ({ group, rect }) ou null. */
export function readCameraView(step) {
  const c = step?.crop;
  if (!c || typeof c !== "object" || typeof c.group !== "string" || !GROUP.test(c.group)) return null;
  const r = c.rect;
  if (!r || ![r.x, r.y, r.w, r.h].every(isNum)) return null;
  if (r.w <= 0 || r.h <= 0 || r.x < 0 || r.y < 0 || r.x + r.w > 100.001 || r.y + r.h > 100.001) return null;
  return { group: c.group, rect: { x: r.x, y: r.y, w: r.w, h: r.h } };
}

/** Câmera entre dois recortes do mesmo print, ou null. */
export function cameraPlan(fromStep, toStep, ms = AUTO_TRANSITION_MS) {
  if (!fromStep || !toStep || fromStep.type === "slide" || toStep.type === "slide") return null;
  const a = readCameraView(fromStep);
  const b = readCameraView(toStep);
  if (!a || !b || a.group !== b.group) return null;
  const same = ["x", "y", "w", "h"].every((k) => Math.abs(a.rect[k] - b.rect[k]) < 0.5);
  if (same) return null;
  return { kind: "camera", from: a.rect, to: b.rect, ms: clamp(ms, 0, AUTO_TRANSITION_MAX_MS) };
}

const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Quadro t (0–1) da câmera, em pixels da tela.
 * from/to: recortes em % do print; boxA/boxB: onde cada imagem fica na tela (left/top/width/height).
 * Devolve a janela (lerp das caixas) e onde desenhar A e B para que o mesmo ponto do print coincida.
 */
export function cameraFrame(from, to, boxA, boxB, t) {
  const k = clamp(t, 0, 1);
  // escala: pixels de tela por 1% do print (geométrica, para o zoom não "acelerar")
  const sAx = boxA.width / from.w;
  const sAy = boxA.height / from.h;
  const sBx = boxB.width / to.w;
  const sBy = boxB.height / to.h;
  const sx = Math.exp(lerp(Math.log(sAx), Math.log(sBx), k));
  const sy = Math.exp(lerp(Math.log(sAy), Math.log(sBy), k));
  // ponto do print no centro da janela
  const cA = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
  const cB = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
  const view = {
    left: lerp(boxA.left, boxB.left, k),
    top: lerp(boxA.top, boxB.top, k),
    width: lerp(boxA.width, boxB.width, k),
    height: lerp(boxA.height, boxB.height, k),
  };
  const c = { x: lerp(cA.x, cB.x, k), y: lerp(cA.y, cB.y, k) };
  const place = (r) => ({
    left: view.left + view.width / 2 + (r.x - c.x) * sx,
    top: view.top + view.height / 2 + (r.y - c.y) * sy,
    width: r.w * sx,
    height: r.h * sy,
  });
  return { view, a: place(from), b: place(to) };
}

/**
 * Compara duas grades de cinza (mesmo tamanho w×h).
 * @returns {{ kind: "same" } | { kind: "region", box: {x,y,w,h}, fraction: number } | { kind: "large", fraction: number }}
 */
export function changedRegion(lumA, lumB, w = DIFF_GRID.w, h = DIFF_GRID.h, opts = {}) {
  const pixel = opts.pixel ?? DIFF_PIXEL;
  const maxFraction = opts.maxFraction ?? DIFF_MAX_FRACTION;
  const maxBox = opts.maxBoxArea ?? DIFF_MAX_BOX_AREA;
  const pad = opts.pad ?? DIFF_PAD;
  const n = w * h;
  if (!lumA || !lumB || lumA.length !== n || lumB.length !== n || n === 0) return { kind: "large", fraction: 1 };
  const raw = new Uint8Array(n);
  for (let i = 0; i < n; i++) raw[i] = Math.abs(lumA[i] - lumB[i]) > pixel ? 1 : 0;
  // why: ruído de compressão vira ponto solto; mudança de verdade (texto, botão) tem vizinhos
  let count = 0;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!raw[y * w + x]) continue;
      let nb = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h && raw[yy * w + xx]) nb++;
        }
      }
      if (nb < 2) continue;
      count++;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  const fraction = count / n;
  if (!count) return { kind: "same" };
  if (fraction > maxFraction) return { kind: "large", fraction };
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad);
  y1 = Math.min(h - 1, y1 + pad);
  const box = {
    x: (x0 / w) * 100,
    y: (y0 / h) * 100,
    w: ((x1 - x0 + 1) / w) * 100,
    h: ((y1 - y0 + 1) / h) * 100,
  };
  if ((box.w * box.h) / 10000 > maxBox) return { kind: "large", fraction };
  return { kind: "region", box, fraction };
}

/** Proporções compatíveis para comparar pixel a pixel (1% de folga). */
export function sameAspect(wA, hA, wB, hB) {
  if (![wA, hA, wB, hB].every((n) => isNum(n) && n > 0)) return false;
  const a = wA / hA;
  const b = wB / hB;
  return Math.abs(a - b) / a <= 0.01;
}

/** Plano de fade só da região, ou null (cai na revelação do clique). "same" = troca sem efeito. */
export function dissolvePlan(diff, ms = AUTO_TRANSITION_MS) {
  if (!diff) return null;
  if (diff.kind === "same") return { kind: "same" };
  if (diff.kind !== "region") return null;
  return { kind: "dissolve", box: diff.box, ms: clamp(ms, 0, AUTO_TRANSITION_MAX_MS) };
}
