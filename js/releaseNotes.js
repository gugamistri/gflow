/**
 * Aviso de novidades na home: some ao dispensar e só volta em versão nova.
 * why: a versão espelha package.json; o browser não importa o JSON do app.
 */
export const RELEASE_NOTES_VERSION = "0.2.1";
export const RELEASE_NOTES_DISMISS_KEY = "ns-release-notes-dismissed";

/**
 * @param {{ dismissedVersion?: string | null, currentVersion?: string | null }} [opts]
 */
export function shouldShowReleaseNotes({ dismissedVersion, currentVersion } = {}) {
  const current = String(currentVersion ?? "").trim();
  if (!current) return false;
  return String(dismissedVersion ?? "").trim() !== current;
}
