/**
 * Publica / atualiza / revoga o link de preview (Vercel Blob via token de cliente).
 */
import { t } from "./i18n.js";
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

export async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
}
