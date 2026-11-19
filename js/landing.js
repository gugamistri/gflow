/**
 * Landing (/). why: página leve, sem framework. O português está no HTML; es/en vêm de
 * landing-i18n.js pelo mesmo catálogo/seletor do editor (ns-locale), como a /ajuda.
 * Preços saem de paywall.js — a mesma fonte do diálogo Pro do editor.
 */
import { applyI18n, bindLocaleSelect, catalogs, getLocale, initLocale, t } from "./i18n.js";
import { landingCatalogs } from "./landing-i18n.js";
import { formatPaywallAmount, paywallCurrency, paywallOffer } from "./paywall.js";
import { captureAttribution, noteLandingView } from "./attribution.js";
import { landingExampleHref } from "./exampleTours.js";

/** Id do guia empacotado na seção #demo (data/demo.json, modo Tour guiado). */
export const LANDING_DEMO_EXAMPLE = "guia";
/** Id da galeria empacotada no card "Galeria" (data/examples/galeria-produto.json). */
export const LANDING_GALLERY_EXAMPLE = "galeria";

/** URL do iframe (?embed=1) do guia de exemplo, com ?lang= em /en e /es. */
export function landingDemoUrl(id = LANDING_DEMO_EXAMPLE, locale = "pt") {
  return landingExampleHref(id, { locale, embed: true });
}

/**
 * Link do card "Galeria": /exemplos/galeria, com ?lang= em /en e /es
 * para a interface e o conteúdo do player seguirem o idioma da página.
 */
export function landingGalleryHref(id = LANDING_GALLERY_EXAMPLE, locale = "pt") {
  return landingExampleHref(id, { locale });
}

function mountGalleryExample() {
  const link = document.querySelector("[data-gallery-example]");
  const href = landingGalleryHref(LANDING_GALLERY_EXAMPLE, getLocale());
  if (!link || !href) return;
  link.href = href;
  link.setAttribute("data-i18n", "lp.paths.gallery.view");
  link.textContent = t("lp.paths.gallery.view");
}

function mountDemoOpen() {
  const href = landingExampleHref(LANDING_DEMO_EXAMPLE, { locale: getLocale() });
  if (!href) return;
  // hero "Ver um exemplo" e o botão "Abrir o guia" da seção #demo
  for (const link of document.querySelectorAll("[data-demo-example]")) link.href = href;
}

function mountDemo() {
  const frame = document.getElementById("demo-frame");
  const src = landingDemoUrl(LANDING_DEMO_EXAMPLE, getLocale());
  if (!frame || !src) return;
  const iframe = document.createElement("iframe");
  iframe.src = src;
  iframe.title = t("lp.demo.frameTitle");
  iframe.setAttribute("data-i18n-title", "lp.demo.frameTitle");
  iframe.loading = "lazy";
  iframe.allow = "autoplay; fullscreen; screen-wake-lock";
  iframe.referrerPolicy = "strict-origin-when-cross-origin";
  frame.replaceChildren(iframe);
}

const ATTRS = [
  ["data-i18n", null],
  ["data-i18n-html", "html"],
  ["data-i18n-aria", "aria-label"],
  ["data-i18n-placeholder", "placeholder"],
  ["data-i18n-title", "title"],
];

/** O HTML já é o texto em pt: vira o catálogo pt, sem duplicar as frases em JS. */
export function harvestPortuguese(root = document) {
  const out = {};
  for (const [attr, mode] of ATTRS) {
    for (const el of root.querySelectorAll(`[${attr}]`)) {
      const key = el.getAttribute(attr);
      if (!key || !key.startsWith("lp.") || key in out) continue;
      if (el.tagName === "TITLE") out[key] = el.textContent.trim();
      else if (mode === "html") out[key] = el.innerHTML.trim();
      else if (mode) out[key] = el.getAttribute(mode) || "";
      else out[key] = el.textContent.trim();
    }
  }
  return out;
}

function installCatalogs() {
  Object.assign(catalogs.pt, harvestPortuguese(document), landingCatalogs.pt || {});
  for (const loc of ["es", "en"]) Object.assign(catalogs[loc], landingCatalogs[loc] || {});
}

export function landingPrices(locale) {
  const currency = paywallCurrency(locale);
  const offer = paywallOffer(currency);
  return {
    currency,
    free: formatPaywallAmount(0, currency, locale),
    month: formatPaywallAmount(offer.month, currency, locale),
    year: formatPaywallAmount(offer.year, currency, locale),
    freeMonths: offer.freeMonths,
  };
}

function paintPrices() {
  const locale = getLocale();
  const prices = landingPrices(locale);
  for (const el of document.querySelectorAll('[data-price="month"]')) el.textContent = prices.month;
  for (const el of document.querySelectorAll('[data-price="year"]')) el.textContent = prices.year;
  for (const el of document.querySelectorAll('[data-i18n="lp.plan.free.price"]')) el.textContent = prices.free;
  for (const el of document.querySelectorAll("[data-free-months]")) {
    el.textContent = t("billing.freeMonths", { n: prices.freeMonths });
  }
}

/* ---------- Extensão de captura ---------- */

function goEditor() {
  location.replace(`/editor${location.search}${location.hash}`);
}

/**
 * why: a extensão abre (ou reaproveita) qualquer aba de guiaflow.pro para entregar a captura.
 * Sem ?landing=1, quem tem a extensão já foi para /editor no <head>; aqui cobrimos o sinal
 * que chega depois do script inline. Com ?landing=1 aberto, esta aba responde como pronta e,
 * se a captura chegar aqui, passa para /editor sem confirmar — o handoff continua guardado
 * na extensão e o editor o recebe ao carregar.
 */
function wireExtension() {
  const root = document.documentElement;
  const forced = Boolean(window.__gfLandingForced);
  const present = () => root.getAttribute("data-guia-extension") === "1";

  if (!forced) {
    root.addEventListener("guia-extension-present", goEditor, { once: true });
    return;
  }

  let armed = false;
  const arm = () => {
    if (armed || !present()) return;
    armed = true;
    root.dataset.guiaReady = "1";
    window.postMessage({ source: "guia-editor", type: "guia-ready" }, location.origin);
  };
  const isCapture = (data) =>
    data && data.source === "guia-capture" && (data.type === "import-project" || data.type === "append-steps");
  const forward = () => {
    const keep = new URL(location.href);
    keep.searchParams.delete("landing");
    location.replace(`/editor${keep.search}`);
  };
  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin) return;
    if (isCapture(event.data)) forward();
  });
  document.addEventListener("guia-capture-handoff", (event) => {
    if (isCapture(event.detail)) forward();
  });
  root.addEventListener("guia-extension-present", arm);
  arm();
}

function boot() {
  installCatalogs();
  initLocale();
  mountDemo();
  mountDemoOpen();
  mountGalleryExample();
  if (getLocale() !== "pt") applyI18n(document);
  paintPrices();
  bindLocaleSelect(document.getElementById("locale-select"), () => paintPrices());
  wireExtension();
  // medição GTM: visita à home, uma vez por sessão (nada com DNT/GPC)
  noteLandingView();
}

// medição GTM: guarda utm_* da visita (localStorage, 90 dias; nada com DNT/GPC)
if (typeof document !== "undefined") captureAttribution();
if (typeof document !== "undefined" && document.querySelector(".hero")) boot();
