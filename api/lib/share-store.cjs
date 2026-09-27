/**
 * Leitura/escrita do meta e helpers HTTP do share.
 */
const { put, get, del, head } = require("@vercel/blob");
const {
  hashToken,
  tokensMatch,
  createShareIds,
  tourPathname,
  metaPathname,
  isShareId,
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
  revokeShare,
  hashToken,
  tokensMatch,
  createShareIds,
  tourPathname,
  metaPathname,
  isShareId,
};
