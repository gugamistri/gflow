/**
 * DOM das transições automáticas (ver autoTransition.js). Mesmo contrato de playClickReveal:
 * resolve true quando `img` já mostra `src`; false → o player troca do jeito de sempre.
 */

import { DIFF_GRID, cameraFrame, changedRegion, sameAspect } from "./autoTransition.js";

const EASING = "cubic-bezier(0.2, 0, 0.2, 1)";
const ease = (t) => {
  // aproximação da mesma curva do clique, sem depender de WAAPI no quadro a quadro
  const k = Math.min(1, Math.max(0, t));
  return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
};

export function clearAutoTransitions(root = globalThis.document) {
  root?.querySelectorAll?.(".gf-auto-transition")?.forEach((el) => el.remove());
}

function loadImage(src, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const im = new Image();
    const timer = setTimeout(() => resolve(null), timeoutMs);
    im.decoding = "async";
    im.onload = () => {
      clearTimeout(timer);
      resolve(im.naturalWidth > 0 ? im : null);
    };
    im.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    im.src = src;
  });
}

/** Grade de cinza DIFF_GRID da imagem, ou null (canvas indisponível ou imagem de outra origem). */
export function lumaGrid(im) {
  try {
    const { w, h } = DIFF_GRID;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true });
    if (!g) return null;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    g.drawImage(im, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    const out = new Float32Array(w * h);
    for (let i = 0; i < out.length; i++) out[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    return out;
  } catch {
    return null;
  }
}

/** Compara a imagem na tela com a próxima. null = não deu para ler (cai na revelação do clique). */
export async function measureChange(currentImg, nextSrc) {
  if (!currentImg || !nextSrc || !(currentImg.naturalWidth > 0) || !currentImg.complete) return null;
  const next = await loadImage(nextSrc);
  if (!next) return null;
  if (!sameAspect(currentImg.naturalWidth, currentImg.naturalHeight, next.naturalWidth, next.naturalHeight)) return null;
  const a = lumaGrid(currentImg);
  const b = lumaGrid(next);
  if (!a || !b) return null;
  return changedRegion(a, b);
}

function veilEl() {
  return document.querySelector(".driver-overlay");
}

function copyOf(src) {
  const el = document.createElement("img");
  el.className = "gf-auto-transition";
  el.alt = "";
  el.setAttribute("aria-hidden", "true");
  el.draggable = false;
  el.src = src;
  Object.assign(el.style, { maxWidth: "none", maxHeight: "none", margin: "0", objectFit: "fill", pointerEvents: "none" });
  return el;
}

function swapBase(img, src) {
  return new Promise((resolve) => {
    if (img.getAttribute("src") === src && img.complete && img.naturalWidth > 0) {
      img.hidden = false;
      resolve(true);
      return;
    }
    const timer = setTimeout(() => resolve(false), 4000);
    img.onload = () => {
      clearTimeout(timer);
      img.hidden = false;
      resolve(true);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(false);
    };
    img.hidden = false;
    img.src = src;
  });
}

/**
 * Fade só da caixa que mudou: a imagem antiga fica por cima, recortada na caixa, e some.
 * Fora da caixa as duas são (quase) iguais, então nada parece mexer.
 */
export function playDissolve(img, src, plan, opts = {}) {
  return new Promise((resolve) => {
    const cancelled = () => opts.cancelled?.() === true;
    const parent = img?.parentElement;
    const oldSrc = img?.currentSrc || img?.getAttribute?.("src") || "";
    if (!parent || !src || !oldSrc || !plan?.box || !(plan.ms > 0) || cancelled()) {
      resolve(false);
      return;
    }
    const w = img.clientWidth;
    const h = img.clientHeight;
    if (w < 2 || h < 2) {
      resolve(false);
      return;
    }
    const b = plan.box;
    const overlay = copyOf(oldSrc);
    Object.assign(overlay.style, {
      position: "absolute",
      left: img.offsetLeft + "px",
      top: img.offsetTop + "px",
      width: w + "px",
      height: h + "px",
      zIndex: "4",
      clipPath: `inset(${b.y}% ${Math.max(0, 100 - b.x - b.w)}% ${Math.max(0, 100 - b.y - b.h)}% ${b.x}%)`,
    });
    parent.appendChild(overlay);
    const veil = veilEl();
    const veilOpacity = veil ? veil.style.opacity : "";
    if (veil) veil.style.opacity = "0";
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      if (veil) veil.style.opacity = veilOpacity;
      overlay.remove();
      resolve(ok);
    };
    swapBase(img, src).then((ok) => {
      if (!ok || cancelled()) {
        finish(ok && !cancelled());
        return;
      }
      try {
        const anim = overlay.animate([{ opacity: 1 }, { opacity: 0 }], { duration: plan.ms, easing: EASING, fill: "forwards" });
        const timer = setTimeout(() => finish(true), plan.ms + 80);
        anim.finished.then(() => {
          clearTimeout(timer);
          finish(true);
        }).catch(() => {
          clearTimeout(timer);
          finish(true);
        });
      } catch {
        finish(true);
      }
    });
  });
}

function boxOf(el) {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

function placeEl(el, r) {
  el.style.left = r.left + "px";
  el.style.top = r.top + "px";
  el.style.width = r.width + "px";
  el.style.height = r.height + "px";
}

/**
 * Câmera entre dois recortes do mesmo print: as duas imagens andam juntas (o mesmo ponto do print
 * fica no mesmo lugar da tela) enquanto a antiga some. Janela fixa por cima de tudo, recortada.
 */
export function playCamera(img, src, plan, opts = {}) {
  return new Promise((resolve) => {
    const cancelled = () => opts.cancelled?.() === true;
    const oldSrc = img?.currentSrc || img?.getAttribute?.("src") || "";
    if (!img || !src || !oldSrc || !plan?.from || !plan?.to || !(plan.ms > 0) || cancelled()) {
      resolve(false);
      return;
    }
    const boxA = boxOf(img);
    if (boxA.width < 2 || boxA.height < 2) {
      resolve(false);
      return;
    }
    const win = document.createElement("div");
    win.className = "gf-auto-transition";
    win.setAttribute("aria-hidden", "true");
    Object.assign(win.style, { position: "fixed", overflow: "hidden", zIndex: "10000", pointerEvents: "none" });
    placeEl(win, boxA);
    const a = copyOf(oldSrc);
    const b = copyOf(src);
    for (const el of [b, a]) {
      el.style.position = "absolute";
      win.appendChild(el);
    }
    placeEl(a, { ...boxA, left: 0, top: 0 });
    document.body.appendChild(win);
    const veil = veilEl();
    const veilOpacity = veil ? veil.style.opacity : "";
    if (veil) veil.style.opacity = "0";
    let settled = false;
    let guard = 0;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      if (veil) veil.style.opacity = veilOpacity;
      img.style.visibility = "";
      win.remove();
      resolve(ok);
    };
    // a imagem de verdade troca embaixo (invisível) para sabermos onde ela vai parar
    img.style.visibility = "hidden";
    swapBase(img, src).then((ok) => {
      if (!ok || cancelled()) {
        finish(ok && !cancelled());
        return;
      }
      const boxB = boxOf(img);
      if (boxB.width < 2 || boxB.height < 2) {
        finish(true);
        return;
      }
      const t0 = performance.now();
      const frame = (now) => {
        if (settled) return;
        if (cancelled()) {
          finish(false);
          return;
        }
        const t = Math.min(1, (now - t0) / plan.ms);
        const k = ease(t);
        const f = cameraFrame(plan.from, plan.to, boxA, boxB, k);
        placeEl(win, f.view);
        // filhos absolutos: coordenadas relativas à janela
        placeEl(a, { ...f.a, left: f.a.left - f.view.left, top: f.a.top - f.view.top });
        placeEl(b, { ...f.b, left: f.b.left - f.view.left, top: f.b.top - f.view.top });
        // why: B fica opaca embaixo; o mesmo print coincide, então só a antiga some por cima (sem "lavar" o meio)
        a.style.opacity = String(1 - k);
        if (t >= 1) finish(true);
        else requestAnimationFrame(frame);
      };
      guard = setTimeout(() => finish(true), plan.ms + 400);
      requestAnimationFrame(frame);
    });
  });
}
