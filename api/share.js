/**
 * POST /api/share — cria link ou emite token de upload (atualização).
 */
const {
  json,
  readJsonBody,
  blobConfigured,
  writeMeta,
  issueUploadToken,
  releaseShareIfExpired,
  hashToken,
  tokensMatch,
  createShareIds,
  isShareId,
} = require("./lib/share-store.cjs");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== "POST") {
    json(res, 405, { error: "method_not_allowed" });
    return;
  }
  if (!blobConfigured()) {
    json(res, 503, { error: "blob_not_configured" });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    json(res, 400, { error: "invalid_json" });
    return;
  }

  const existingId = body?.id;
  const writeToken = body?.writeToken;

  try {
    if (existingId || writeToken) {
      if (!isShareId(existingId) || !writeToken) {
        json(res, 400, { error: "invalid_credentials" });
        return;
      }
      const gate = await releaseShareIfExpired(existingId);
      if (gate.expired) {
        json(res, 404, { error: "expired" });
        return;
      }
      const meta = gate.meta;
      if (!meta || !tokensMatch(writeToken, meta.tokenHash)) {
        json(res, 403, { error: "forbidden" });
        return;
      }
      const upload = await issueUploadToken(existingId);
      json(res, 200, {
        id: existingId,
        pathname: upload.pathname,
        clientToken: upload.clientToken,
      });
      return;
    }

    const { id, writeToken: newWriteToken } = createShareIds();
    await writeMeta(id, {
      tokenHash: hashToken(newWriteToken),
      createdAt: Date.now(),
    });
    const upload = await issueUploadToken(id);
    json(res, 200, {
      id,
      writeToken: newWriteToken,
      pathname: upload.pathname,
      clientToken: upload.clientToken,
    });
  } catch (err) {
    console.error("share POST", err);
    json(res, 500, { error: "share_failed", message: err?.message || String(err) });
  }
};
