/**
 * Meta do link permanente. O JSON do tour fica no cliente — igual ao /v.
 */
const DEFAULT_SHARES_ORIGIN = "https://app.guiaflow.pro";

function sharesOrigin() {
  return String(process.env.GUIAFLOW_SHARES_ORIGIN || DEFAULT_SHARES_ORIGIN).replace(/\/$/, "");
}

function isPermanentSlug(value) {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(String(value || ""));
}

function shareTitle(data) {
  const title = typeof data?.title === "string" ? data.title.trim() : "";
  if (title) return title;
  const name = typeof data?.payload?.name === "string" ? data.payload.name.trim() : "";
  return name || null;
}

const EMPTY_META = Object.freeze({
  name: null,
  image: null,
  imageWidth: null,
  imageHeight: null,
  stepCount: null,
  ratio: null,
  updatedAt: null,
});

function positiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Só aceita a capa servida pelo próprio Cloud (https). */
function safeCoverUrl(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.origin === sharesOrigin() ? url.href : null;
  } catch {
    return null;
  }
}

function safeRatio(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  return /^\d{1,4}(?:\.\d{1,2})?\/\d{1,4}(?:\.\d{1,2})?$/.test(raw) ? raw : null;
}

function metaFromData(data) {
  return {
    ...EMPTY_META,
    name: shareTitle(data),
    image: safeCoverUrl(data?.coverUrl),
    imageWidth: positiveInt(data?.coverWidth),
    imageHeight: positiveInt(data?.coverHeight),
    stepCount:
      Number.isInteger(data?.stepCount) && data.stepCount >= 0
        ? data.stepCount
        : Array.isArray(data?.payload?.steps)
          ? data.payload.steps.length
          : null,
    ratio: safeRatio(data?.ratio),
    updatedAt: typeof data?.updatedAt === "string" ? data.updatedAt : null,
  };
}

async function getJson(url, fetchImpl) {
  try {
    const res = await fetchImpl(url, { headers: { accept: "application/json" } });
    const data = await res.json().catch(() => null);
    return { res, data };
  } catch {
    return { res: null, data: null };
  }
}

/**
 * Meta leve do /p (título, capa, nº de passos, proporção).
 * why: GET /api/shares/:slug/meta não baixa o tour (até 4 MB); cai no endpoint antigo
 * se o Cloud ainda não tiver a rota (deploy fora de ordem).
 */
async function fetchPermanentShare(slug, fetchImpl = globalThis.fetch) {
  const base = `${sharesOrigin()}/api/shares/${encodeURIComponent(slug)}`;
  let { res, data } = await getJson(`${base}/meta`, fetchImpl);
  if (res && res.status === 404) {
    ({ res, data } = await getJson(base, fetchImpl));
  }
  if (!res) return { ...EMPTY_META, missing: false, failed: true };
  if (res.status === 404 || data?.error === "not_found") {
    return { ...EMPTY_META, missing: true, failed: false };
  }
  if (!res.ok || !data || data.ok !== true) {
    return { ...EMPTY_META, missing: false, failed: true };
  }
  return { ...metaFromData(data), missing: false, failed: false };
}

module.exports = {
  DEFAULT_SHARES_ORIGIN,
  isPermanentSlug,
  fetchPermanentShare,
  metaFromData,
  sharesOrigin,
};
