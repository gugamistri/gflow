/**
 * Fontes do tema do tour (lista curada, arquivos woff2 auto-hospedados em /fonts — sem Google Fonts em runtime, LGPD).
 * Puro, sem DOM. `theme.font` guarda o id; ausente/"default" = fonte padrão do player.
 */

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';

export const DEFAULT_THEME_FONT = "default";

export const THEME_FONTS = Object.freeze([
  { id: "default", label: "Padrão", family: "", stack: `Inter, ${SANS}`, files: [] },
  { id: "inter", label: "Inter", family: "Inter", stack: `Inter, ${SANS}`, files: [{ file: "inter-latin-wght-normal.woff2", weight: "100 900" }] },
  { id: "roboto", label: "Roboto", family: "Roboto", stack: `Roboto, ${SANS}`, files: [{ file: "roboto-latin-400-700.woff2", weight: "400 700" }] },
  { id: "open-sans", label: "Open Sans", family: "Open Sans", stack: `"Open Sans", ${SANS}`, files: [{ file: "open-sans-latin-400-700.woff2", weight: "400 700" }] },
  { id: "lato", label: "Lato", family: "Lato", stack: `Lato, ${SANS}`, files: [{ file: "lato-latin-400.woff2", weight: "400" }, { file: "lato-latin-700.woff2", weight: "700" }] },
  { id: "montserrat", label: "Montserrat", family: "Montserrat", stack: `Montserrat, ${SANS}`, files: [{ file: "montserrat-latin-400-700.woff2", weight: "400 700" }] },
  { id: "poppins", label: "Poppins", family: "Poppins", stack: `Poppins, ${SANS}`, files: [{ file: "poppins-latin-400.woff2", weight: "400" }, { file: "poppins-latin-600.woff2", weight: "600" }, { file: "poppins-latin-700.woff2", weight: "700" }] },
  { id: "nunito", label: "Nunito", family: "Nunito", stack: `Nunito, ${SANS}`, files: [{ file: "nunito-latin-400-700.woff2", weight: "400 700" }] },
  { id: "merriweather", label: "Merriweather", family: "Merriweather", stack: `Merriweather, ${SERIF}`, files: [{ file: "merriweather-latin-400-700.woff2", weight: "400 700" }] },
  { id: "source-serif", label: "Source Serif", family: "Source Serif 4", stack: `"Source Serif 4", ${SERIF}`, files: [{ file: "source-serif-4-latin-400-700.woff2", weight: "400 700" }] },
]);

export const THEME_FONT_IDS = THEME_FONTS.map((f) => f.id);

export function getThemeFont(id) {
  return THEME_FONTS.find((f) => f.id === id) || THEME_FONTS[0];
}

export function isThemeFontId(id) {
  return THEME_FONT_IDS.includes(String(id || ""));
}

/** CSS @font-face só da fonte escolhida. `base` = prefixo da URL dos arquivos (ex.: "/fonts/"). */
export function themeFontFaceCss(id, base = "/fonts/") {
  const font = getThemeFont(id);
  return font.files
    .map(
      (f) =>
        `@font-face{font-family:"${font.family}";font-style:normal;font-weight:${f.weight};font-display:swap;src:url("${base}${f.file}") format("woff2");}`
    )
    .join("\n");
}
