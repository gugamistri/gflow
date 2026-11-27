/**
 * Aviso de novidades na home: some ao dispensar e só volta em versão nova.
 * why: a versão espelha package.json; o browser não importa o JSON do app.
 *      0.3.1 traz os menus sem itens repetidos e o aviso de que as integrações mudaram de lugar (GUI-32).
 *      0.4.0 fecha a Fase 1: menus, Configurações com abas, Clientes/marcas, Captura · Compartilhar · Resultados
 *      e o contexto de captura nos Contatos (GUI-25 a GUI-33). Minor porque muda onde as coisas ficam.
 *      0.5.0 (30/10): vídeo nos passos, legenda da narração, slides sem "CENA X", texto com formatação e modo Galeria.
 *      0.6.0 (9/11): Criar com ajuda (grátis), Criar com meu agente de IA e Mostrar balão por passo.
 *      0.7.0 (20/11): Desfocar área, Enquadrar, tela acesa no celular e troca de plano (Pro↔Team, mensal↔anual).
 *      0.8.0 (27/11): primeiros passos, tela de projetos, Caminhos, Ampliar destaque e novidades atualizadas na extensão.
 */
export const RELEASE_NOTES_VERSION = "0.8.0";
export const RELEASE_NOTES_DATE = "2026-11-27";
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
 * "Novidades" da extensão (itens com `editor` ou `ext`).
 * Texto em i18n `releaseNotes.<key>`, no formato "Título: descrição" (a extensão separa no primeiro ": ").
 * `help` = âncora da página de ajuda (/ajuda, /en/help, /es/ayuda).
 * `ext` = versão da extensão que acende o selo NOVO numa atualização da loja.
 * O site publica o mesmo conteúdo em /release-notes.json; a extensão lê esse arquivo (cópia no pacote se faltar rede).
 */
export const RELEASE_NOTE_TAGS = Object.freeze(["new", "feature", "fix"]);

export const RELEASE_NOTE_ENTRIES = Object.freeze([
  { key: "onboarding", tag: "new", date: "2026-11-27", icon: "text", help: "editor", editor: "0.8.0", ext: null },
  { key: "projectsFirst", tag: "new", date: "2026-11-27", icon: "gallery", help: "editor", editor: "0.8.0", ext: null },
  { key: "paths", tag: "new", date: "2026-11-27", icon: "slide", help: "editor", editor: "0.8.0", ext: null },
  { key: "zoomHighlight", tag: "feature", date: "2026-11-27", icon: "video", help: "editor", editor: "0.8.0", ext: null },
  { key: "extNewsFeed", tag: "feature", date: "2026-11-27", icon: "bell", help: "gravar", editor: "0.8.0", ext: null },
  { key: "areaBlur", tag: "new", date: "2026-11-19", icon: "gallery", help: "editor", editor: "0.7.0", ext: null },
  { key: "crop", tag: "new", date: "2026-11-19", icon: "slide", help: "editor", editor: "0.7.0", ext: null },
  { key: "wakeLock", tag: "feature", date: "2026-11-19", icon: "video", help: "incorporar", editor: "0.7.0", ext: null },
  { key: "planSwitch", tag: "feature", date: "2026-11-20", icon: "bell", help: "editor", editor: "0.7.0", ext: null },
  { key: "createHelp", tag: "new", date: "2026-11-09", icon: "text", help: "editor", editor: "0.6.0", ext: null },
  { key: "agentConnect", tag: "new", date: "2026-11-09", icon: "bell", help: "editor", editor: "0.6.0", ext: null },
  { key: "showBalloon", tag: "feature", date: "2026-11-09", icon: "caption", help: "editor", editor: "0.6.0", ext: null },
  { key: "extensionNews", tag: "new", date: "2026-11-01", icon: "bell", help: "gravar", editor: null, ext: "0.3.0" },
  { key: "stepVideo", tag: "feature", date: "2026-10-30", icon: "video", help: "editor", editor: "0.5.0", ext: "0.3.0" },
  { key: "narrationCaption", tag: "fix", date: "2026-10-30", icon: "caption", help: "editor", editor: "0.5.0", ext: "0.3.0" },
  { key: "slideTitle", tag: "fix", date: "2026-10-30", icon: "slide", help: "editor", editor: "0.5.0", ext: "0.3.0" },
  { key: "richText", tag: "feature", date: "2026-10-30", icon: "text", help: "editor", editor: "0.5.0", ext: "0.3.0" },
  { key: "gallery", tag: "new", date: "2026-10-30", icon: "gallery", help: "editor", editor: "0.5.0", ext: "0.3.0" },
].map((e) => Object.freeze(e)));


export const RELEASE_NOTES_FEED_PATH = "/release-notes.json";
const FEED_VERSION_RE = /^\d+\.\d+\.\d+$/;
const FEED_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FEED_KEY_RE = /^[a-zA-Z]+$/;
const FEED_HELP_RE = /^[a-z]+$/;
const FEED_ICONS = new Set(["bell", "video", "caption", "slide", "text", "gallery"]);
const FEED_LOCALES = ["pt", "en", "es"];
const FEED_TEXT_MAX = 500;
const FEED_ENTRIES_MAX = 50;

/** URL de /release-notes.json numa origem http(s); fora disso, cai em guiaflow.pro. */
export function releaseNotesFeedUrl(origin = "https://guiaflow.pro") {
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return `https://guiaflow.pro${RELEASE_NOTES_FEED_PATH}`;
    return `${url.origin}${RELEASE_NOTES_FEED_PATH}`;
  } catch {
    return `https://guiaflow.pro${RELEASE_NOTES_FEED_PATH}`;
  }
}

/**
 * Valida o JSON público. Qualquer campo estranho ou texto vazio invalida o feed inteiro
 * (a extensão então usa a cópia do pacote).
 */
export function parseReleaseNotesFeed(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const version = String(data.version ?? "").trim();
  const date = String(data.date ?? "").trim();
  if (!FEED_VERSION_RE.test(version) || !FEED_DATE_RE.test(date)) return null;
  if (!Array.isArray(data.entries) || data.entries.length === 0 || data.entries.length > FEED_ENTRIES_MAX) return null;
  const entries = [];
  const seen = new Set();
  for (const raw of data.entries) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const key = String(raw.key ?? "");
    const tag = String(raw.tag ?? "");
    const entryDate = String(raw.date ?? "");
    if (!FEED_KEY_RE.test(key) || seen.has(key) || !RELEASE_NOTE_TAGS.includes(tag) || !FEED_DATE_RE.test(entryDate)) return null;
    seen.add(key);
    const help = raw.help == null || raw.help === "" ? null : String(raw.help);
    if (help && !FEED_HELP_RE.test(help)) return null;
    const icon = FEED_ICONS.has(raw.icon) ? raw.icon : "bell";
    const editor = raw.editor == null || raw.editor === "" ? null : String(raw.editor);
    const ext = raw.ext == null || raw.ext === "" ? null : String(raw.ext);
    if (editor && !FEED_VERSION_RE.test(editor)) return null;
    if (ext && !FEED_VERSION_RE.test(ext)) return null;
    if (!editor && !ext) return null;
    const src = raw.text && typeof raw.text === "object" && !Array.isArray(raw.text) ? raw.text : {};
    const text = {};
    for (const loc of FEED_LOCALES) {
      const s = String(src[loc] ?? "").trim();
      if (!s || s.length > FEED_TEXT_MAX) return null;
      text[loc] = s;
    }
    entries.push(Object.freeze({ key, tag, date: entryDate, icon, help, editor, ext, text: Object.freeze(text) }));
  }
  return Object.freeze({ version, date, entries: Object.freeze(entries) });
}

/** Monta o feed a partir dos itens e dos catálogos i18n (pt/en/es). */
export function buildReleaseNotesFeed(texts, entries = RELEASE_NOTE_ENTRIES, version = RELEASE_NOTES_VERSION, date = RELEASE_NOTES_DATE) {
  return parseReleaseNotesFeed({
    version,
    date,
    entries: entries.map((e) => ({
      key: e.key,
      tag: e.tag,
      date: e.date,
      icon: e.icon,
      help: e.help,
      editor: e.editor,
      ext: e.ext,
      text: {
        pt: texts?.pt?.[`releaseNotes.${e.key}`] ?? "",
        en: texts?.en?.[`releaseNotes.${e.key}`] ?? "",
        es: texts?.es?.[`releaseNotes.${e.key}`] ?? "",
      },
    })),
  });
}

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
