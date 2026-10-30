/**
 * Texto do autor dentro de APIs que só aceitam HTML (ex.: driver.js monta título e texto do balão com innerHTML).
 * why: título e descrição iam crus para o balão — qualquer marcação no texto virava HTML no /p, /v, embed e preview.
 * Puro (sem DOM). O player autônomo (HTML offline) tem uma cópia inline em standalonePlayer.js.
 */
import { richTextHtml } from "./tour-schema/richText.js";

/** Escapa & < > " ' — o resultado mostra o texto exatamente como foi digitado. */
export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Título do balão: texto puro (quebra de linha some, como antes no HTML). */
export function popoverTitleHtml(text) {
  return escapeHtml(text);
}

/**
 * Texto do balão: formatação leve (**negrito**, *itálico*, ++sublinhado++, "- " lista) montada em
 * tags fixas; todo texto do autor sai escapado. Sem marcador fica igual ao antigo `\n → <br/>`.
 */
export function popoverBodyHtml(text) {
  return richTextHtml(text);
}

const COLOR_RE =
  /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla)\(\s*[-0-9.%\s,/deg]+\)|[a-z]{3,20})$/i;

/** Cor do tema dentro de `style="..."`: só formatos de cor; o resto vira vazio (não fecha o atributo). */
export function safeCssColor(value) {
  const v = String(value ?? "").trim();
  return COLOR_RE.test(v) ? v : "";
}
