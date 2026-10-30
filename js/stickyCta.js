/**
 * Botão fixo "Chamar no WhatsApp" durante o tour (a partir do passo escolhido no editor).
 * why: o visitante decide no meio do tour (ex.: nas plantas); esperar o cartão final perde o lead.
 * O número, a mensagem e o texto vêm do passo final (fixedSteps.stickyWhatsAppAction já validou o href).
 */
import { t } from "./i18n.js";
import { WA_ICON, svgIcon } from "./fixedStepsView.js";

export function createStickyCta({ onAction } = {}) {
  let root = null;
  let labelEl = null;
  let current = null;

  function ensure() {
    if (root?.isConnected) return root;
    root = document.createElement("a");
    root.className = "gf-sticky-cta";
    root.target = "_blank";
    root.rel = "noopener noreferrer";
    root.hidden = true;
    root.dataset.cta = "whatsapp";
    labelEl = document.createElement("span");
    labelEl.className = "gf-sticky-cta-label";
    root.append(svgIcon(WA_ICON), labelEl);
    // why: o toque no botão não é "fora do tour" nem gesto de passo/zoom (igual aos controles)
    for (const ev of ["pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend"]) {
      root.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
    }
    root.addEventListener("click", (e) => {
      e.stopPropagation();
      if (current) onAction?.(current);
    });
    document.body.append(root);
    return root;
  }

  /** action = { label, href } ou null (esconde). */
  function update(action) {
    if (!action?.href) {
      hide();
      return;
    }
    ensure();
    current = action;
    const label = action.label || t("fixed.end.waLabel");
    labelEl.textContent = label;
    root.href = action.href;
    // why: o nome acessível diz que abre o WhatsApp numa aba nova (o ícone é decorativo)
    root.setAttribute("aria-label", t("player.stickyWaAria", { label }));
    root.title = label;
    root.hidden = false;
    document.documentElement.classList.add("has-gf-sticky-cta");
  }

  function hide() {
    current = null;
    if (root) root.hidden = true;
    document.documentElement.classList.remove("has-gf-sticky-cta");
  }

  return {
    update,
    hide,
    element: () => root,
    isVisible: () => Boolean(root && !root.hidden && root.isConnected),
  };
}
