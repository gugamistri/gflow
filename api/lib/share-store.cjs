/**
 * Leitura/escrita do meta e helpers HTTP do share.
 */
const { put, get, del, head, list } = require("@vercel/blob");
const {
  hashToken,
  tokensMatch,
  createShareIds,
  tourPathname,
  metaPathname,
  isShareId,
  isShareExpired,
  shareIdFromPathname,
  SHARE_PREFIX,
  MAX_SHARE_BYTES,
} = require("./share-crypto.cjs");

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function blobConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

async function readMeta(id) {
  // why: store é público; o meta só tem hash SHA-256 do writeToken (não dá para inverter)
  const result = await get(metaPathname(id), { access: "public", useCache: false });
  if (!result?.stream) return null;
  const text = await new Response(result.stream).text();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function writeMeta(id, meta) {
  await put(metaPathname(id), JSON.stringify(meta), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

async function issueUploadToken(id) {
  const { generateClientTokenFromReadWriteToken } = require("@vercel/blob/client");
  const pathname = tourPathname(id);
  const clientToken = await generateClientTokenFromReadWriteToken({
    pathname,
    maximumSizeInBytes: MAX_SHARE_BYTES,
    allowedContentTypes: ["application/json", "text/plain"],
    addRandomSuffix: false,
    allowOverwrite: true,
    validUntil: Date.now() + 60 * 60 * 1000,
  });
  return { pathname, clientToken };
}

async function resolveTourUrl(id) {
  const pathname = tourPathname(id);
  try {
    const meta = await head(pathname);
    if (meta?.url) return meta.url;
  } catch {
    /* fall through */
  }
  const stored = await readMeta(id);
  if (stored?.url) return stored.url;
  return null;
}

function blobUploadedAtMs(value) {
  if (value instanceof Date) return value.getTime();
  const parsed = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function groupShareBlobs(blobs) {
  const byId = new Map();
  for (const blob of blobs || []) {
    const parsed = shareIdFromPathname(blob?.pathname);
    if (!parsed) continue;
    let row = byId.get(parsed.id);
    if (!row) {
      row = { id: parsed.id };
      byId.set(parsed.id, row);
    }
    const uploadedAt = blobUploadedAtMs(blob.uploadedAt);
    if (parsed.kind === "meta") row.metaUploadedAt = uploadedAt;
    else row.tourUploadedAt = uploadedAt;
  }
  return [...byId.values()];
}

async function releaseShareIfExpired(id, now = Date.now()) {
  const meta = await readMeta(id);
  if (!meta || !isShareExpired(meta.createdAt, now)) return { expired: false, meta };
  try {
    await revokeShare(id);
  } catch (err) {
    console.error("expire share", id, err);
  }
  return { expired: true, meta: null };
}

async function listShareBlobs() {
  const blobs = [];
  let cursor;
  do {
    const page = await list({ prefix: `${SHARE_PREFIX}/`, limit: 1000, cursor });
    if (Array.isArray(page?.blobs)) blobs.push(...page.blobs);
    cursor = page?.hasMore ? page.cursor : undefined;
  } while (cursor);
  return blobs;
}

async function purgeExpiredShares(now = Date.now()) {
  const rows = groupShareBlobs(await listShareBlobs());
  const removed = [];
  for (const row of rows) {
    let published = null;
    if (Number.isFinite(row.metaUploadedAt)) {
      let meta = null;
      try {
        meta = await readMeta(row.id);
      } catch (err) {
        console.error("purge read", row.id, err);
        continue;
      }
      const created = Number(meta?.createdAt);
      // why: o uploadedAt do meta muda no PATCH; o prazo conta de createdAt
      published = Number.isFinite(created) && created > 0 ? created : row.metaUploadedAt;
    } else {
      published = row.tourUploadedAt;
    }
    if (!isShareExpired(published, now)) continue;
    try {
      await revokeShare(row.id);
      removed.push(row.id);
    } catch (err) {
      console.error("purge share", row.id, err);
    }
  }
  return removed;
}

async function revokeShare(id) {
  const pathname = tourPathname(id);
  const meta = metaPathname(id);
  let tourUrl = null;
  try {
    const h = await head(pathname);
    tourUrl = h?.url || null;
  } catch {
    /* missing tour ok */
  }
  const urls = [];
  if (tourUrl) urls.push(tourUrl);
  try {
    const m = await get(meta, { access: "public", useCache: false });
    if (m?.blob?.url) urls.push(m.blob.url);
  } catch {
    /* missing meta ok */
  }
  // why: del aceita pathname ou URL; pathname cobre o caso sem head
  await del([pathname, meta, ...urls].filter(Boolean));
}

module.exports = {
  json,
  readJsonBody,
  blobConfigured,
  readMeta,
  writeMeta,
  issueUploadToken,
  resolveTourUrl,
  releaseShareIfExpired,
  purgeExpiredShares,
  revokeShare,
  hashToken,
  tokensMatch,
  createShareIds,
  tourPathname,
  metaPathname,
  isShareId,
};
