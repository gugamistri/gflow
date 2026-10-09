/**
 * Publica / atualiza / revoga o link de preview (Vercel Blob via token de cliente).
 */
import { t } from "./i18n.js";
import {
  cloudFetch,
  getCloudBaseUrl,
  getCloudFlags,
  isCloudEnabled,
} from "./cloudConfig.js";
import {
  assertShareSnapshotSafe,
  buildShareSnapshot,
  shareViewUrl,
} from "./shareSnapshot.js";

const BLOB_API = "https://vercel.com/api/blob";
const BLOB_API_VERSION = "12";

function storeIdFromClientToken(token) {
  const parts = String(token || "").split("_");
  return parts[3] || "";
}

/**
 * PUT direto na API do Blob com o clientToken — sem SDK no browser.
 * why: o app não tem bundler; o token já carrega pathname, tamanho e overwrite.
 */
async function putTourJson(pathname, jsonText, clientToken) {
  if (!String(clientToken || "").startsWith("vercel_blob_client_")) {
    throw new Error(t("share.errGeneric"));
  }
  const storeId = storeIdFromClientToken(clientToken);
  const params = new URLSearchParams({ pathname });
  const res = await fetch(`${BLOB_API}/?${params}`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${clientToken}`,
      "x-api-version": BLOB_API_VERSION,
      "x-vercel-blob-access": "public",
      "x-content-type": "application/json",
      "x-vercel-blob-store-id": storeId,
    },
    body: jsonText,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  if (!data?.url) {
    throw new Error(t("share.errGeneric"));
  }
  return data;
}

async function apiJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const code = data?.error || "share_failed";
    const err = new Error(shareErrorMessage(code, data?.message));
    err.code = code;
    err.status = res.status;
    throw err;
  }
  return data;
}

function shareErrorMessage(code, fallback) {
  if (code === "blob_not_configured") return t("share.errBlob");
  if (code === "forbidden") return t("share.errForbidden");
  if (code === "not_found") return t("share.errNotFound");
  if (code === "expired") return t("share.errExpired");
  return fallback || t("share.errGeneric");
}

/**
 * Cria ou atualiza o snapshot no Blob e devolve { id, writeToken, url }.
 */
export async function publishShareLink(project, { onProgress } = {}) {
  const snapshot = await buildShareSnapshot(project, { onProgress });
  const prev = project.share;
  const body =
    prev?.id && prev?.writeToken
      ? { id: prev.id, writeToken: prev.writeToken }
      : {};

  onProgress?.(t("share.progressToken"));
  let tokenRes;
  let renewed = false;
  try {
    tokenRes = await apiJson("/api/share", {
      method: "POST",
      body: JSON.stringify(body),
    });
  } catch (err) {
    if (err.code !== "expired" || !body.id) throw err;
    // why: depois de 7 dias o id antigo foi apagado; publicar de novo abre outro prazo
    renewed = true;
    tokenRes = await apiJson("/api/share", {
      method: "POST",
      body: JSON.stringify({}),
    });
  }

  const writeToken = tokenRes.writeToken || prev.writeToken;
  assertShareSnapshotSafe(snapshot, writeToken);

  const jsonText = JSON.stringify(snapshot);
  onProgress?.(t("share.progressUpload"));
  const blob = await putTourJson(tokenRes.pathname, jsonText, tokenRes.clientToken);

  await apiJson(`/api/share/${tokenRes.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      writeToken,
      url: blob.url,
      name: snapshot.name || project.name || "",
    }),
  });

  const url = shareViewUrl(tokenRes.id);
  return {
    id: tokenRes.id,
    writeToken,
    updatedAt: Date.now(),
    url,
    renewed,
  };
}

export async function revokeShareLink(share) {
  if (!share?.id || !share?.writeToken) {
    throw new Error(t("share.errGeneric"));
  }
  await apiJson(`/api/share/${share.id}`, {
    method: "DELETE",
    body: JSON.stringify({ writeToken: share.writeToken }),
  });
}

function cloudPlanLimitMessage(data) {
  const plan = String(data?.plan || data?.tier || data?.product || "").toLowerCase();
  if (/(cloud|pro|paid|team|plus)/.test(plan)) return t("share.cloud.limitCloud");
  if (/(free|hobby|starter)/.test(plan)) return t("share.cloud.limitFree");
  const limit = Number(data?.limit ?? data?.max ?? data?.cap);
  if (Number.isFinite(limit) && limit >= 25) return t("share.cloud.limitCloud");
  return t("share.cloud.limitFree");
}

/**
 * Mensagens do link permanente. why: a API manda códigos; a interface fala em português.
 */
export function permanentShareErrorMessage(result) {
  const data = result?.data && typeof result.data === "object" ? result.data : {};
  const code = String(result?.error || result?.reason || data.error || data.code || "");
  if (code === "share_limit" || data.error === "share_limit") return cloudPlanLimitMessage(data);
  if (code === "invalid_credentials" || code === "invalid_password") return t("share.cloud.badLogin");
  if (result?.status === 401 || code === "unauthorized") return t("share.cloud.unauthorized");
  if (code === "invalid_email") return t("share.cloud.invalidEmail");
  if (code === "invalid_token") return t("share.cloud.invalidToken");
  if (code === "email_failed" || code === "config_missing") return t("share.cloud.emailFailed");
  if (code === "cloud-not-configured") return t("share.cloud.off");
  if (code === "network" || code === "invalid_path") return t("share.cloud.network");
  if (result?.status === 503) return t("billing.unavailable");
  if (result?.status === 402 || code === "subscription_required") {
    const message = typeof result?.message === "string" ? result.message.trim() : "";
    return message || t("billing.message");
  }
  if (result?.status === 429 || code === "quota_exceeded") {
    const message = typeof result?.message === "string" ? result.message.trim() : "";
    return message || t("billing.quota");
  }
  return t("share.cloud.generic");
}

function readPermanentPayload(data) {
  const body = data && typeof data === "object" ? data : {};
  const nested = body.share && typeof body.share === "object" ? body.share : null;
  const url = String(nested?.url || body.url || "").trim();
  const id = String(nested?.id || body.id || nested?.slug || body.slug || "").trim();
  return { url, id };
}

function absoluteCloudUrl(url, env) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    // why: https://guiaflow.pro/p/… já é absoluto e fica como a API mandou
    if (/^https?:\/\//i.test(raw)) return new URL(raw).toString();
    const base = getCloudBaseUrl(env);
    return new URL(raw, base ? `${base}/` : undefined).toString();
  } catch {
    return raw;
  }
}

/**
 * Publica um link permanente em POST /shares.
 * why: o preview de 7 dias continua em publishShareLink; este caminho é opcional.
 */
export async function publishPermanentShare(project, { onProgress, env, buildSnapshot = buildShareSnapshot } = {}) {
  if (!isCloudEnabled(env) || !getCloudFlags(env).permanentShare) {
    const err = new Error(permanentShareErrorMessage({ reason: "cloud-not-configured" }));
    err.code = "cloud-not-configured";
    throw err;
  }
  const snapshot = await buildSnapshot(project, { onProgress });
  try {
    assertShareSnapshotSafe(snapshot, project?.share?.writeToken);
  } catch {
    const err = new Error(t("share.errGeneric"));
    err.code = "share_failed";
    throw err;
  }
  onProgress?.(t("share.cloud.progress"));
  const result = await cloudFetch(
    "/shares",
    {
      method: "POST",
      body: JSON.stringify({
        title: String(project?.name || snapshot?.name || "").slice(0, 200),
        tour: snapshot,
      }),
    },
    env
  );
  if (!result.ok) {
    const err = new Error(permanentShareErrorMessage(result));
    err.code = result.error || result.reason || "share_failed";
    err.status = result.status;
    const body = result.data && typeof result.data === "object" ? result.data : {};
    err.feature = typeof body.feature === "string" ? body.feature : "";
    err.plan = typeof body.plan === "string" ? body.plan : "";
    throw err;
  }
  const payload = readPermanentPayload(result.data);
  const url = absoluteCloudUrl(payload.url, env);
  if (!url) {
    const err = new Error(t("share.cloud.generic"));
    err.code = "share_failed";
    throw err;
  }
  return {
    id: payload.id,
    url,
    updatedAt: Date.now(),
  };
}

function copyWithTextarea(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(ta);
  if (!ok) throw new Error(t("share.errGeneric"));
}

export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // why: o Clipboard API rejeita sem foco; o textarea ainda copia
  }
  copyWithTextarea(text);
}
