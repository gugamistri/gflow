/**
 * Landing (/). why: página leve, sem framework. O português está no HTML; es/en vêm de
 * landing-i18n.js pelo mesmo catálogo/seletor do editor (ns-locale), como a /ajuda.
 * Preços saem de paywall.js — a mesma fonte do diálogo Pro do editor.
 */
import { applyI18n, bindLocaleSelect, catalogs, getLocale, initLocale, t } from "./i18n.js";
import { landingCatalogs } from "./landing-i18n.js";
import { formatPaywallAmount, paywallCurrency, paywallOffer } from "./paywall.js";

/**
 * Demo de exemplo da seção #demo: slug de um link permanente publicado (/p/<slug>).
 * why: é o único lugar a trocar quando o tour de exemplo mudar; vazio = placeholder, sem iframe.
 */
export const LANDING_DEMO_SLUG = "leadpronto-9e0052";
export const LANDING_DEMO_ORIGIN = "https://guiaflow.pro";
const DEMO_SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/;

/** URL do embed (?embed=1) ou "" se o slug estiver vazio ou fora do formato de /p. */
export function landingDemoUrl(slug = LANDING_DEMO_SLUG, origin = LANDING_DEMO_ORIGIN) {
  const clean = String(slug || "").trim();
  if (!DEMO_SLUG_RE.test(clean)) return "";
  return `${origin}/p/${encodeURIComponent(clean)}?embed=1`;
}

function mountDemo() {
  const frame = document.getElementById("demo-frame");
  const src = landingDemoUrl();
  if (!frame || !src) return;
  const iframe = document.createElement("iframe");
  iframe.src = src;
  iframe.title = t("lp.demo.frameTitle");
  iframe.setAttribute("data-i18n-title", "lp.demo.frameTitle");
  iframe.loading = "lazy";
  iframe.allow = "autoplay; fullscreen";
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

/* ---------- Pedido de acesso Pro (testers) ---------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function readTesterForm(form) {
  const data = new FormData(form);
  const get = (k) => String(data.get(k) || "").trim();
  return {
    name: get("name"),
    email: get("email"),
    company: get("company"),
    useCase: get("useCase"),
    linkedin: get("linkedin"),
    website: get("website"),
    consent: data.get("consent") === "on",
  };
}

export function validateTester(body) {
  if (!body.name) return "name";
  if (!EMAIL_RE.test(body.email)) return "email";
  if (!body.company) return "company";
  if (!body.useCase) return "useCase";
  if (body.linkedin) {
    try {
      const url = new URL(body.linkedin);
      if (url.protocol !== "https:" && url.protocol !== "http:") return "linkedin";
      if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) return "linkedin";
    } catch {
      return "linkedin";
    }
  }
  if (!body.consent) return "consent";
  return "";
}

function cloudBase() {
  const raw = typeof window.__GUIAFLOW_CLOUD__ === "string" ? window.__GUIAFLOW_CLOUD__.trim() : "";
  return raw.replace(/\/+$/, "");
}

function mailtoFallback(body) {
  const subject = "Pedido de acesso GuiaFlow Pro (tester)";
  const text = [
    `Nome: ${body.name}`,
    `E-mail: ${body.email}`,
    `Empresa/produto: ${body.company}`,
    `Uso: ${body.useCase}`,
    `LinkedIn: ${body.linkedin || "-"}`,
  ].join("\n");
  return `mailto:contato@guiaflow.pro?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
}

function wireTesterForm() {
  const form = document.getElementById("tester-form");
  const status = document.getElementById("tf-status");
  if (!form || !status) return;
  const fieldIds = {
    name: "tf-name",
    email: "tf-email",
    company: "tf-company",
    useCase: "tf-usecase",
    linkedin: "tf-linkedin",
    consent: "tf-consent",
  };
  const say = (kind, html) => {
    status.className = `form-status ${kind}`;
    status.innerHTML = html;
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    for (const id of Object.values(fieldIds)) document.getElementById(id)?.removeAttribute("aria-invalid");
    const body = readTesterForm(form);
    const bad = validateTester(body);
    if (bad) {
      const el = document.getElementById(fieldIds[bad]);
      el?.setAttribute("aria-invalid", "true");
      el?.focus();
      say("err", t(`lp.form.err.${bad}`));
      return;
    }
    const base = cloudBase();
    const button = form.querySelector('button[type="submit"]');
    const fail = () => say("err", t("lp.form.err.send", { mailto: mailtoFallback(body).replace(/"/g, "%22") }));
    if (!base) {
      fail();
      return;
    }
    button.disabled = true;
    say("", t("lp.form.sending"));
    try {
      const res = await fetch(`${base}/api/pro-requests`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          ...body,
          locale: getLocale(),
          consentText: document.querySelector('[data-i18n-html="lp.form.consent"]')?.textContent?.trim() || "",
        }),
      });
      if (res.status === 201 || res.ok) {
        form.reset();
        say("ok", t("lp.form.ok"));
      } else if (res.status === 429) {
        say("err", t("lp.form.err.rate"));
      } else {
        fail();
      }
    } catch {
      fail();
    } finally {
      button.disabled = false;
    }
  });
}

function boot() {
  installCatalogs();
  initLocale();
  mountDemo();
  if (getLocale() !== "pt") applyI18n(document);
  paintPrices();
  bindLocaleSelect(document.getElementById("locale-select"), () => paintPrices());
  wireExtension();
  wireTesterForm();
}

if (typeof document !== "undefined" && document.getElementById("tester-form")) boot();
