/**
 * Páginas /v/:id e /p/:slug — o mesmo preview somente leitura.
 */
import { applyTheme, normalizeSteps, resolveImageSrc } from "./store.js";
import { ensureNarration, ensurePlayback } from "./playback.js";
import { createPlayer } from "./player.js";
import { getLocale, initLocale, applyI18n, setLocale, SUPPORTED_LOCALES, t } from "./i18n.js";
import { applyDocumentLang, createLangMenu, readStoredLangs, resolvePlayerLangs, storeLangs } from "./langMenu.js";
import { setCaptions } from "./playerControls.js";
import { baseLang, langLabel, resolveContent } from "./tour-schema/i18n.js";
import { CLOUD_EVENTS_PATH, getCloudBaseUrl, getCloudFlags, isCloudEnabled, PUBLISHED_CLOUD_BASE } from "./cloudConfig.js";
import { createViewTracker, ctaFromAction, defaultSender, deviceKind, leadAttribution, shortLocale, shouldTrack, trafficSource } from "./viewAnalytics.js";
import { resolveShareMedia } from "./shareMedia.js";
import {
  decideEscape,
  embedShowsCover,
  parseEmbedOptions,
  parseViewRoute,
  permanentShareEndpoint,
  sameOriginReferrer,
  clickClosesSharedTour,
  sharePageTitle,
  shareBranding,
  shareStartIndex,
  sharedPreviewBackTarget,
  tourFromPermanentShare,
} from "./viewShare.js";
import { endStepActive, leadPhoneDefaultIso, normalizeEndStep, startStepActive } from "./fixedSteps.js";
import { cardShell, renderContactForm, renderEndCard, renderStartCard } from "./fixedStepsView.js";

function showStatus(message) {
  const status = document.getElementById("view-share-status");
  const text = document.getElementById("view-share-status-text");
  const frame = document.getElementById("canvas-frame");
  if (text) text.textContent = message;
  if (status) status.hidden = false;
  if (frame) frame.hidden = true;
  const title = document.getElementById("topbar-title");
  if (title) title.textContent = message;
}

function hideStatus() {
  const status = document.getElementById("view-share-status");
  const frame = document.getElementById("canvas-frame");
  if (status) status.hidden = true;
  if (frame) frame.hidden = false;
}

function toast(msg) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.hidden = true;
  }, 2800);
}

function bootMeta() {
  return typeof window !== "undefined" ? window.__GF_SHARE : null;
}

function viewRoute() {
  return parseViewRoute(location.pathname, bootMeta());
}

async function loadTemporary(id) {
  const metaRes = await fetch(`/api/share/${id}`);
  if (metaRes.status === 404) {
    throw Object.assign(new Error("not_found"), { code: "not_found" });
  }
  if (!metaRes.ok) {
    const data = await metaRes.json().catch(() => ({}));
    throw Object.assign(new Error(data.error || "load_failed"), { code: data.error });
  }
  const meta = await metaRes.json();
  if (!meta?.url) {
    throw Object.assign(new Error("not_found"), { code: "not_found" });
  }
  const tourRes = await fetch(meta.url);
  if (!tourRes.ok) {
    throw Object.assign(new Error("not_found"), { code: "not_found" });
  }
  return tourRes.json();
}

async function loadPermanent(slug) {
  const endpoint = permanentShareEndpoint(getCloudBaseUrl() || PUBLISHED_CLOUD_BASE, slug);
  let res;
  try {
    res = await fetch(endpoint);
  } catch {
    throw Object.assign(new Error("load_failed"), { code: "load_failed" });
  }
  const data = await res.json().catch(() => null);
  if (res.status === 404 || data?.error === "not_found") {
    throw Object.assign(new Error("not_found"), { code: "not_found" });
  }
  const parsed = tourFromPermanentShare(data);
  if (!parsed.ok) {
    throw Object.assign(new Error(parsed.error), { code: parsed.error });
  }
  shareFeatures = parsed.features;
  shareServerBranding = parsed.branding;
  // why: /p v2 — áudio dos idiomas-alvo por referência; o navegador só baixa o que tocar
  return resolveShareMedia(parsed.tour, endpoint);
}

async function loadDemo(route) {
  if (route.kind === "permanent") return loadPermanent(route.id);
  return loadTemporary(route.id);
}

function fullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function findPlayerOverlay() {
  const dialog = document.querySelector("dialog[open]");
  if (dialog) return dialog;
  const nodes = document.querySelectorAll(
    "details[open], [data-player-overlay]:not([hidden]), .player-sheet.is-open, .player-panel.is-open"
  );
  for (const node of nodes) {
    if (node.closest(".driver-popover, .driver-overlay")) continue;
    return node;
  }
  return null;
}

function closePlayerOverlay(node) {
  if (!node) return false;
  if (node.tagName === "DIALOG" && typeof node.close === "function") {
    node.close();
    return true;
  }
  if (node.tagName === "DETAILS") {
    node.open = false;
    return true;
  }
  node.hidden = true;
  node.classList.remove("is-open");
  return true;
}

function backTarget() {
  let hasOpener = false;
  try {
    hasOpener = Boolean(window.opener && !window.opener.closed);
  } catch {
    hasOpener = Boolean(window.opener);
  }
  return sharedPreviewBackTarget({
    referrer: document.referrer,
    origin: location.origin,
    historyLength: history.length,
    hasOpener,
  });
}

function tryLeaveSharedPreview() {
  const target = backTarget();
  if (target === "close") {
    window.close();
    if (window.closed) return true;
    if (history.length > 1 && sameOriginReferrer(document.referrer, location.origin)) {
      history.back();
      return true;
    }
    return false;
  }
  if (target === "back") {
    history.back();
    return true;
  }
  return false;
}

let player = null;
/** Tracker do analytics; null quando não há rastreio (DNT/GPC, /v, preview). */
let tracker = null;
let demo = null;
/** Tour como publicado (origem + blocos i18n); `demo` é a visão no idioma escolhido. */
let sourceDemo = null;
let langState = null;
let langMenu = null;
let touring = false;
let replayTour = () => {};
let shareFeatures = { leadCapture: false, contactForm: false };
let shareServerBranding = null;
let shareSlug = "";
// why: o shell do /p já vem com ou sem a classe conforme o plano do dono (meta do Cloud)
let branding = document.documentElement.classList.contains("is-unbranded") ? "none" : "full";

function applyBranding(mode) {
  branding = mode;
  document.documentElement.classList.toggle("is-unbranded", mode !== "full");
  const credit = document.getElementById("view-credit");
  if (credit) credit.hidden = mode !== "credit";
}

// why: ?embed=1 = iframe no site do cliente; a classe também vem do <head> para não piscar
const embedOptions = parseEmbedOptions(location.search);
const isEmbed = embedOptions.embed;

function setupEmbedChrome() {
  if (!isEmbed) return;
  document.documentElement.classList.add("is-embed");
  document.body?.classList.add("is-embed");
  // why: o logo não pode levar o iframe para o editor; abre o site numa aba nova
  for (const link of document.querySelectorAll(".topbar .logo")) {
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener");
  }
  const hint = document.getElementById("present-chrome");
  if (hint) hint.hidden = true;
}
setupEmbedChrome();

function shareTitle(name) {
  return sharePageTitle(name, t("view.title"), { branded: branding === "full" });
}

function applyShareTitle(name) {
  const label = String(name || "").trim();
  document.title = shareTitle(label);
  const titleEl = document.getElementById("topbar-title");
  if (titleEl && label) titleEl.textContent = label;
  const closedTitle = document.getElementById("view-share-closed-title");
  if (closedTitle && label) closedTitle.textContent = label;
}

function focusShareDocument() {
  // why: foco automático dentro do iframe rola a página do cliente até o tour
  if (isEmbed) return;
  const root = document.body;
  if (!root) return;
  if (root.tabIndex < 0) root.tabIndex = -1;
  const active = document.activeElement;
  if (active && active !== root && active !== document.documentElement) {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) || active.isContentEditable) return;
  }
  root.focus({ preventScroll: true });
}

function showClosedState() {
  touring = false;
  player?.stop?.({ silent: true });
  document.body.classList.remove("is-presenting");
  document.getElementById("view-editor")?.classList.remove("is-presenting");
  const hint = document.getElementById("present-chrome");
  if (hint) hint.hidden = true;
  const frame = document.getElementById("canvas-frame");
  if (frame) frame.hidden = true;
  const status = document.getElementById("view-share-status");
  if (status) status.hidden = true;
  const cover = document.getElementById("view-share-cover");
  if (cover) cover.hidden = true;
  hideFixedCard();
  const closed = document.getElementById("view-share-closed");
  if (closed) closed.hidden = false;
  // why: WCAG 2.4.3 — depois de sair (Esc/fechar) o foco vai para "Ver tour novamente"
  const replay = document.getElementById("view-share-replay");
  if (replay && !isEmbed) {
    replay.focus({ preventScroll: true });
    return;
  }
  focusShareDocument();
}

function hideFixedCard() {
  const host = document.getElementById("view-share-fixed");
  if (!host) return;
  host.hidden = true;
  host.replaceChildren();
}

/** Palco limpo para um cartão fixo (início ou fim): sem player, capa ou estado final. */
function showFixedCard(card) {
  touring = false;
  player?.stop?.({ silent: true });
  document.body.classList.remove("is-presenting");
  document.getElementById("view-editor")?.classList.remove("is-presenting");
  const hint = document.getElementById("present-chrome");
  if (hint) hint.hidden = true;
  for (const id of ["canvas-frame", "view-share-status", "view-share-cover", "view-share-closed"]) {
    const node = document.getElementById(id);
    if (node) node.hidden = true;
  }
  const host = document.getElementById("view-share-fixed");
  if (!host) return false;
  host.replaceChildren(card);
  host.hidden = false;
  if (!isEmbed) card.querySelector("a, button, input")?.focus({ preventScroll: true });
  return true;
}

/** Endereço do tour para {link}: a página atual sem query (no embed também é o /p). */
function tourLink() {
  return `${location.origin}${location.pathname}`;
}

const fixedState = { lead: null };

function leadStorageKey() {
  return `gf.lead.${shareSlug}`;
}

function readStoredLead() {
  try {
    const raw = sessionStorage.getItem(leadStorageKey());
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function storeLead(value) {
  try {
    sessionStorage.setItem(leadStorageKey(), JSON.stringify(value));
  } catch {
    /* sessão privada: o gate volta a aparecer, sem prejuízo */
  }
}

/** Corpo do lead com o idioma visto e a origem (utm_* e referrerHost) para o webhook. */
function leadBody(value) {
  const body = value && typeof value === "object" ? { ...value } : {};
  if (langState) body.lang = langState.text;
  const referrer = typeof document !== "undefined" ? document.referrer : "";
  const search = typeof location !== "undefined" ? location.search : "";
  const origin = typeof location !== "undefined" ? location.origin : "";
  return { ...body, ...leadAttribution(referrer, search, origin) };
}

/** POST público do link permanente (leads ou contact); sem cookies nem token. */
async function postShare(kind, body) {
  const endpoint = `${permanentShareEndpoint(getCloudBaseUrl() || PUBLISHED_CLOUD_BASE, shareSlug)}/${kind}`;
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      credentials: "omit",
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data, error: data?.error || "" };
  } catch {
    return { ok: false, error: "network" };
  }
}

function endCard() {
  const step = normalizeEndStep(demo.endStep);
  return renderEndCard(step, {
    tour: String(demo?.name || "").trim(),
    link: tourLink(),
    nome: fixedState.lead?.name || "",
    contactForm: Boolean(shareSlug && shareFeatures.contactForm),
    onReplay: () => replayTour(),
    onAction: (action) => tracker?.ctaClick(ctaFromAction(action)),
    onContactForm: () => {
      const card = cardShell("end");
      card.append(
        renderContactForm({
          consentText: step.contact.consentText,
          phoneCountry: leadPhoneCountry(),
          prefill: fixedState.lead || {},
          onSubmit: (value) => postShare("contact", leadBody(value)),
          onCancel: () => showFixedCard(endCard()),
        })
      );
      showFixedCard(card);
    },
  });
}

function showEndStep() {
  const card = endCard();
  const shown = showFixedCard(card);
  if (shown && card.querySelector(".fixed-card-actions")) tracker?.ctaView();
  return shown;
}

/** Analytics (F4): só /p e embed, com a Cloud, sem DNT/GPC e fora do ?preview=1 do editor. */
function startTracking(route) {
  const nav = typeof navigator !== "undefined" ? navigator : {};
  const ok = shouldTrack({
    kind: route?.kind,
    cloudEnabled: isCloudEnabled() || route?.kind === "permanent",
    flags: isCloudEnabled() ? getCloudFlags() : null,
    dnt: nav.doNotTrack,
    windowDnt: window.doNotTrack,
    msDnt: nav.msDoNotTrack,
    gpc: nav.globalPrivacyControl,
    search: location.search,
  });
  if (!ok || !shareSlug) return null;
  const endpoint = `${getCloudBaseUrl() || PUBLISHED_CLOUD_BASE}${CLOUD_EVENTS_PATH(shareSlug)}`;
  const coarse = Boolean(window.matchMedia?.("(pointer: coarse)")?.matches);
  const t = createViewTracker({
    send: defaultSender(endpoint),
    embed: isEmbed,
    // why: no embed o referrer é a página do cliente (só o host é enviado)
    source: trafficSource(document.referrer, location.search, location.origin),
    device: deviceKind({ coarse, width: window.innerWidth || 0 }),
    locale: shortLocale(document.documentElement.lang || nav.language),
    langs: langState,
  });
  document.addEventListener("visibilitychange", () => t.visibility(document.visibilityState === "hidden"));
  window.addEventListener("pagehide", () => t.pagehide());
  return t;
}

/** Passo inicial (Pro): só no /p, com o recurso ativo no servidor, uma vez por sessão. */
function startGateNeeded() {
  if (!shareSlug || !shareFeatures.leadCapture || !startStepActive(demo?.startStep)) return false;
  return !readStoredLead();
}

/** País inicial do telefone do visitante: o do WhatsApp do passo final; senão o do idioma. */
function leadPhoneCountry() {
  const nav = typeof navigator !== "undefined" ? navigator : {};
  return leadPhoneDefaultIso(demo?.endStep, getLocale(), nav.languages?.length ? nav.languages : [nav.language].filter(Boolean));
}

function showStartStep(next) {
  const card = renderStartCard(demo.startStep, {
    phoneCountry: leadPhoneCountry(),
    onSubmit: async (value) => {
      // RF30: o servidor grava o consentimento no idioma que o visitante viu
      const res = await postShare("leads", leadBody(value));
      if (res.ok) {
        // why: o id do lead só existe com consentimento (obrigatório no envio) — o analytics pode usá-lo
        const lead = { leadId: String(res.data?.leadId || ""), name: value.name || "", email: value.email || "", phone: value.phone || "" };
        fixedState.lead = lead;
        storeLead({ leadId: lead.leadId, name: lead.name });
        if (lead.leadId) {
          window.__GF_LEAD = { slug: shareSlug, leadId: lead.leadId, consent: true };
          tracker?.lead(lead.leadId);
        }
        hideFixedCard();
        next();
      }
      return res;
    },
    onSkip: () => {
      storeLead({ skipped: true });
      hideFixedCard();
      next();
    },
  });
  showFixedCard(card);
}

function coverImageSrc() {
  const steps = Array.isArray(demo?.steps) ? demo.steps : [];
  for (const step of steps) {
    if (step?.type === "slide" || !step?.image) continue;
    const src = resolveImageSrc(demo, step.image);
    if (src) return src;
  }
  return "";
}

/** Capa do embed: nada toca (nem áudio) antes do clique em ▶. */
function showCover(onStart) {
  touring = false;
  document.body.classList.remove("is-presenting");
  document.getElementById("view-editor")?.classList.remove("is-presenting");
  const frame = document.getElementById("canvas-frame");
  if (frame) frame.hidden = true;
  const status = document.getElementById("view-share-status");
  if (status) status.hidden = true;
  const closed = document.getElementById("view-share-closed");
  if (closed) closed.hidden = true;
  hideFixedCard();
  const cover = document.getElementById("view-share-cover");
  if (!cover) {
    onStart();
    return;
  }
  const img = document.getElementById("view-share-cover-image");
  const src = coverImageSrc();
  if (img) {
    if (src) {
      img.src = src;
      img.hidden = false;
    } else {
      img.hidden = true;
    }
  }
  const title = document.getElementById("view-share-cover-title");
  if (title) title.textContent = String(demo?.name || "").trim();
  cover.hidden = false;
  const play = document.getElementById("view-share-cover-play");
  play?.addEventListener(
    "click",
    () => {
      cover.hidden = true;
      onStart();
    },
    { once: true }
  );
}

function showTouring() {
  touring = true;
  const closed = document.getElementById("view-share-closed");
  if (closed) closed.hidden = true;
  const cover = document.getElementById("view-share-cover");
  if (cover) cover.hidden = true;
  hideFixedCard();
  document.body.classList.add("is-presenting");
  document.getElementById("view-editor")?.classList.add("is-presenting");
  document.getElementById("hotspot")?.classList.add("is-previewing");
  const hint = document.getElementById("present-chrome");
  if (hint) hint.hidden = isEmbed;
  hideStatus();
  focusShareDocument();
}

function exitSharedTour(reason) {
  if (!touring) return;
  // why: passo final ao concluir (e no embed, onde sair não pode mexer na página do cliente)
  if (endStepActive(demo?.endStep) && (reason === "complete" || isEmbed) && showEndStep()) return;
  // why: no embed nunca history.back() nem window.close() — isso mexeria na página do cliente
  if (!isEmbed) {
    // why: voltar/fechar a aba é assíncrono; a narração não pode seguir tocando até lá
    player?.stop?.({ silent: true });
    if (tryLeaveSharedPreview()) return;
  }
  showClosedState();
}

/** Saída pedida pela página (Esc, clique fora): o player reporta o motivo ao onExit. */
function requestSharedExit(reason) {
  if (player?.exit) {
    player.exit(reason);
    return;
  }
  exitSharedTour();
}

function onSharedEscape(event) {
  if (event.key !== "Escape") return;
  if (!touring) return;
  const action = decideEscape({
    fullscreen: Boolean(fullscreenElement()),
    overlay: Boolean(findPlayerOverlay()),
    back: isEmbed ? false : Boolean(backTarget()),
    embed: isEmbed,
  });
  event.preventDefault();
  event.stopImmediatePropagation();
  if (action === "fullscreen") {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    exit?.call(document);
    return;
  }
  if (action === "overlay") {
    closePlayerOverlay(findPlayerOverlay());
    return;
  }
  if (!action) return;
  requestSharedExit("esc");
}

// why: Esc tem de chegar mesmo sem foco no cartão e antes do driver
window.addEventListener("keydown", onSharedEscape, true);

// why: o listener do Driver só fecha se o alvo for o path do SVG; no slide o clique
// cai na área escura e é engolido. Na janela, em captura, corre antes disso.
window.addEventListener(
  "pointerdown",
  (event) => {
    if (!touring || event.button !== 0) return;
    if (!clickClosesSharedTour(event.target, { embed: isEmbed })) return;
    // why: a folga do recorte em volta do destaque é clique no destaque (= Próximo), não fora
    if (player?.highlightContains?.(event.clientX, event.clientY)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    // why: no toque, só um toque parado fecha; deslizar (trocar de passo) não pode sair do tour
    if (event.pointerType === "touch") {
      pendingTouchExit = { id: event.pointerId, x: event.clientX, y: event.clientY, at: Date.now() };
      return;
    }
    requestSharedExit("click_outside");
  },
  true
);

let pendingTouchExit = null;
window.addEventListener(
  "pointerup",
  (event) => {
    const p = pendingTouchExit;
    if (!p || p.id !== event.pointerId) return;
    pendingTouchExit = null;
    if (!touring) return;
    const moved = Math.hypot(event.clientX - p.x, event.clientY - p.y);
    if (moved > 12 || Date.now() - p.at > 800) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    requestSharedExit("click_outside");
  },
  true
);
window.addEventListener("pointercancel", () => { pendingTouchExit = null; }, true);

let onLangSwitch = () => {};

/** Visão do tour para { text, audio, cc } (§4.1). */
export function viewForLang(source, state) {
  // why: a legenda (cc) liga/desliga por CSS no botão CC, sem reconstruir a visão nem reiniciar o passo
  return resolveContent(source, state.text, { audioLang: state.audio });
}

function langChromeLocale(lang) {
  const base = baseLang(lang);
  return SUPPORTED_LOCALES.includes(base) ? base : "en";
}

function applyLangState(next, { initial = false } = {}) {
  const prev = langState;
  langState = next;
  setCaptions(next.cc);
  const ccOnly = !initial && prev && prev.text === next.text && prev.audio === next.audio;
  if (ccOnly) {
    storeLangs(shareSlug || viewRoute()?.id || "v", next);
    langMenu?.paint();
    tracker?.langChange?.(next);
    return;
  }
  demo = viewForLang(sourceDemo, next);
  storeLangs(shareSlug || viewRoute()?.id || "v", next);
  // why: botões e rótulos do player seguem o idioma do texto quando há catálogo (§4.1)
  setLocale(langChromeLocale(next.text), { persist: false });
  applyI18n(document);
  applyDocumentLang(next.text);
  if (!initial) applyShareTitle(demo.name || "");
  langMenu?.paint();
  const fallback = next.audio !== "none" && demo.audioFallback?.length;
  if (fallback && (initial || prev?.audio !== next.audio)) {
    toast(t("player.audioFallback", { lang: langLabel(next.audio), source: langLabel(sourceDemo.i18n.defaultLang) }));
  }
  if (!initial) {
    tracker?.langChange?.(next);
    onLangSwitch();
  }
}

function setupLanguages(route) {
  sourceDemo = demo;
  const nav = typeof navigator !== "undefined" ? navigator : {};
  const state = resolvePlayerLangs(sourceDemo, {
    search: location.search,
    stored: readStoredLangs(shareSlug || route?.id || "v"),
    languages: nav.languages?.length ? nav.languages : [nav.language].filter(Boolean),
  });
  if (!state) return;
  langMenu = createLangMenu({ demo: sourceDemo, getState: () => langState, onChange: (s) => applyLangState(s) });
  applyLangState(state, { initial: true });
}

function mountLangMenu(tries = 30) {
  if (!langMenu || langMenu.isMounted()) return;
  const host = document.querySelector(".gf-player-controls");
  if (host) langMenu.mount(host);
  else if (tries > 0) requestAnimationFrame(() => mountLangMenu(tries - 1));
}

async function boot() {
  initLocale();
  applyI18n(document);

  const shareBoot = bootMeta();
  if (shareBoot?.missing) {
    showStatus(t("view.missing"));
    document.title = t("view.missing");
    return;
  }
  if (shareBoot?.name) applyShareTitle(shareBoot.name);
  else document.title = t("view.title");

  const route = viewRoute();
  if (!route) {
    showStatus(t("view.missing"));
    return;
  }

  if (route.kind === "permanent") shareSlug = route.id;
  // why: no /p mantém o que o shell decidiu até o tour chegar (sem piscar o logo)
  if (route.kind !== "permanent") applyBranding("full");
  try {
    demo = await loadDemo(route);
  } catch (err) {
    console.error(err);
    showStatus(err?.code === "not_found" || err?.code === "blob_not_configured" ? t("view.missing") : t("share.errGeneric"));
    return;
  }

  if (!demo || !Array.isArray(demo.steps) || !demo.steps.length) {
    showStatus(t("view.missing"));
    return;
  }

  normalizeSteps(demo.steps);
  ensurePlayback(demo);
  ensureNarration(demo);
  applyTheme(demo.theme);
  setupLanguages(route);

  applyBranding(shareBranding(route.kind, demo, shareServerBranding));
  applyShareTitle(demo.name || shareBoot?.name || "");

  // why: o índice do editor no storage não pode abrir o link no passo 2
  const initialIndex = shareStartIndex(location.search, demo.steps.length);
  let selectedIndex = initialIndex;

  player = createPlayer({
    getDemo: () => demo,
    toast,
    getSelectedIndex: () => selectedIndex,
    setSelectedIndex: (i) => {
      selectedIndex = i;
    },
    allowClose: true,
    ignoreAdvanceMs: 700,
    // why: no embed o clique no véu não fecha; o Driver ignora valores fora de close/nextStep
    overlayClickBehavior: isEmbed ? "none" : "close",
    onRequestExit: (info) => {
      exitSharedTour(info?.reason);
    },
    onStep: (info) => tracker?.onStep(info),
    onComplete: (info) => tracker?.onComplete(info),
    onExit: (info) => tracker?.onExit(info),
  });

  tracker = startTracking(route);

  replayTour = () => {
    selectedIndex = 0;
    showTouring();
    player.play({ from: 0, autoplay: true });
  };
  document.getElementById("view-share-replay")?.addEventListener("click", () => replayTour());

  onLangSwitch = () => {
    // why: a troca no meio do tour mantém o passo e reinicia o áudio dele (RF21)
    if (touring && player?.isRunning?.()) player.play({ from: selectedIndex, autoplay: player.isAutoplay?.() ?? true });
  };

  const startTour = () => {
    showTouring();
    mountLangMenu();
    requestAnimationFrame(() => {
      // why: tour publicado assiste sozinho; o 1º áudio retenta no gesto se o browser bloquear
      player.play({ from: initialIndex, autoplay: true });
    });
  };

  const stored = shareSlug ? readStoredLead() : null;
  if (stored?.leadId) {
    fixedState.lead = { leadId: stored.leadId, name: stored.name || "" };
    window.__GF_LEAD = { slug: shareSlug, leadId: stored.leadId, consent: true };
    tracker?.lead(stored.leadId);
  }

  const begin = () => {
    if (startGateNeeded()) showStartStep(startTour);
    else startTour();
  };

  if (embedShowsCover(embedOptions)) {
    showCover(begin);
    return;
  }
  begin();
}

boot().catch((err) => {
  console.error(err);
  showStatus(t("share.errGeneric"));
});
