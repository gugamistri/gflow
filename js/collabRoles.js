/**
 * Papéis da colaboração no cliente (espelha COLLAB_ACTIONS do servidor) e o que a interface mostra.
 * O servidor é quem autoriza; isto só evita oferecer botões que dariam 403.
 * Acesso ao projeto ≠ plano da conta: Pro decide IA/sync; membership decide escrita neste tour.
 */
export const COLLAB_ROLES = Object.freeze(["owner", "editor"]);
const RANK = { editor: 1, owner: 2 };

/** Membership antiga (viewer/commenter) conta como editor. */
export function normalizeClientRole(role) {
  if (role === "owner") return "owner";
  if (role === "editor" || role === "commenter" || role === "viewer") return "editor";
  return null;
}

export const roleAtLeast = (role, min) => {
  const a = normalizeClientRole(role) || role;
  const b = normalizeClientRole(min) || min;
  return (RANK[a] || 0) >= (RANK[b] || 99);
};

/**
 * @param {string|null} role  papel no projeto aberto (null = projeto não colaborativo)
 * @param {{guest?:boolean, readOnly?:boolean}} [opts] guest ignorado (plano é da conta);
 *        readOnly = dono sem Team ativo (servidor devolve 402 nas escritas)
 */
export function uiPermissions(role, { readOnly = false } = {}) {
  if (!role) {
    return {
      collab: false, canEdit: true, canComment: false, canInvite: false, canManageMembers: false,
      canCreateProject: true, canDeleteProject: true, canPublish: true, seeBilling: true, seeAnalytics: true,
      showPresence: false, readOnlyBanner: false,
    };
  }
  const effective = normalizeClientRole(role) || "editor";
  const isOwner = effective === "owner";
  const canEdit = roleAtLeast(effective, "editor") && !readOnly;
  return {
    collab: true,
    canEdit,
    canComment: canEdit,
    canInvite: isOwner && !readOnly,
    canManageMembers: isOwner && !readOnly,
    // projeto local sempre; sync na nuvem e IA dependem do Pro da sessão (billing/hostedAccess)
    canCreateProject: true,
    canDeleteProject: isOwner,
    canPublish: isOwner,
    seeBilling: true,
    seeAnalytics: isOwner,
    showPresence: true,
    readOnlyBanner: !canEdit,
  };
}

/** Motivo do somente leitura (chave de i18n) para o banner. */
export function readOnlyReason(role, { readOnly = false } = {}) {
  if (readOnly) return "collab.readonly.owner";
  return "";
}

/** Seletores que o não-dono não deve ver (publicação/analytics). Novo projeto e cobrança ficam. */
export const GUEST_HIDDEN_SELECTORS = Object.freeze([
  "#btn-share-publish", "#btn-share-revoke", "#btn-share-republish", "#btn-results",
]);
