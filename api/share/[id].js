/**
 * GET/DELETE /api/share/:id
 */
const {
  json,
  readJsonBody,
  blobConfigured,
  readMeta,
  writeMeta,
  resolveTourUrl,
  revokeShare,
  tokensMatch,
  isShareId,
} = require("../lib/share-store.cjs");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const id = req.query?.id;
  if (!isShareId(id)) {
    json(res, 400, { error: "invalid_id" });
    return;
  }

  if (!blobConfigured()) {
    json(res, 503, { error: "blob_not_configured" });
    return;
  }

  try {
    if (req.method === "GET") {
      const url = await resolveTourUrl(id);
      if (!url) {
        json(res, 404, { error: "not_found" });
        return;
      }
      json(res, 200, { id, url });
      return;
    }

    if (req.method === "DELETE") {
      let body = {};
      try {
        body = await readJsonBody(req);
      } catch {
        json(res, 400, { error: "invalid_json" });
        return;
      }
      const writeToken = body?.writeToken || req.headers["x-share-write-token"];
      const meta = await readMeta(id);
      if (!meta || !tokensMatch(writeToken, meta.tokenHash)) {
        json(res, 403, { error: "forbidden" });
        return;
      }
      await revokeShare(id);
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === "PATCH") {
      // why: grava a URL pública no meta após o PUT do cliente (head às vezes atrasa)
      let body = {};
      try {
        body = await readJsonBody(req);
      } catch {
        json(res, 400, { error: "invalid_json" });
        return;
      }
      const writeToken = body?.writeToken;
      const url = body?.url;
      if (!writeToken || typeof url !== "string" || !url.startsWith("https://")) {
        json(res, 400, { error: "invalid_body" });
        return;
      }
      const meta = await readMeta(id);
      if (!meta || !tokensMatch(writeToken, meta.tokenHash)) {
        json(res, 403, { error: "forbidden" });
        return;
      }
      await writeMeta(id, { ...meta, url, updatedAt: Date.now() });
      json(res, 200, { ok: true, url });
      return;
    }

    json(res, 405, { error: "method_not_allowed" });
  } catch (err) {
    console.error("share id", err);
    json(res, 500, { error: "share_failed", message: err?.message || String(err) });
  }
};
