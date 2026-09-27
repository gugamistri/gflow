/**
 * GET /api/cron/expire-shares — varre o Blob e apaga tours com mais de 7 dias.
 * A Vercel chama este path uma vez por dia (Hobby) via vercel.json crons.
 */
const { timingSafeEqual } = require("node:crypto");
const {
  json,
  blobConfigured,
  purgeExpiredShares,
} = require("../lib/share-store.cjs");

function cronAuthorized(req) {
  const secret = process.env.CRON_SECRET || "";
  const header = req.headers?.authorization || "";
  // why: o path é público; só a Vercel, com CRON_SECRET, pode apagar em lote
  if (!secret || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    json(res, 405, { error: "method_not_allowed" });
    return;
  }
  if (!cronAuthorized(req)) {
    json(res, 401, { error: "unauthorized" });
    return;
  }
  if (!blobConfigured()) {
    json(res, 503, { error: "blob_not_configured" });
    return;
  }
  try {
    const removed = await purgeExpiredShares();
    json(res, 200, { ok: true, removed: removed.length });
  } catch (err) {
    console.error("expire shares", err);
    json(res, 500, { error: "expire_failed", message: err?.message || String(err) });
  }
};
