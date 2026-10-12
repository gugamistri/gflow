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
  const features = data.features && typeof data.features === "object" ? data.features : {};
  return {
    ok: true,
    tour: payload,
    title: typeof data.title === "string" ? data.title.trim() : "",
    // why: o Cloud calcula pelo plano atual do dono; ausente (Cloud antigo) = null
    branding: data.branding === "shown" || data.branding === "hidden" ? data.branding : null,
    // why: o servidor decide (passo ligado no tour publicado + autor Pro); o player só obedece
    features: {
      leadCapture: features.leadCapture === true,
      contactForm: features.contactForm === true,
    },
  };
}

/**
 * Esc no player compartilhado, na mesma ordem do preview do editor.
 * overlay = lista de passos, ajuda ou partilha — não o véu do tour.
 * Sem página anterior, fecha o tour nesta página.
 */
export function decideEscape({ fullscreen = false, overlay = false, back = false, embed = false } = {}) {
  if (fullscreen) return "fullscreen";
  if (overlay) return "overlay";
  // why: dentro do site de outra pessoa o Esc nunca fecha o tour
  if (embed) return "";
  if (back) return "back";
  return "close";
}

function truthyParam(value) {
  if (value == null) return false;
  const raw = String(value).trim().toLowerCase();
  return raw === "" || raw === "1" || raw === "true" || raw === "yes" || raw === "sim" || raw === "on";
}

/**
 * `?embed=1` liga o modo incorporado (iframe no site do cliente).
 * `?autoplay=1` só vale no embed: sem ele, o tour espera o clique em ▶.
 */
export function parseEmbedOptions(search) {
  const params = new URLSearchParams(String(search || "").replace(/^\?/, ""));
  const embed = params.has("embed") && truthyParam(params.get("embed"));
  const autoplay = embed && params.has("autoplay") && truthyParam(params.get("autoplay"));
  return { embed, autoplay };
}

/** No embed sem autoplay, o tour abre na capa com ▶ «Ver tour». */
export function embedShowsCover({ embed = false, autoplay = false } = {}) {
  return Boolean(embed && !autoplay);
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

/** Título do separador: «Nome — GuiaFlow»; sem marca (link permanente), só o nome. */
export function sharePageTitle(name, fallback = "GuiaFlow — Tour", { branded = true } = {}) {
  const label = String(name || "").trim();
  if (!branded) return label || "Tour";
  return label ? `${label} — GuiaFlow` : fallback;
}

/**
 * Marca GuiaFlow no player.
 * - "full": logo no topo (link temporário /v e editor).
 * - "none": link permanente /p (só Pro publica) — sem logo, padrão também para links antigos.
 * - "credit": /p cujo autor pediu o crédito (`removeBranding: false` no tour publicado) — «Feito com GuiaFlow».
 * server = `branding` do Cloud: "shown" (dono sem Pro agora) volta ao logo do plano grátis, ignorando a opção salva.
 */
export function shareBranding(kind, tour, server = null) {
  if (kind !== "permanent" || server === "shown") return "full";
  return tour && typeof tour === "object" && tour.removeBranding === false ? "credit" : "none";
}

/** Cartão do passo (slide ou popover) e o destaque da tela. */
export const TOUR_CARD_SELECTOR = [
  "#canvas-slide",
  ".slide-card",
  ".driver-popover:not(.is-slide-hidden)",
  "#hotspot",
  ".driver-active-element",
  ".gf-player-controls",
].join(", ");

/** Controlos fora do cartão, como o logótipo, que não fecham o tour. */
export const TOUR_CHROME_SELECTOR = "a, button, input, textarea, select, summary";

/**
 * Clique na área escurecida, fora do cartão.
 * why: o véu do Driver tem pointer-events no path, mas o clique nem sempre chega ao handler dele.
 */
export function clickClosesSharedTour(target, { embed = false } = {}) {
  // why: no embed um clique sem querer na página do cliente não pode fechar o tour
  if (embed) return false;
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
