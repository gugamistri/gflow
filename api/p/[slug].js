/**
 * GET /api/p/:slug — o mesmo player de /v, com og:title do link permanente.
 * why: o tour vem de GET app.guiaflow.pro/api/shares/:slug no browser; aqui só a meta.
 */
const { renderViewPage } = require("../lib/view-shell.cjs");
const { fetchPermanentShare, isPermanentSlug } = require("../lib/permanent-share.cjs");

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

  const slug = req.query?.slug;
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

  if (!isPermanentSlug(slug)) {
    sendHtml(renderViewPage({ id: null, name: null, origin, missing: true, kind: "permanent" }), 404);
    return;
  }

  const share = await fetchPermanentShare(slug);
  if (share.missing) {
    sendHtml(renderViewPage({ id: slug, name: null, origin, missing: true, kind: "permanent" }), 404);
    return;
  }
  sendHtml(
    renderViewPage({ id: slug, name: share.name, origin, missing: false, kind: "permanent" }),
    200
  );
};
