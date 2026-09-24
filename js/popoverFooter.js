/** SVG da seta "anterior" — stroke via currentColor (= --ns-ink) */
export const PREV_ARROW_SVG = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M13.5 8L2.5 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 3.5L2.5 8L7 12.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/**
 * Layout do footer: ← | N de X | Próximo
 * @param {import('driver.js').PopoverDOM} popover
 */
export function renderDemoPopoverFooter(popover) {
  const { footer, progress, previousButton, nextButton, footerButtons } = popover;

  if (previousButton) {
    previousButton.innerHTML = PREV_ARROW_SVG;
    previousButton.setAttribute("aria-label", "Anterior");
    previousButton.title = "Anterior";
  }

  if (nextButton) {
    nextButton.setAttribute("aria-label", nextButton.innerText || "Próximo");
  }

  if (footer && previousButton && progress && nextButton) {
    footer.appendChild(previousButton);
    footer.appendChild(progress);
    footer.appendChild(nextButton);
    if (footerButtons && footerButtons !== footer && !footerButtons.children.length) {
      footerButtons.remove();
    }
  }
}

export function setPopoverHiddenForSlide(hidden) {
  document.querySelectorAll(".driver-popover").forEach((el) => {
    el.classList.toggle("is-slide-hidden", !!hidden);
  });
}

/** Clique no destaque = mesmo efeito do botão Próximo. */
export function clickDriverNext() {
  const btn = document.querySelector(".driver-popover-next-btn");
  if (btn && !btn.disabled) btn.click();
}
