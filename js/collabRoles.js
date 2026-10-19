/**
 * Papéis da colaboração no cliente (espelha COLLAB_ACTIONS do servidor) e o que a interface mostra.
 * O servidor é quem autoriza; isto só evita oferecer botões que dariam 403.
 */
export const COLLAB_ROLES = Object.freeze(["owner", "editor", "commenter", "viewer"]);
const RANK = { viewer: 1, commenter: 2, editor: 3, owner: 4 };

export const roleAtLeast = (role, min) => (RANK[role] || 0) >= (RANK[min] || 99);

/**
 * @param {string|null} role  papel no projeto aberto (null = projeto não colaborativo)
 * @param {{guest?:boolean, readOnly?:boolean}} [opts] guest = conta criada por convite (plan none);
 *        readOnly = dono sem Team ativo (servidor devolve 402 nas escritas)
 */
export function uiPermissions(role, { guest = false, readOnly = false } = {}) {
  if (!role) {
    return {
      collab: false, canEdit: true, canComment: false, canInvite: false, canManageMembers: false,
      canCreateProject: true, canDeleteProject: true, canPublish: true, seeBilling: true, seeAnalytics: true,
      showPresence: false, readOnlyBanner: false,
    };
  }
  const isOwner = role === "owner";
  const canEdit = roleAtLeast(role, "editor") && !readOnly;
  return {
    collab: true,
    canEdit,
    canComment: roleAtLeast(role, "commenter") && !readOnly,
    canInvite: isOwner && !readOnly,
    canManageMembers: isOwner && !readOnly,
    // convidado (plan none) nunca cria/apaga projeto, publica nem vê cobrança; dono mantém o que já tem
    canCreateProject: !guest,
    canDeleteProject: isOwner && !guest,
    canPublish: isOwner && !guest,
    seeBilling: !guest,
    seeAnalytics: isOwner,
    showPresence: true,
    readOnlyBanner: !canEdit,
  };
}

/** Motivo do somente leitura (chave de i18n) para o banner. */
export function readOnlyReason(role, { readOnly = false } = {}) {
  if (readOnly) return "collab.readonly.owner";
  if (role === "viewer") return "collab.readonly.viewer";
  if (role === "commenter") return "collab.readonly.commenter";
  return "";
}

/** Seletores do editor que o convidado/leitor não deve ver ou usar. */
export const GUEST_HIDDEN_SELECTORS = Object.freeze([
  "#btn-new-project", "#btn-share-publish", "#btn-share-revoke", "#btn-share-republish", "#btn-results",
  "#billing-menu", "[data-billing]",
]);
