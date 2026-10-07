/**
 * GET /api/v/:id — página do tour com og:title = nome (para crawlers).
 */
const {
  blobConfigured,
  readMeta,
  resolveTourUrl,
  releaseShareIfExpired,
  isShareId,
} = require("../lib/share-store.cjs");
const { renderViewPage } = require("../lib/view-shell.cjs");

function requestOrigin(req) {
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "guiaflow.pro")
    .split(",")[0]
    .trim();
  return `${proto}://${host}`;
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, HEAD");
    res.end("method_not_allowed");
    return;
  }

  const id = req.query?.id;
  const origin = requestOrigin(req);

  function sendHtml(html, status = 200) {
    res.statusCode = status;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    res.end(html);
  }

  if (!isShareId(id)) {
    sendHtml(renderViewPage({ id: null, name: null, origin, missing: true }), 404);
    return;
  }

  if (!blobConfigured()) {
    sendHtml(renderViewPage({ id, name: null, origin, missing: true }), 503);
    return;
  }

  try {
    const gate = await releaseShareIfExpired(id);
    if (gate.expired) {
      sendHtml(renderViewPage({ id, name: null, origin, missing: true }), 404);
      return;
    }
    const url = await resolveTourUrl(id);
    const meta = gate.meta || (await readMeta(id));
    if (!url) {
      sendHtml(renderViewPage({ id, name: null, origin, missing: true }), 404);
      return;
    }
    const name = typeof meta?.name === "string" && meta.name.trim() ? meta.name.trim() : null;
    sendHtml(renderViewPage({ id, name, origin, missing: false }), 200);
  } catch (err) {
    console.error("view page", err);
    sendHtml(renderViewPage({ id, name: null, origin, missing: true }), 500);
  }
};
