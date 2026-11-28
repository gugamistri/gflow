/**
 * "Sincronizando…" na lista de projetos.
 * why: conta com sync e navegador sem a primeira volta; mostrar só os exemplos por um instante
 * parece biblioteca vazia ou perdida. Vale só enquanto há o que esperar e por tempo limitado.
 */

export const LIBRARY_HYDRATE_MAX_MS = 20 * 1000;

/**
 * @param {object} input
 * @param {boolean} input.cloudEnabled
 * @param {boolean} input.signedIn
 * @param {string} input.email
 * @param {"idle"|"ready"|"hidden"|string} input.billingStatus
 * @param {boolean} input.entitlementActive
 * @param {string} input.syncPhase
 * @param {boolean} input.firstSyncDone  a primeira volta desta conta já terminou neste navegador
 * @param {number} input.elapsedMs       tempo desde que a página abriu
 */
export function isLibrarySyncPending({
  cloudEnabled = false,
  signedIn = false,
  email = "",
  billingStatus = "idle",
  entitlementActive = false,
  syncPhase = "off",
  firstSyncDone = false,
  elapsedMs = 0,
  maxMs = LIBRARY_HYDRATE_MAX_MS,
} = {}) {
  if (elapsedMs > maxMs) return false;
  if (!cloudEnabled || !signedIn || !String(email).includes("@")) return false;
  if (firstSyncDone) return false;
  // plano confirmado sem Pro/Team, ou billing sem resposta: não há sync para esperar
  if (billingStatus === "hidden") return false;
  if (billingStatus === "ready" && !entitlementActive) return false;
  if (["error", "offline", "inactive"].includes(syncPhase)) return false;
  return true;
}

/** Só troca a lista por "Sincronizando…" quando não há nada além dos exemplos para mostrar. */
export function shouldShowSyncingInLibrary(pending, projects) {
  return Boolean(pending) && (projects || []).every((project) => project?.stock);
}
