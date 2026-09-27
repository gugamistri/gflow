/**
 * Página /v/:id — preview somente leitura do tour publicado.
 */
import { applyTheme, normalizeSteps } from "./store.js";
import { ensureNarration, ensurePlayback } from "./playback.js";
import { createPlayer } from "./player.js";
import { initLocale, applyI18n, t } from "./i18n.js";

function parseShareId() {
  const m = location.pathname.match(/\/v\/([a-f0-9]{32})\/?$/i);
  return m ? m[1].toLowerCase() : null;
}

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

async function loadDemo(id) {
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

async function boot() {
  initLocale();
  applyI18n(document);
  document.title = t("view.title");

  const id = parseShareId();
  if (!id) {
    showStatus(t("view.missing"));
    return;
  }

  let demo;
  try {
    demo = await loadDemo(id);
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

  const title = document.getElementById("topbar-title");
  if (title) title.textContent = demo.name || t("view.title");

  document.body.classList.add("is-presenting");
  document.getElementById("view-editor")?.classList.add("is-presenting");
  document.getElementById("hotspot")?.classList.add("is-previewing");
  document.getElementById("present-chrome").hidden = false;

  hideStatus();

  let selectedIndex = 0;
  const player = createPlayer({
    getDemo: () => demo,
    toast,
    getSelectedIndex: () => selectedIndex,
    setSelectedIndex: (i) => {
      selectedIndex = i;
    },
    presentHintKey: "view.escHint",
    onRequestExit: () => {
      // why: na página compartilhada não há editor — Esc/clique fora reinicia o tour
      selectedIndex = 0;
      player.play({ from: 0, autoplay: false });
    },
  });

  requestAnimationFrame(() => {
    player.play({ from: 0, autoplay: false });
  });
}

boot().catch((err) => {
  console.error(err);
  showStatus(t("share.errGeneric"));
});
