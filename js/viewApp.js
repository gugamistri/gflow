/**
 * Páginas /v/:id e /p/:slug — o mesmo preview somente leitura.
 */
import { applyTheme, normalizeSteps } from "./store.js";
import { ensureNarration, ensurePlayback } from "./playback.js";
import { createPlayer } from "./player.js";
import { initLocale, applyI18n, t } from "./i18n.js";
import { getCloudBaseUrl, PUBLISHED_CLOUD_BASE } from "./cloudConfig.js";
import {
  decideEscape,
  parseViewRoute,
  permanentShareEndpoint,
  sameOriginReferrer,
  sharePageTitle,
  shareStartIndex,
  sharedPreviewBackTarget,
  tourFromPermanentShare,
} from "./viewShare.js";

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
  const closed = document.getElementById("view-share-closed");
  if (closed) closed.hidden = false;
  focusShareDocument();
}

function showTouring() {
  touring = true;
  const closed = document.getElementById("view-share-closed");
  if (closed) closed.hidden = true;
  document.body.classList.add("is-presenting");
  document.getElementById("view-editor")?.classList.add("is-presenting");
  document.getElementById("hotspot")?.classList.add("is-previewing");
  const hint = document.getElementById("present-chrome");
  if (hint) hint.hidden = false;
  hideStatus();
  focusShareDocument();
}

function exitSharedTour() {
  if (!touring) return;
  if (tryLeaveSharedPreview()) return;
  showClosedState();
}

function onSharedEscape(event) {
  if (event.key !== "Escape") return;
  if (!touring) return;
  const action = decideEscape({
    fullscreen: Boolean(fullscreenElement()),
    overlay: Boolean(findPlayerOverlay()),
    back: Boolean(backTarget()),
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
  exitSharedTour();
}

// why: Esc tem de chegar mesmo sem foco no cartão e antes do driver
window.addEventListener("keydown", onSharedEscape, true);

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

  showTouring();

  player = createPlayer({
    getDemo: () => demo,
    toast,
    getSelectedIndex: () => selectedIndex,
    setSelectedIndex: (i) => {
      selectedIndex = i;
    },
    allowClose: true,
    ignoreAdvanceMs: 700,
    onRequestExit: () => {
      exitSharedTour();
    },
  });

  document.getElementById("view-share-replay")?.addEventListener("click", () => {
    selectedIndex = 0;
    showTouring();
    player.play({ from: 0, autoplay: true });
  });

  requestAnimationFrame(() => {
    // why: tour publicado assiste sozinho; o 1º áudio retenta no gesto se o browser bloquear
    player.play({ from: initialIndex, autoplay: true });
  });
}

boot().catch((err) => {
  console.error(err);
  showStatus(t("share.errGeneric"));
});
