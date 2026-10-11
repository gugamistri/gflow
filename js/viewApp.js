/**
 * Páginas /v/:id e /p/:slug — o mesmo preview somente leitura.
 */
import { applyTheme, normalizeSteps, resolveImageSrc } from "./store.js";
import { ensureNarration, ensurePlayback } from "./playback.js";
import { createPlayer } from "./player.js";
import { initLocale, applyI18n, t } from "./i18n.js";
import { getCloudBaseUrl, PUBLISHED_CLOUD_BASE } from "./cloudConfig.js";
import {
  decideEscape,
  embedShowsCover,
  parseEmbedOptions,
  parseViewRoute,
  permanentShareEndpoint,
  sameOriginReferrer,
  clickClosesSharedTour,
  sharePageTitle,
  shareStartIndex,
  sharedPreviewBackTarget,
  tourFromPermanentShare,
} from "./viewShare.js";
import { endStepActive, normalizeEndStep, startStepActive } from "./fixedSteps.js";
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
  return parsed.tour;
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
let demo = null;
let touring = false;
let replayTour = () => {};
let shareFeatures = { leadCapture: false, contactForm: false };
let shareSlug = "";

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
  return sharePageTitle(name, t("view.title"));
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
    onContactForm: () => {
      const card = cardShell("end");
      card.append(
        renderContactForm({
          consentText: step.contact.consentText,
          prefill: fixedState.lead || {},
          onSubmit: (value) => postShare("contact", value),
          onCancel: () => showFixedCard(endCard()),
        })
      );
      showFixedCard(card);
    },
  });
}

function showEndStep() {
  return showFixedCard(endCard());
}

/** Passo inicial (Pro): só no /p, com o recurso ativo no servidor, uma vez por sessão. */
function startGateNeeded() {
  if (!shareSlug || !shareFeatures.leadCapture || !startStepActive(demo?.startStep)) return false;
  return !readStoredLead();
}

function showStartStep(next) {
  const card = renderStartCard(demo.startStep, {
    onSubmit: async (value) => {
      const res = await postShare("leads", value);
      if (res.ok) {
        // why: o id do lead só existe com consentimento (obrigatório no envio) — o analytics pode usá-lo
        const lead = { leadId: String(res.data?.leadId || ""), name: value.name || "", email: value.email || "", phone: value.phone || "" };
        fixedState.lead = lead;
        storeLead({ leadId: lead.leadId, name: lead.name });
        if (lead.leadId) window.__GF_LEAD = { slug: shareSlug, leadId: lead.leadId, consent: true };
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
  if (!isEmbed && tryLeaveSharedPreview()) return;
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
    event.preventDefault();
    event.stopImmediatePropagation();
    requestSharedExit("click_outside");
  },
  true
);

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
  });

  replayTour = () => {
    selectedIndex = 0;
    showTouring();
    player.play({ from: 0, autoplay: true });
  };
  document.getElementById("view-share-replay")?.addEventListener("click", () => replayTour());

  const startTour = () => {
    showTouring();
    requestAnimationFrame(() => {
      // why: tour publicado assiste sozinho; o 1º áudio retenta no gesto se o browser bloquear
      player.play({ from: initialIndex, autoplay: true });
    });
  };

  const stored = shareSlug ? readStoredLead() : null;
  if (stored?.leadId) {
    fixedState.lead = { leadId: stored.leadId, name: stored.name || "" };
    window.__GF_LEAD = { slug: shareSlug, leadId: stored.leadId, consent: true };
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
