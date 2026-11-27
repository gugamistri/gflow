/**
 * Qual tela o editor mostra ao abrir, quando não há um fluxo que já
 * tenha tomado a frente (captura da extensão, convite, ?novo=, login).
 * A lista de projetos é o padrão para visita nova e recorrente.
 * Os tours de exemplo continuam na biblioteca; não abrem sozinhos.
 */
export function planEditorBootScreen({ skipSavedOpen } = {}) {
  if (skipSavedOpen) return { action: "defer" };
  return { action: "library" };
}

/** Card intocado do tour de exemplo: oferece "Ver exemplo" na biblioteca. */
export function shouldOfferExamplePreview(project) {
  return Boolean(project?.stock);
}
