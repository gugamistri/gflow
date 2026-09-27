/**
 * Tokens e paths do link de preview (API + testes).
 */
const { createHash, randomBytes, timingSafeEqual } = require("node:crypto");

const SHARE_PREFIX = "shares";
const MAX_SHARE_BYTES = 80 * 1024 * 1024;

function hashToken(token) {
  return createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

function tokensMatch(writeToken, expectedHash) {
  if (!writeToken || !expectedHash) return false;
  const actual = hashToken(writeToken);
  try {
    const a = Buffer.from(actual, "hex");
    const b = Buffer.from(String(expectedHash), "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function createShareIds() {
  return {
    id: randomBytes(16).toString("hex"),
    writeToken: randomBytes(32).toString("base64url"),
  };
}

function tourPathname(id) {
  return `${SHARE_PREFIX}/${id}.json`;
}

function metaPathname(id) {
  return `${SHARE_PREFIX}/${id}.meta.json`;
}

function isShareId(id) {
  return typeof id === "string" && /^[a-f0-9]{32}$/.test(id);
}

module.exports = {
  SHARE_PREFIX,
  MAX_SHARE_BYTES,
  hashToken,
  tokensMatch,
  createShareIds,
  tourPathname,
  metaPathname,
  isShareId,
};
