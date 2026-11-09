/**
 * Revela a próxima captura a partir do clique (clip-path circular).
 * Sem blur, bounce ou partículas. O véu do Driver some só durante o círculo.
 */

import { clickRevealCircle } from "./tour-schema/clickTransition.js";

const EASING = "cubic-bezier(0.2, 0, 0.2, 1)";

export function clearClickReveals(root = globalThis.document) {
  root?.querySelectorAll?.("img.gf-click-reveal")?.forEach((el) => el.remove());
}

function veilEl() {
  return document.querySelector(".driver-overlay");
}

/**
 * @param {HTMLImageElement} img imagem atual (a nova entra por cima e depois assume o src)
 * @param {string} src
 * @param {{ xPct: number, yPct: number, ms: number }} plan
 * @param {{ cancelled?: () => boolean }} [opts]
 * @returns {Promise<boolean>} true se a imagem já mostra `src`
 */
export function playClickReveal(img, src, plan, opts = {}) {
  return new Promise((resolve) => {
    const cancelled = () => opts.cancelled?.() === true;
    if (!img || !src || !plan || !(plan.ms > 0) || cancelled()) {
      resolve(false);
      return;
    }
    const parent = img.parentElement;
    const w = img.clientWidth;
    const h = img.clientHeight;
    if (!parent || w < 2 || h < 2) {
      resolve(false);
      return;
    }
    const clip = clickRevealCircle(plan.xPct, plan.yPct, w, h);
    const overlay = document.createElement("img");
    overlay.className = "gf-click-reveal";
    overlay.alt = "";
    overlay.setAttribute("aria-hidden", "true");
    overlay.draggable = false;
    Object.assign(overlay.style, {
      position: "absolute",
      left: img.offsetLeft + "px",
      top: img.offsetTop + "px",
      width: w + "px",
      height: h + "px",
      maxWidth: "none",
      maxHeight: "none",
      margin: "0",
      objectFit: "fill",
      pointerEvents: "none",
      zIndex: "4",
      clipPath: clip.from,
    });

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

    const paintBase = () => {
      if (cancelled()) {
        finish(false);
        return;
      }
      const painted = () => finish(true);
      if (img.getAttribute("src") === src && img.complete && img.naturalWidth > 0) {
        img.hidden = false;
        painted();
        return;
      }
      img.onload = () => {
        img.hidden = false;
        painted();
      };
      img.onerror = () => finish(false);
      img.hidden = false;
      img.src = src;
    };

    const grow = () => {
      if (cancelled()) {
        finish(false);
        return;
      }
      let grew = false;
      const done = () => {
        if (grew) return;
        grew = true;
        paintBase();
      };
      try {
        const anim = overlay.animate(
          [{ clipPath: clip.from }, { clipPath: clip.to }],
          { duration: plan.ms, easing: EASING, fill: "forwards" },
        );
        const timer = setTimeout(done, plan.ms + 80);
        anim.finished.then(() => {
          clearTimeout(timer);
          done();
        }).catch(() => {
          clearTimeout(timer);
          done();
        });
      } catch {
        overlay.style.clipPath = clip.to;
        done();
      }
    };

    const loadTimer = setTimeout(() => finish(false), 4000);
    overlay.onerror = () => {
      clearTimeout(loadTimer);
      finish(false);
    };
    overlay.onload = () => {
      clearTimeout(loadTimer);
      grow();
    };
    parent.appendChild(overlay);
    overlay.src = src;
  });
}
