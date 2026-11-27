/**
 * Qual tela o editor mostra ao abrir, quando não há um fluxo que já
 * tenha tomado a frente (captura da extensão, convite, ?novo=, login).
 * Primeira visita (sem projeto ativo): lista de projetos, sem Preview automático.
 * Quem já usava e tem activeProjectId volta ao último projeto, sem preview.
 */
export function planEditorBootScreen({ skipSavedOpen, activeProjectId } = {}) {
  if (skipSavedOpen) return { action: "defer" };
  if (activeProjectId) return { action: "open", projectId: activeProjectId, autoPreview: false };
  return { action: "library" };
}

/** Card intocado do tour de exemplo: oferece "Ver exemplo" na biblioteca. */
export function shouldOfferExamplePreview(project) {
  return Boolean(project?.stock);
}
