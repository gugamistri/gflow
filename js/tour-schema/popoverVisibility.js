/**
 * Balão do passo guiado. Ausente ou hidden diferente de true = mostra, como hoje.
 * Slide não usa este balão (o cartão já é o texto).
 */

export function popoverIsHidden(step) {
  return Boolean(step && step.type !== "slide" && step.popover?.hidden === true);
}

/** Copia o popover e liga ou apaga `hidden` sem perder lado, texto ou align. */
export function popoverWithBalloon(popover, show) {
  const next = { ...(popover || {}) };
  if (show === false) next.hidden = true;
  else delete next.hidden;
  return next;
}
