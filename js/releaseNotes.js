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

/**
 * Itens de novidade: fonte única do pop-up do editor (itens com `editor` = versão do editor) e do bloco
 * "Novidades" da extensão (itens com `ext` = versão da extensão que traz o selo NOVO).
 * Texto em i18n `releaseNotes.<key>`, no formato "Título: descrição" (a extensão separa no primeiro ": ").
 * `help` = âncora da página de ajuda (/ajuda, /en/help, /es/ayuda). Sem rede: tudo vai dentro do pacote.
 */
export const RELEASE_NOTE_TAGS = Object.freeze(["new", "feature", "fix"]);

export const RELEASE_NOTE_ENTRIES = Object.freeze([
  { key: "extensionNews", tag: "new", date: "2026-11-01", icon: "bell", help: "gravar", editor: null, ext: "0.3.0" },
  { key: "stepVideo", tag: "feature", date: "2026-10-30", icon: "video", help: "editor", editor: "0.5.0", ext: "0.3.0" },
  { key: "narrationCaption", tag: "fix", date: "2026-10-30", icon: "caption", help: "editor", editor: "0.5.0", ext: "0.3.0" },
  { key: "slideTitle", tag: "fix", date: "2026-10-30", icon: "slide", help: "editor", editor: "0.5.0", ext: "0.3.0" },
  { key: "richText", tag: "feature", date: "2026-10-30", icon: "text", help: "editor", editor: "0.5.0", ext: "0.3.0" },
  { key: "gallery", tag: "new", date: "2026-10-30", icon: "gallery", help: "editor", editor: "0.5.0", ext: "0.3.0" },
].map((e) => Object.freeze(e)));

/** Itens do pop-up do editor para a versão (na ordem do arquivo). */
export function editorReleaseNotes(version = RELEASE_NOTES_VERSION, entries = RELEASE_NOTE_ENTRIES) {
  return entries.filter((e) => e.editor === version);
}

const TAG_RANK = { new: 0, feature: 1, fix: 2 };

/** Ordem do bloco da extensão: mais novo primeiro; no mesmo dia, NOVO → RECURSO → CORREÇÃO. */
export function sortReleaseNotes(entries = RELEASE_NOTE_ENTRIES) {
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (a.e.date < b.e.date ? 1 : a.e.date > b.e.date ? -1 : 0) || (TAG_RANK[a.e.tag] ?? 9) - (TAG_RANK[b.e.tag] ?? 9) || a.i - b.i)
    .map(({ e }) => e);
}

/** "Título: descrição" → { title, desc }. Sem ": ", tudo vira título. */
export function splitReleaseNote(text) {
  const s = String(text ?? "");
  const at = s.indexOf(": ");
  if (at <= 0) return { title: s, desc: "" };
  return { title: s.slice(0, at), desc: s.slice(at + 2) };
}

const HELP_PATHS = { pt: "/ajuda", en: "/en/help", es: "/es/ayuda" };

/** Link da ajuda no idioma (sempre guiaflow.pro, sem parâmetros de rastreio). */
export function releaseNoteHelpUrl(locale, anchor) {
  const path = HELP_PATHS[locale] || HELP_PATHS.en;
  return `https://guiaflow.pro${path}${anchor ? `#${encodeURIComponent(anchor)}` : ""}`;
}

/** Data curta no idioma: "1 de nov. de 2026", "Nov 1, 2026". */
export function releaseNoteDate(locale = "pt", iso) {
  const date = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
  const tag = locale === "pt" ? "pt-BR" : locale === "es" ? "es" : "en";
  return new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}
