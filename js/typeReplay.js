/**
 * Typewriter sobre a imagem, antes do clique animado. Sem actions, não faz nada.
 * prefers-reduced-motion mostra o texto inteiro, sem animar letra a letra.
 */

import { typeReplayPlan } from "./tour-schema/typeActions.js";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { typeReplayPlan };

export async function playTypeReplay(img, plan) {
  if (!plan?.actions?.length || !img?.parentElement || img.clientWidth < 2) return;
  const layer = document.createElement("div");
  layer.className = "gf-type-replay";
  layer.setAttribute("aria-hidden", "true");
  Object.assign(layer.style, {
    position: "absolute",
    left: img.offsetLeft + "px",
    top: img.offsetTop + "px",
    width: img.clientWidth + "px",
    height: img.clientHeight + "px",
    pointerEvents: "none",
    zIndex: "6",
    overflow: "hidden",
  });
  img.parentElement.appendChild(layer);
  try {
    for (const action of plan.actions) {
      const chip = document.createElement("div");
      Object.assign(chip.style, {
        position: "absolute",
        left: action.x + "%",
        top: action.y + "%",
        transform: "translate(0, -50%)",
        maxWidth: "70%",
        padding: "2px 6px",
        background: "rgba(255,255,255,.94)",
        color: "#0f172a",
        font: "600 15px/1.3 Arial, sans-serif",
        borderRadius: "4px",
        whiteSpace: "pre",
        overflow: "hidden",
      });
      layer.appendChild(chip);
      if (plan.reducedMotion) {
        chip.textContent = action.text;
        continue;
      }
      const per = action.text.length > 48 ? 14 : 28;
      const budget = Math.min(1100, Math.max(160, action.text.length * per));
      const stepMs = Math.max(12, Math.round(budget / action.text.length));
      for (let i = 1; i <= action.text.length; i += 1) {
        chip.textContent = action.text.slice(0, i);
        await wait(stepMs);
      }
    }
    await wait(plan.reducedMotion ? 160 : 90);
  } finally {
    layer.remove();
  }
}
