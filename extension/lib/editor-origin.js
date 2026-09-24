/**
 * Normaliza a URL do editor e vira match pattern do Chromium.
 */

export function normalizeEditorOrigin(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  let url;
  try {
    url = new URL(text.includes("://") ? text : `http://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.origin;
}

/** Ex.: http://localhost:4173 → http://localhost:4173/* */
export function originToMatchPattern(origin) {
  const normalized = normalizeEditorOrigin(origin);
  if (!normalized) return null;
  return `${normalized}/*`;
}

export function tabMatchesOrigin(tabUrl, origin) {
  const expected = normalizeEditorOrigin(origin);
  if (!expected || !tabUrl) return false;
  try {
    return new URL(tabUrl).origin === expected;
  } catch {
    return false;
  }
}

export const DEFAULT_EDITOR_ORIGIN = "https://guiaflow-seven.vercel.app";
