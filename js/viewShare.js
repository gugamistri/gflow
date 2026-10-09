/**
 * Rota e carga do player compartilhado (/v temporário e /p permanente).
 * why: os dois links usam o mesmo tour; só a origem do JSON muda.
 */

const TEMPORARY_ID = /\/v\/([A-Za-z0-9_-]{11}|[a-f0-9]{32})\/?$/i;
const PERMANENT_SLUG = /\/p\/([A-Za-z0-9][A-Za-z0-9_-]{0,80})\/?$/;

export function parseViewRoute(pathname, boot) {
  const meta = boot && typeof boot === "object" ? boot : null;
  if (meta?.kind === "permanent" && typeof meta.id === "string" && meta.id) {
    return { kind: "permanent", id: meta.id };
  }
  const path = String(pathname || "");
  const permanent = path.match(PERMANENT_SLUG);
  if (permanent) return { kind: "permanent", id: permanent[1] };
  if (meta?.id && typeof meta.id === "string" && meta.kind !== "permanent") {
    return { kind: "temporary", id: meta.id };
  }
  const temporary = path.match(TEMPORARY_ID);
  if (temporary) return { kind: "temporary", id: temporary[1] };
  return null;
}

export function permanentShareEndpoint(base, slug) {
  const root = String(base || "").replace(/\/$/, "");
  return `${root}/api/shares/${encodeURIComponent(slug)}`;
}

/**
 * O GET /api/shares/:slug devolve o mesmo objeto que o editor envia em `tour`.
 */
export function tourFromPermanentShare(data) {
  if (!data || typeof data !== "object" || data.ok !== true) {
    const error = data?.error === "not_found" ? "not_found" : "load_failed";
    return { ok: false, error };
  }
  const payload = data.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "not_found" };
  }
  return {
    ok: true,
    tour: payload,
    title: typeof data.title === "string" ? data.title.trim() : "",
  };
}

/**
 * Esc no player compartilhado, na mesma ordem do preview do editor.
 * overlay = lista de passos, ajuda ou partilha — não o véu do tour.
 * Sem página anterior, fecha o tour nesta página.
 */
export function decideEscape({ fullscreen = false, overlay = false, back = false } = {}) {
  if (fullscreen) return "fullscreen";
  if (overlay) return "overlay";
  if (back) return "back";
  return "close";
}

/**
 * Passo inicial do link partilhado. Só a URL manda; storage do editor não entra.
 * `?step=2` e `?passo=2` são 1-based. Sem pedido explícito, começa no passo 1.
 */
export function shareStartIndex(search, stepCount) {
  const params = new URLSearchParams(String(search || "").replace(/^\?/, ""));
  const raw = params.get("step") ?? params.get("passo");
  if (raw == null || String(raw).trim() === "") return 0;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n)) return 0;
  const index = Math.trunc(n) >= 1 ? Math.trunc(n) - 1 : 0;
  const max = Math.max(0, Number(stepCount) || 0);
  if (!max) return 0;
  return Math.max(0, Math.min(max - 1, index));
}

/** Título do separador, igual em /v e /p: «Nome — GuiaFlow». */
export function sharePageTitle(name, fallback = "GuiaFlow — Tour") {
  const label = String(name || "").trim();
  return label ? `${label} — GuiaFlow` : fallback;
}

/** Cartão do passo (slide ou popover) e o destaque da tela. */
export const TOUR_CARD_SELECTOR = [
  "#canvas-slide",
  ".slide-card",
  ".driver-popover:not(.is-slide-hidden)",
  "#hotspot",
  ".driver-active-element",
].join(", ");

/** Controlos fora do cartão, como o logótipo, que não fecham o tour. */
export const TOUR_CHROME_SELECTOR = "a, button, input, textarea, select, summary";

/**
 * Clique na área escurecida, fora do cartão.
 * why: o véu do Driver tem pointer-events no path, mas o clique nem sempre chega ao handler dele.
 */
export function clickClosesSharedTour(target) {
  const node = target?.nodeType === 3 ? target.parentElement : target;
  if (!node || typeof node.closest !== "function") return false;
  if (node.closest(TOUR_CARD_SELECTOR)) return false;
  if (node.closest(TOUR_CHROME_SELECTOR)) return false;
  return true;
}

export function sameOriginReferrer(referrer, origin) {
  if (!referrer || !origin) return false;
  try {
    return new URL(referrer).origin === origin;
  } catch {
    return false;
  }
}

/**
 * Volta só para a mesma origem (editor) ou fecha a aba que o editor abriu.
 * why: history.back() para um site externo seria um salto, não “sair do preview”.
 */
export function sharedPreviewBackTarget({ referrer, origin, historyLength = 0, hasOpener = false } = {}) {
  if (hasOpener) return "close";
  if (historyLength > 1 && sameOriginReferrer(referrer, origin)) return "back";
  return "";
}
