/**
 * GET /oembed?url=https://guiaflow.pro/p/SLUG — oEmbed 1.0 (type "rich") dos links permanentes.
 * why: Notion, Medium (via Iframely), WordPress e Slack transformam o link colado em player.
 * Só /p (permanente, Pro); /v expira em 7 dias e não é incorporável.
 */
const { fetchPermanentShare } = require("./lib/permanent-share.cjs");
const { buildEmbedSnippet, ratioValue, DEFAULT_EMBED_RATIO } = require("./lib/embed-snippet.cjs");

const PUBLIC_ORIGIN = "https://guiaflow.pro";
const PUBLIC_HOSTS = new Set(["guiaflow.pro", "www.guiaflow.pro"]);
// mesmo formato que o Cloud aceita
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DEFAULT_WIDTH = 800;
const MAX_WIDTH = 1200;
const MIN_HEIGHT = 420;

function requestHost(req) {
  return String(req.headers?.["x-forwarded-host"] || req.headers?.host || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
}

/** Slug do /p numa URL do GuiaFlow (ou do próprio host, em preview/dev); "" se não for /p. */
function permanentSlugFromUrl(raw, host = "") {
  let url;
  try {
    url = new URL(String(raw || "").trim());
  } catch {
    return "";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "";
  const h = url.hostname.toLowerCase();
  const sameHost = host && url.host.toLowerCase() === host;
  if (!PUBLIC_HOSTS.has(h) && !sameHost) return "";
  const m = /^\/p\/([^/]+)\/?$/.exec(url.pathname);
  if (!m) return "";
  let slug;
  try {
    slug = decodeURIComponent(m[1]).toLowerCase();
  } catch {
    return "";
  }
  return slug.length <= 80 && SLUG_RE.test(slug) ? slug : "";
}

function positive(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Largura/altura respeitando maxwidth/maxheight e a altura mínima do snippet. */
function oembedSize(ratio, maxwidth, maxheight) {
  const r = ratioValue(ratio);
  let width = Math.min(positive(maxwidth) || DEFAULT_WIDTH, MAX_WIDTH);
  let height = Math.max(MIN_HEIGHT, Math.round(width / r));
  const maxH = positive(maxheight);
  if (maxH && height > maxH) {
    height = maxH;
    width = Math.min(width, Math.round(height * r));
  }
  return { width, height };
}

function send(res, req, status, body, cache) {
  res.statusCode = status;
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", cache || "public, s-maxage=60");
  if (typeof body === "object") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    body = JSON.stringify(body);
  } else {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
  }
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  res.end(body);
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.end();
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD, OPTIONS");
    send(res, req, 405, "method_not_allowed");
    return;
  }
  const q = req.query || {};
  const format = String(q.format || "json").toLowerCase();
  if (format !== "json") {
    send(res, req, 501, "not_implemented");
    return;
  }
  const slug = permanentSlugFromUrl(q.url, requestHost(req));
  if (!slug) {
    send(res, req, 404, { error: "not_found" });
    return;
  }
  const share = await fetchPermanentShare(slug);
  if (share.missing) {
    send(res, req, 404, { error: "not_found" });
    return;
  }
  if (share.failed) {
    send(res, req, 502, { error: "unavailable" }, "no-store");
    return;
  }
  const pageUrl = `${PUBLIC_ORIGIN}/p/${slug}`;
  const ratio = share.ratio || DEFAULT_EMBED_RATIO;
  const title = share.name || "Tour GuiaFlow";
  const { width, height } = oembedSize(ratio, q.maxwidth, q.maxheight);
  const thumb = share.image
    ? { url: share.image, width: share.imageWidth || 1200, height: share.imageHeight || 630 }
    : { url: `${PUBLIC_ORIGIN}/brand/og-image.png`, width: 1200, height: 630 };
  send(
    res,
    req,
    200,
    {
      version: "1.0",
      type: "rich",
      provider_name: "GuiaFlow",
      provider_url: `${PUBLIC_ORIGIN}/`,
      title,
      html: buildEmbedSnippet({ url: pageUrl, title, ratio }),
      width,
      height,
      thumbnail_url: thumb.url,
      thumbnail_width: thumb.width,
      thumbnail_height: thumb.height,
      cache_age: 300,
    },
    "public, s-maxage=300, stale-while-revalidate=600"
  );
};

module.exports.permanentSlugFromUrl = permanentSlugFromUrl;
module.exports.oembedSize = oembedSize;
