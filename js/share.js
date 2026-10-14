/**
 * Publica / atualiza / revoga o link de preview (Vercel Blob via token de cliente).
 */
import { getLocale, t } from "./i18n.js";
import {
  cloudFetch,
  getCloudFlags,
  isCloudEnabled,
} from "./cloudConfig.js";
import {
  assertShareSnapshotSafe,
  buildShareSnapshot,
  shareViewUrl,
} from "./shareSnapshot.js";
import { permanentPublicUrl, permanentSlug, shouldRecreatePermanent } from "./shareLink.js";
import { renderCover, tourRatio } from "./coverImage.js";
import { externalizeLangAudio } from "./shareMedia.js";
import {
  LEGACY_SHARE_MAX_BODY_BYTES,
  SHARE_MAX_BODY_BYTES,
  abortable,
  compressTourImages,
  formatMb,
  uploadTimeoutMs,
  utf8Bytes,
  withTimeout,
} from "./shareCompress.js";

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
  if (code === "payload_too_large" || code === "http_413" || (result?.status === 413 && !isCoverCode(code))) {
    return tooLargeMessage(result?.sizeBytes ?? data.receivedBytes, result?.limitBytes ?? data.limitBytes);
  }
  if (code === "timeout") return t("share.cloud.timeout");
  if (code === "aborted") return t("share.cloud.aborted");
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
  const slug = String(nested?.slug || body.slug || "").trim();
  const id = String(nested?.id || body.id || slug || "").trim();
  const updatedAt = Date.parse(nested?.updatedAt || body.updatedAt || "");
  const rawCover = nested?.cover && typeof nested.cover === "object" ? nested.cover : null;
  const coverUrl = typeof rawCover?.url === "string" && /^https:\/\//.test(rawCover.url) ? rawCover.url : "";
  return {
    url,
    id,
    slug,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
    coverUrl,
  };
}

/** Corpo do POST/PUT /shares. cover: data URL JPEG; sem capa o Cloud mantém a anterior. */
export function permanentRequestBody(project, snapshot, { cover = "", ratio = "" } = {}) {
  const title = String(project?.name || snapshot?.name || "").trim().slice(0, 200);
  const body = { tour: snapshot };
  // why: no POST o título é obrigatório; no PUT um título vazio deixaria o nome atual
  if (title) body.title = title;
  if (cover) body.cover = cover;
  if (ratio) body.ratio = ratio;
  return JSON.stringify(body);
}

function isCoverCode(code) {
  return code === "invalid_cover" || code === "cover_too_large";
}

// why: 413 sem código de capa é o tour inteiro grande demais; reenviar sem capa só repetia o upload
function isCoverRejected(result) {
  return isCoverCode(String(result?.error || result?.data?.error || ""));
}

function localeTag() {
  try {
    return getLocale();
  } catch {
    return "pt";
  }
}

function tooLargeMessage(sizeBytes, limitBytes) {
  const limit = Number(limitBytes) > 0 ? Number(limitBytes) : LEGACY_SHARE_MAX_BODY_BYTES;
  const size = Number(sizeBytes) > 0 ? Number(sizeBytes) : 0;
  const locale = localeTag();
  if (!size) return t("share.cloud.tooLargeNoSize", { limit: formatMb(limit, locale) });
  return t("share.cloud.tooLarge", { size: formatMb(size, locale), limit: formatMb(limit, locale) });
}

function tooLargeError(sizeBytes, limitBytes, status) {
  const err = new Error(tooLargeMessage(sizeBytes, limitBytes));
  err.code = "payload_too_large";
  err.status = status || 413;
  err.sizeBytes = sizeBytes;
  err.limitBytes = limitBytes;
  return err;
}

async function safeCover(project, buildCover) {
  try {
    const cover = await buildCover(project, { badge: t("share.cover.badge") });
    return typeof cover?.dataUrl === "string" ? cover.dataUrl : "";
  } catch (err) {
    console.warn("cover", err);
    return "";
  }
}

async function safeRatio(project, measureRatio) {
  try {
    return String((await measureRatio(project)) || "");
  } catch {
    return "";
  }
}

function permanentFailure(result, sizeBytes) {
  if (result?.status === 413 || result?.error === "payload_too_large") {
    const data = result.data && typeof result.data === "object" ? result.data : {};
    return tooLargeError(Number(data.receivedBytes) || sizeBytes, Number(data.limitBytes) || LEGACY_SHARE_MAX_BODY_BYTES, 413);
  }
  const err = new Error(permanentShareErrorMessage(result));
  err.code = result.error || result.reason || "share_failed";
  err.status = result.status;
  const body = result.data && typeof result.data === "object" ? result.data : {};
  err.feature = typeof body.feature === "string" ? body.feature : "";
  err.plan = typeof body.plan === "string" ? body.plan : "";
  return err;
}

function permanentShareFromResult(result) {
  const payload = readPermanentPayload(result.data);
  const slug = permanentSlug({ url: payload.url, slug: payload.slug, id: payload.id });
  const url = permanentPublicUrl({ url: payload.url, slug: payload.slug, id: payload.id });
  if (!url) {
    const err = new Error(t("share.cloud.generic"));
    err.code = "share_failed";
    throw err;
  }
  return {
    id: slug || payload.id,
    slug: slug || payload.id,
    url,
    updatedAt: payload.updatedAt || Date.now(),
    coverUrl: payload.coverUrl,
  };
}

/**
 * Publica ou atualiza o link permanente.
 * why: o primeiro envio é POST /shares; republicar é PUT /shares/:slug e, se o slug já não for nosso, cria outro.
 */
export async function publishPermanentShare(
  project,
  {
    onProgress,
    env,
    slug = "",
    signal,
    buildSnapshot = buildShareSnapshot,
    buildCover = renderCover,
    measureRatio = tourRatio,
    compress = compressTourImages,
    externalize = (snap) => externalizeLangAudio(snap, {
      check: (hashes) => cloudFetch("/media/check", { method: "POST", body: JSON.stringify({ hashes }), signal }, env),
      upload: (sha, bytes, mime) => cloudFetch(`/media/${encodeURIComponent(sha)}`, { method: "PUT", body: bytes, headers: { "Content-Type": mime }, timeoutMs: 180 * 1000, signal }, env),
    }),
    maxBytes = SHARE_MAX_BODY_BYTES,
    snapshotTimeoutMs = 90 * 1000,
    coverTimeoutMs = 15 * 1000,
  } = {}
) {
  if (!isCloudEnabled(env) || !getCloudFlags(env).permanentShare) {
    const err = new Error(permanentShareErrorMessage({ reason: "cloud-not-configured" }));
    err.code = "cloud-not-configured";
    throw err;
  }
  const step = (promise, ms) => abortable(ms ? withTimeout(promise, ms) : promise, signal);
  let snapshot;
  try {
    snapshot = await step(buildSnapshot(project, { onProgress }), snapshotTimeoutMs);
  } catch (err) {
    throw stageFailure(err);
  }
  try {
    assertShareSnapshotSafe(snapshot, project?.share?.writeToken);
  } catch {
    const err = new Error(t("share.errGeneric"));
    err.code = "share_failed";
    throw err;
  }
  // why: capturas em PNG estouravam o limite; WebP/JPEG mantém a resolução com 4–8× menos bytes
  try {
    snapshot = await step(
      compress(snapshot, {
        signal,
        onProgress: (i, n) => onProgress?.(t("share.compress.progress", { i, n })),
      }),
      0
    );
  } catch (err) {
    if (err?.code === "aborted") throw stageFailure(err);
    console.warn("compress", err);
  }
  // why: /p v2 — áudio dos idiomas-alvo sobe uma vez e vai por referência (limite de 12 MB só para JSON e imagens)
  try {
    snapshot = (await step(externalize(snapshot), 0)).snapshot;
  } catch (err) {
    throw stageFailure(err);
  }
  onProgress?.(t("share.cover.progress"));
  let cover = "";
  try {
    cover = await step(safeCover(project, buildCover), coverTimeoutMs);
  } catch (err) {
    if (err?.code === "aborted") throw stageFailure(err);
    cover = "";
  }
  let ratio = "";
  try {
    ratio = await step(safeRatio(project, measureRatio), coverTimeoutMs);
  } catch (err) {
    if (err?.code === "aborted") throw stageFailure(err);
    ratio = "";
  }
  // why: medir antes de enviar; o servidor só recusava depois de receber tudo
  let body = permanentRequestBody(project, snapshot, { cover, ratio });
  let bytes = utf8Bytes(body);
  let coverDropped = false;
  if (bytes > maxBytes && cover) {
    body = permanentRequestBody(project, snapshot, { ratio });
    bytes = utf8Bytes(body);
    coverDropped = true;
  }
  if (bytes > maxBytes) throw tooLargeError(bytes, maxBytes);
  onProgress?.(t("share.cloud.progressSize", { size: formatMb(bytes, localeTag()) }));
  const current = String(slug || "").trim();
  const timeoutMs = uploadTimeoutMs(bytes);
  const request = (path, method, payload) => cloudFetch(path, { method, body: payload, timeoutMs, signal }, env);
  // why: se o Cloud recusar a capa, o link sai mesmo assim (sem trocar a capa anterior)
  const send = async (path, method) => {
    const first = await request(path, method, body);
    if (first.ok || coverDropped || !cover || !isCoverRejected(first)) {
      return { result: first, coverSkipped: coverDropped || !cover };
    }
    const plain = await request(path, method, permanentRequestBody(project, snapshot, { ratio }));
    return { result: plain, coverSkipped: true };
  };
  if (current) {
    const put = await send(`/shares/${encodeURIComponent(current)}`, "PUT");
    if (put.result.ok) return { ...permanentShareFromResult(put.result), coverSkipped: put.coverSkipped };
    if (!shouldRecreatePermanent(put.result)) throw permanentFailure(put.result, bytes);
  }
  const created = await send("/shares", "POST");
  if (!created.result.ok) throw permanentFailure(created.result, bytes);
  return { ...permanentShareFromResult(created.result), coverSkipped: created.coverSkipped };
}

function stageFailure(err) {
  if (err?.code === "aborted") return permanentFailure({ error: "aborted" });
  if (err?.code === "timeout") return permanentFailure({ error: "timeout" });
  if (err && typeof err === "object" && err.code) return err;
  const out = new Error(t("share.errGeneric"));
  out.code = "share_failed";
  return out;
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
