/**
 * Snippet de incorporação para o /oembed (CJS, roda na função da Vercel).
 * why: o editor usa js/embedSnippet.js (ESM, sem bundler); os dois têm de gerar o mesmo HTML.
 * Teste de paridade em js/embedSnippet.test.js.
 */
const DEFAULT_EMBED_RATIO = "16/9";
const EMBED_FLAVORS = ["html", "wordpress", "webflow"];

function escapeAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function embedPlayerUrl(url, { autoplay = false } = {}) {
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

function normalizeEmbedFlavor(flavor) {
  const key = String(flavor || "").trim().toLowerCase();
  return EMBED_FLAVORS.includes(key) ? key : "html";
}

function buildEmbedSnippet({ url, title = "", ratio = DEFAULT_EMBED_RATIO, autoplay = false, flavor = "html", label = "Tour interativo" } = {}) {
  const src = embedPlayerUrl(url, { autoplay });
  if (!src) return "";
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
  if (normalizeEmbedFlavor(flavor) === "wordpress") {
    return `<!-- wp:html -->\n${html}\n<!-- /wp:html -->`;
  }
  return html;
}

/** "16/10" → 1.6; inválida → 16/9. */
function ratioValue(ratio) {
  const m = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(String(ratio || ""));
  const r = m ? Number(m[1]) / Number(m[2]) : NaN;
  return Number.isFinite(r) && r > 0 ? r : 16 / 9;
}

module.exports = {
  DEFAULT_EMBED_RATIO,
  EMBED_FLAVORS,
  buildEmbedSnippet,
  embedPlayerUrl,
  normalizeEmbedFlavor,
  ratioValue,
};
