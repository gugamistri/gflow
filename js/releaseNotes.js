/**
 * Aviso de novidades na home: some ao dispensar e só volta em versão nova.
 * why: a versão espelha package.json; o browser não importa o JSON do app.
 *      0.3.1 traz os menus sem itens repetidos e o aviso de que as integrações mudaram de lugar (GUI-32).
 *      0.4.0 fecha a Fase 1: menus, Configurações com abas, Clientes/marcas, Captura · Compartilhar · Resultados
 *      e o contexto de captura nos Contatos (GUI-25 a GUI-33). Minor porque muda onde as coisas ficam.
 *      0.5.0 (30/10): vídeo nos passos, legenda da narração, slides sem "CENA X", texto com formatação e modo Galeria.
 */
export const RELEASE_NOTES_VERSION = "0.5.0";
export const RELEASE_NOTES_DATE = "2026-10-30";
export const RELEASE_NOTES_DISMISS_KEY = "ns-release-notes-dismissed";

/** Mês e ano da versão, no idioma da interface. */
export function releaseNotesMonth(locale = "pt", iso = RELEASE_NOTES_DATE) {
  const date = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
  const tag = locale === "pt" ? "pt-BR" : locale === "es" ? "es" : "en";
  const month = new Intl.DateTimeFormat(tag, { month: "long", timeZone: "UTC" }).format(date);
  const year = new Intl.DateTimeFormat(tag, { year: "numeric", timeZone: "UTC" }).format(date);
  if (locale === "en") return `${month} ${year}`;
  return `${month} de ${year}`;
}

/**
 * @param {{ dismissedVersion?: string | null, currentVersion?: string | null }} [opts]
 */
export function shouldShowReleaseNotes({ dismissedVersion, currentVersion } = {}) {
  const current = String(currentVersion ?? "").trim();
  if (!current) return false;
  return String(dismissedVersion ?? "").trim() !== current;
}
