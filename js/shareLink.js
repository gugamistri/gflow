/**
 * Um só link no painel: permanente no Pro, temporário nos outros.
 * why: o hash e o endereço público não dependem do DOM.
 */
import { prepareSharePayload } from "./shareSnapshot.js";

export const PUBLIC_SHARE_ORIGIN = "https://guiaflow.pro";

export function hashSharePayload(project) {
  const json = JSON.stringify(prepareSharePayload(project));
  let hash = 2166136261;
  for (let i = 0; i < json.length; i += 1) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function shareRecordIsStale(record, project) {
  if (!record || !project) return false;
  const stored = String(record.payloadHash || "");
  if (!stored) return false;
  return stored !== hashSharePayload(project);
}

/** Hash a gravar na primeira vez que um link antigo, sem hash, é aberto. */
export function shareBaselineHash(record, project) {
  if (!record || !project || record.payloadHash) return "";
  return hashSharePayload(project);
}

export function slugFromShareUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw, `${PUBLIC_SHARE_ORIGIN}/`);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const marker = parts.findIndex((part) => part === "p" || part === "v");
    const slug = marker >= 0 ? parts[marker + 1] : parts[parts.length - 1];
    return slug ? decodeURIComponent(slug) : "";
  } catch {
    return "";
  }
}

export function permanentSlug(record) {
  if (!record) return "";
  if (typeof record === "string") return slugFromShareUrl(record) || record;
  const explicit = String(record.slug || "").trim();
  if (explicit) return explicit;
  const fromUrl = slugFromShareUrl(record.url);
  if (fromUrl) return fromUrl;
  return String(record.id || "").trim();
}

/** O que a pessoa vê e copia. O endereço antigo em app.guiaflow.pro/v/ redireciona. */
export function permanentPublicUrl(record) {
  const slug = permanentSlug(record);
  if (!slug) return "";
  return `${PUBLIC_SHARE_ORIGIN}/p/${encodeURIComponent(slug)}`;
}

export function shareFreshness(publishedAt, now = Date.now()) {
  const at = Number(publishedAt);
  if (!Number.isFinite(at) || at <= 0) return { key: "share.updatedNow", n: 0 };
  const minutes = Math.floor(Math.max(0, now - at) / 60000);
  if (minutes < 1) return { key: "share.updatedNow", n: 0 };
  if (minutes < 60) return { key: "share.updatedMinutes", n: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { key: "share.updatedHours", n: hours };
  return { key: "share.updatedDays", n: Math.floor(hours / 24) };
}

export function shouldRecreatePermanent(result) {
  const status = Number(result?.status) || 0;
  const data = result?.data && typeof result.data === "object" ? result.data : {};
  const code = String(result?.error || data.error || data.code || "");
  return status === 404 || status === 403 || code === "not_found" || code === "not_owner";
}
