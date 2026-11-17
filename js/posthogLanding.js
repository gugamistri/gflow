/**
 * PostHog nas páginas do site (guiaflow.pro: home, /en, /es e páginas de marketing).
 * O editor (/editor) e o player (/p, /v, /exemplos) têm a própria medição e ficam de fora.
 *
 * - A config vem de GET /api/analytics-config (POSTHOG_KEY/POSTHOG_HOST na Vercel). Sem config válida → nada carrega.
 * - DNT/GPC → nada carrega.
 * - Autocapture com textos e atributos mascarados (sem texto copiado), $pageview/$pageleave e quatro eventos:
 *   cta_click, signup_started, pricing_viewed e demo_play.
 * - before_send: só os eventos liberados, propriedades sem PII (sanitizeProperties), product=guiaflow,
 *   surface=landing e $geoip_disable (sem país nem coordenadas), como o editor e o player.
 * - Sem identify: a landing não tem login. localStorage (sem cookie), como o editor.
 */
import { looksLikePii, POSTHOG_CONFIG_PATH, POSTHOG_PRODUCT, readPosthogConfig, sanitizeProperties } from "./posthogConfig.js";
import { privacySignal } from "./viewAnalytics.js";

export const LANDING_SURFACE = "landing";
export const LANDING_CUSTOM_EVENTS = Object.freeze(["cta_click", "signup_started", "pricing_viewed", "demo_play"]);
export const LANDING_SDK_EVENTS = Object.freeze(["$pageview", "$pageleave", "$autocapture", ...LANDING_CUSTOM_EVENTS]);

/** Rotas com medição própria (editor, player, exemplos) ou sem página de site. */
const NOT_LANDING_RE = /^\/(?:(?:en|es)\/)?(?:editor|p|v|exemplos|view|auth|api|a|demo|extension|downloads)(?:[/.]|$)/;

/** true só nas páginas do site (home, /en, /es, ajuda, integrações, preços, legais…). */
export function isLandingPath(pathname) {
  const path = String(pathname || "/");
  return !NOT_LANDING_RE.test(path);
}

/** Opções do posthog-js nas páginas do site. */
export function landingInitOptions(config, { beforeSend } = {}) {
  return {
    api_host: config.host,
    // why: sem script externo (gravação, pesquisas, toolbar); a lib vem de vendor/posthog
    disable_external_dependency_loading: true,
    capture_pageview: "history_change",
    capture_pageleave: true,
    // cliques sim, mas sem o texto da tela, sem atributos e sem texto copiado
    autocapture: { capture_copied_text: false },
    mask_all_text: true,
    mask_all_element_attributes: true,
    disable_session_recording: true,
    disable_surveys: true,
    disable_product_tours: true,
    disable_conversations: true,
    disable_web_experiments: true,
    advanced_disable_flags: true,
    capture_dead_clicks: false,
    capture_heatmaps: false,
    enable_heatmaps: false,
    capture_exceptions: false,
    capture_performance: false,
    // why: sem cookie, mesmo armazenamento do editor (mesma origem: a visita segue para o /editor)
    persistence: "localStorage",
    person_profiles: "identified_only",
    save_referrer: true,
    respect_dnt: true,
    before_send: beforeSend,
  };
}

/** before_send: descarta evento fora da lista, limpa propriedades e $set, e desliga a localização. */
export function landingBeforeSend(event) {
  if (!event || typeof event !== "object") return null;
  if (!LANDING_SDK_EVENTS.includes(event.event)) return null;
  const out = { ...event, properties: sanitizeProperties(event.properties) };
  out.properties.product = POSTHOG_PRODUCT;
  out.properties.surface = LANDING_SURFACE;
  // why: sem localização aproximada (país/coordenadas) a partir do IP, igual ao editor e ao player /p
  out.properties.$geoip_disable = true;
  if (event.$set) out.$set = sanitizeProperties(event.$set);
  if (event.$set_once) out.$set_once = sanitizeProperties(event.$set_once);
  if (looksLikePii(String(out.properties.distinct_id || ""))) return null;
  return out;
}

/* ---------- CTAs ---------- */

/** Elementos que contam como CTA: botões, links para o editor/extensão/cortesia ou data-cta-id explícito. */
export const CTA_SELECTOR =
  '[data-cta-id], a.btn, button.btn, a[href^="/editor"], a[href*="chromewebstore.google.com"], a[href^="/cortesia"]';

const SECTION_NAMES = {
  topo: "nav",
  precos: "pricing",
  pricing: "pricing",
  demo: "demo",
  "dois-caminhos": "paths",
  usos: "uses",
  casos: "cases",
  "como-funciona": "how",
  recursos: "features",
  integracao: "integrations",
  faq: "faq",
  "criar-com-ajuda": "assist",
  "final-cta": "final",
  hero: "hero",
};

/** Seção do CTA: nav, hero, pricing, demo, footer… (id/classe da seção; "page" se não houver). */
export function sectionOf(el) {
  if (!el || typeof el.closest !== "function") return "page";
  if (el.closest("header")) return "nav";
  if (el.closest("footer")) return "footer";
  const holder = el.closest("[data-cta-section]");
  if (holder) return String(holder.getAttribute("data-cta-section"));
  const sec = el.closest("section");
  if (!sec) return "page";
  const id = sec.id || "";
  if (id && SECTION_NAMES[id]) return SECTION_NAMES[id];
  const cls = String(sec.className || "").split(/\s+/).find((c) => SECTION_NAMES[c]);
  if (cls) return SECTION_NAMES[cls];
  return id || "page";
}

/** Tipo do destino: start, pro, assist, example, gallery, extension, demo, cortesia… */
export function ctaKind(href, origin = "https://guiaflow.pro") {
  const raw = String(href || "").trim();
  if (!raw) return "button";
  if (raw === "#demo") return "demo";
  if (raw.startsWith("#")) return raw.slice(1) || "anchor";
  let url;
  try {
    url = new URL(raw, origin);
  } catch {
    return "link";
  }
  if (/chromewebstore\.google\.com$/.test(url.hostname)) return "extension";
  if (url.origin !== new URL(origin).origin) return "external";
  const path = url.pathname.replace(/\/+$/, "");
  if (path === "/editor") {
    if (url.searchParams.get("pro") === "1") return "pro";
    if (url.searchParams.get("novo") === "ajuda") return "assist";
    return "start";
  }
  if (/\/exemplos\/galeria$/.test(path)) return "gallery";
  if (/\/exemplos\//.test(path)) return "example";
  if (path === "/cortesia") return "cortesia";
  const last = path.split("/").filter(Boolean).pop();
  return last ? last.replace(/[^a-z0-9]+/gi, "_").toLowerCase() : "home";
}

function cleanText(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim().slice(0, 80);
  return t && !looksLikePii(t) ? t : "";
}

/** { cta_id, cta_text, section, destination_url } do elemento clicado, ou null se não for CTA. */
export function ctaFromElement(target, origin = "https://guiaflow.pro") {
  if (!target || typeof target.closest !== "function") return null;
  const el = target.closest(CTA_SELECTOR);
  if (!el || el.closest(".ph-no-capture")) return null;
  const href = el.getAttribute("href") || "";
  const section = sectionOf(el);
  const explicit = el.getAttribute("data-cta-id");
  const cta_id = explicit || `${section}_${ctaKind(href, origin)}`;
  let destination_url = null;
  if (href && !href.startsWith("#")) {
    try {
      const url = new URL(href, origin);
      // sem query nem hash (sanitizeProperties também limpa)
      destination_url = `${url.origin}${url.pathname}`;
    } catch {
      destination_url = null;
    }
  }
  const out = { cta_id, cta_text: cleanText(el.textContent), section };
  if (destination_url) out.destination_url = destination_url;
  return out;
}

/**
 * signup_started a partir do CTA. Conta GuiaFlow só nasce pela assinatura Pro (checkout no editor,
 * /editor?pro=1); o login por e-mail/senha ou link mágico acontece dentro do editor, fora da landing.
 */
export function signupFromCta(cta, href, origin = "https://guiaflow.pro") {
  if (!cta) return null;
  return ctaKind(href, origin) === "pro" ? { method: "checkout", source_cta_id: cta.cta_id } : null;
}

/* ---------- SDK ---------- */

async function defaultFetchConfig() {
  const res = await fetch(POSTHOG_CONFIG_PATH, { headers: { Accept: "application/json" }, credentials: "omit" });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return data?.posthog || null;
}

function defaultLoadSdk() {
  return import("../vendor/posthog/module.no-external.js");
}

/**
 * opts: { pathname, fetchConfig, loadSdk, privacy: { dnt, windowDnt, msDnt, gpc } }
 * → { ready: Promise<boolean>, capture(event, props) }. Nunca lança. Fora das páginas do site, não faz nada.
 */
export function createLandingPosthog(opts = {}) {
  const fetchConfig = opts.fetchConfig || defaultFetchConfig;
  const loadSdk = opts.loadSdk || defaultLoadSdk;
  let ph = null;
  const queue = [];

  const ready = (async () => {
    if (!isLandingPath(opts.pathname)) return false;
    if (privacySignal(opts.privacy || {})) return false;
    let config = null;
    try {
      config = readPosthogConfig(await fetchConfig());
    } catch {
      config = null;
    }
    if (!config) return false;
    try {
      const mod = await loadSdk();
      const sdk = mod?.default || mod?.posthog || mod;
      if (!sdk || typeof sdk.init !== "function") return false;
      sdk.init(config.key, landingInitOptions(config, { beforeSend: landingBeforeSend }));
      sdk.register({ product: POSTHOG_PRODUCT, surface: LANDING_SURFACE });
      ph = sdk;
      for (const [event, props] of queue.splice(0)) ph.capture(event, props);
      return true;
    } catch {
      ph = null;
      return false;
    }
  })();

  return {
    ready,
    capture(event, props = {}) {
      if (!LANDING_CUSTOM_EVENTS.includes(event)) return;
      if (ph) ph.capture(event, props);
      else if (queue.length < 20) queue.push([event, props]);
    },
  };
}

/* ---------- DOM ---------- */

/** Liga cta_click/signup_started (cliques), pricing_viewed (seção de preços na tela) e demo_play (demo da home). */
export function wireLanding(doc, win, ph) {
  if (!doc || !ph) return;
  const origin = win?.location?.origin || "https://guiaflow.pro";

  doc.addEventListener(
    "click",
    (event) => {
      const cta = ctaFromElement(event.target, origin);
      if (!cta) return;
      ph.capture("cta_click", cta);
      const el = event.target.closest(CTA_SELECTOR);
      const signup = signupFromCta(cta, el?.getAttribute("href"), origin);
      if (signup) ph.capture("signup_started", signup);
    },
    true,
  );

  // pedido de acesso Pro em troca de feedback (/cortesia): o primeiro passo de cadastro que a landing vê
  doc.addEventListener(
    "submit",
    (event) => {
      if (event.target?.id === "courtesy-form") {
        ph.capture("signup_started", { method: "cortesia_request", source_cta_id: "cortesia_form" });
      }
    },
    true,
  );

  const pricing = doc.querySelector("section.pricing, #precos");
  if (pricing && win && typeof win.IntersectionObserver === "function") {
    const observer = new win.IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      observer.disconnect();
      const highlighted = pricing.querySelector(".plan-pro") ? "pro" : "none";
      ph.capture("pricing_viewed", { plan_highlighted: highlighted });
    }, { threshold: 0.3 });
    observer.observe(pricing);
  }

  // demo da home (iframe do guia de exemplo): o clique dentro do iframe tira o foco da página
  const frame = doc.getElementById("demo-frame");
  if (frame && win) {
    let played = false;
    win.addEventListener("blur", () => {
      setTimeout(() => {
        const active = doc.activeElement;
        if (played || !active || active.tagName !== "IFRAME" || !frame.contains(active)) return;
        played = true;
        ph.capture("demo_play", { demo_id: frame.getAttribute("data-demo-id") || "guia" });
      }, 0);
    });
  }
}
