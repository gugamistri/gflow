/**
 * Confere a assinatura Standard Webhooks que o GuiaFlow manda em cada lead.
 * Cabeçalhos: webhook-id, webhook-timestamp, webhook-signature (v1,<base64>).
 * O corpo tem de ser os bytes crus do POST — não re-serialize o JSON.
 *
 *   import { verifyStandardWebhook } from "./verify-signature.mjs";
 *   const raw = await readRawBody(req);
 *   const ok = verifyStandardWebhook({
 *     secret: process.env.GUIAFLOW_WEBHOOK_SECRET,
 *     id: req.headers["webhook-id"],
 *     timestamp: req.headers["webhook-timestamp"],
 *     signature: req.headers["webhook-signature"],
 *     body: raw,
 *   });
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const TOLERANCE_SEC = 300;

export function webhookKey(secret) {
  const trimmed = String(secret || "").trim();
  if (!trimmed.startsWith("whsec_")) return null;
  const b64 = trimmed.slice("whsec_".length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
  const key = Buffer.from(b64, "base64");
  if (!key.length) return null;
  // why: Buffer.from ignora lixo no alfabeto; um whsec_ colado com caractere a mais não pode passar
  if (key.toString("base64").replace(/=+$/, "") !== b64.replace(/=+$/, "")) return null;
  return key;
}

/** timestampSec: segundos unix (o mesmo número do cabeçalho webhook-timestamp). */
export function signWebhook(secret, id, timestampSec, body) {
  const key = webhookKey(secret);
  if (!key) throw new Error("invalid_secret");
  const mac = createHmac("sha256", key).update(`${id}.${timestampSec}.${body}`).digest("base64");
  return `v1,${mac}`;
}

export function verifyStandardWebhook({
  secret,
  id,
  timestamp,
  signature,
  body,
  now = Date.now(),
  toleranceSec = TOLERANCE_SEC,
} = {}) {
  if (typeof body !== "string" || !id || timestamp == null || timestamp === "" || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isInteger(ts)) return false;
  const nowSec = Math.floor(Number(now) / 1000);
  if (!Number.isInteger(nowSec) || Math.abs(nowSec - ts) > toleranceSec) return false;
  const key = webhookKey(secret);
  if (!key) return false;
  const expected = Buffer.from(createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64"));
  for (const part of String(signature).split(" ")) {
    const comma = part.indexOf(",");
    if (comma < 0 || part.slice(0, comma) !== "v1") continue;
    const got = Buffer.from(part.slice(comma + 1));
    if (got.length === expected.length && timingSafeEqual(got, expected)) return true;
  }
  return false;
}
