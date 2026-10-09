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

async function fetchPermanentShare(slug, fetchImpl = globalThis.fetch) {
  const url = `${sharesOrigin()}/api/shares/${encodeURIComponent(slug)}`;
  let res;
  try {
    res = await fetchImpl(url, { headers: { accept: "application/json" } });
  } catch {
    return { missing: false, failed: true, name: null };
  }
  const data = await res.json().catch(() => null);
  if (res.status === 404 || data?.error === "not_found") {
    return { missing: true, failed: false, name: null };
  }
  if (!res.ok || !data || data.ok !== true) {
    return { missing: false, failed: true, name: null };
  }
  return { missing: false, failed: false, name: shareTitle(data) };
}

module.exports = {
  DEFAULT_SHARES_ORIGIN,
  isPermanentSlug,
  fetchPermanentShare,
  sharesOrigin,
};
