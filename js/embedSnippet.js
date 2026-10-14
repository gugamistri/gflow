/**
 * Código para incorporar o tour publicado (link permanente) num site.
 * why: puro e testável; o diálogo "Incorporar no site" e, no futuro, o /oembed usam o mesmo HTML.
 */

export const EMBED_FLAVORS = ["html", "wordpress", "webflow", "notion", "medium"];
/** Plataformas que incorporam pelo link (oEmbed/Iframely), não por código HTML. */
export const LINK_EMBED_FLAVORS = ["notion", "medium"];

export function isLinkEmbedFlavor(flavor) {
  return LINK_EMBED_FLAVORS.includes(normalizeEmbedFlavor(flavor));
}
export const DEFAULT_EMBED_RATIO = "16/9";

function escapeAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x || 1;
}

/**
 * Proporção "L/A" a partir do tamanho da 1ª captura. Fora de 1:3…3:1, ou sem medida, 16/9.
 */
export function embedRatio(width, height) {
  const w = Math.round(Number(width));
  const h = Math.round(Number(height));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return DEFAULT_EMBED_RATIO;
  const r = w / h;
  if (r < 1 / 3 || r > 3) return DEFAULT_EMBED_RATIO;
  const d = gcd(w, h);
  const rw = w / d;
  const rh = h / d;
  // why: 1366×768 vira 683/384; a CSS aceita, mas números curtos são mais legíveis
  if (rw > 64 || rh > 64) {
    const scaled = Math.round(r * 100) / 100;
    return `${scaled}/1`;
  }
  return `${rw}/${rh}`;
}

/** URL do player no modo incorporado: mantém a query existente e liga embed (e autoplay). */
export function embedPlayerUrl(url, { autoplay = false } = {}) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return "";
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
  parsed.searchParams.delete("embed");
  parsed.searchParams.delete("autoplay");
  parsed.searchParams.set("embed", "1");
  if (autoplay) parsed.searchParams.set("autoplay", "1");
  parsed.hash = "";
  return parsed.toString();
}

export function normalizeEmbedFlavor(flavor) {
  const key = String(flavor || "").trim().toLowerCase();
  return EMBED_FLAVORS.includes(key) ? key : "html";
}

/**
 * Snippet responsivo: caixa com aspect-ratio + iframe absoluto.
 * min-height evita um tour minúsculo em colunas estreitas (celular).
 */
export function buildEmbedSnippet({ url, title = "", ratio = DEFAULT_EMBED_RATIO, autoplay = false, flavor = "html", label = "Tour interativo" } = {}) {
  const src = embedPlayerUrl(url, { autoplay });
  if (!src) return "";
  // why: Notion/Medium não aceitam iframe colado; usam o link /p puro e descobrem o player via oEmbed
  if (isLinkEmbedFlavor(flavor)) {
    const link = new URL(src);
    link.search = "";
    return link.toString();
  }
  const safeRatio = /^\d+(\.\d+)?\/\d+(\.\d+)?$/.test(String(ratio || "")) ? String(ratio) : DEFAULT_EMBED_RATIO;
  const name = String(title || "").trim().slice(0, 200);
  const frameTitle = name ? `${label}: ${name}` : label;
  const html = [
    `<div style="position:relative;width:100%;aspect-ratio:${safeRatio};min-height:420px;max-width:1200px;margin:0 auto">`,
    `  <iframe src="${escapeAttr(src)}" title="${escapeAttr(frameTitle)}"`,
    `    loading="lazy" allow="autoplay; fullscreen; clipboard-write" allowfullscreen`,
    `    style="position:absolute;inset:0;width:100%;height:100%;border:0;border-radius:12px"></iframe>`,
    `</div>`,
  ].join("\n");
  // why: colado no editor de código do WordPress, o comentário vira um bloco "HTML personalizado"
  if (normalizeEmbedFlavor(flavor) === "wordpress") {
    return `<!-- wp:html -->\n${html}\n<!-- /wp:html -->`;
  }
  return html;
}
