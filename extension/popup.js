import { hostLabel } from "./lib/demo-payload.js";
import { DEFAULT_EDITOR_ORIGIN } from "./lib/editor-origin.js";
import { initLocale, applyI18n, bindLocaleSelect, t, getLocale } from "./lib/i18n.js";
import { fileSchemeAllowed, isRestrictedUrl } from "./lib/tab-access.js";

const idle = document.getElementById("idle");
const live = document.getElementById("live");
const panels = document.getElementById("panels");
const restrictedEl = document.getElementById("restricted");
const restrictedActiveEl = document.getElementById("restricted-active");
const helpEl = document.getElementById("help");
const keysEl = document.getElementById("keys");
const countEl = document.getElementById("count");
const statusEl = document.getElementById("status");
const nameEl = document.getElementById("name-preview");
const originEl = document.getElementById("editor-origin");
const createBtn = document.getElementById("create");
const appendBtn = document.getElementById("append");
const undoBtn = document.getElementById("undo");

const GENERIC_TITLE = /^(new tab|nova guia|nueva pestaña|about:blank)$/i;

originEl.placeholder = DEFAULT_EDITOR_ORIGIN;
if (!originEl.value) originEl.value = DEFAULT_EDITOR_ORIGIN;

function previewName(state, tab) {
  if (state?.suggestedName) return state.suggestedName;
  const title = String(tab?.title || "").replace(/\s+/g, " ").trim();
  if (title && !GENERIC_TITLE.test(title)) {
    return title.length > 60 ? `${title.slice(0, 57)}…` : title;
  }
  return hostLabel(tab?.url);
}

function paint(state, tab) {
  const restricted = Boolean(state?.restricted);
  const active = Boolean(state?.active);
  const count = state?.count || 0;
  restrictedEl.hidden = !restricted;
  restrictedActiveEl.hidden = !restricted || !active;
  panels.hidden = restricted;
  helpEl.hidden = restricted;
  keysEl.hidden = restricted;
  idle.hidden = restricted || active;
  live.hidden = restricted || !active;

  if (restricted && !active) countEl.textContent = t("ext.restrictedShort");
  else if (active) countEl.textContent = count === 1 ? t("ext.stepOne") : t("ext.stepsN", { n: count });
  else countEl.textContent = t("ext.off");

  statusEl.textContent = state?.error || state?.status || "";
  statusEl.classList.toggle("is-error", Boolean(state?.error));

  const name = restricted ? "" : previewName(state, tab);
  nameEl.hidden = !name;
  nameEl.textContent = name ? t("ext.namePreview", { name }) : "";
  nameEl.title = name ? t("ext.nameHint") : "";

  const hasShots = count > 0;
  createBtn.disabled = !hasShots;
  appendBtn.disabled = !hasShots;
  undoBtn.disabled = !hasShots;

  if (document.activeElement !== originEl) {
    originEl.value = state?.editorOrigin || DEFAULT_EDITOR_ORIGIN;
  }
}

function send(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (state) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(state || { ok: false, error: t("ext.noResponse") });
    });
  });
}

/** Fecha o popup só depois da resposta; erro mantém aberto para ler o status. */
function closeIfOk(state) {
  if (state?.ok === false || state?.error) return;
  window.close();
}

function editorOrigin() {
  return originEl.value.trim() || DEFAULT_EDITOR_ORIGIN;
}

function persistOrigin() {
  return send({ type: "SAVE_SETTINGS", editorOrigin: editorOrigin() });
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function refresh() {
  const tab = await activeTab();
  const fileAccess = await fileSchemeAllowed();
  const state = await send({ type: "STATUS" });
  paint({ ...state, restricted: isRestrictedUrl(tab?.url, { fileAccess }) }, tab);
}

initLocale();
applyI18n(document);
bindLocaleSelect(document.getElementById("locale-select"), () => {
  send({ type: "SET_LOCALE", locale: getLocale() }).then(() => refresh());
});

originEl.addEventListener("change", () => {
  persistOrigin().then(() => refresh());
});

document.getElementById("start").addEventListener("click", async () => {
  await persistOrigin();
  const tab = await activeTab();
  if (!tab?.id) {
    paint({ ok: false, error: t("ext.noActiveTab") }, tab);
    return;
  }
  const state = await send({ type: "START", tabId: tab.id });
  const fileAccess = await fileSchemeAllowed();
  paint({ ...state, restricted: isRestrictedUrl(tab.url, { fileAccess }) }, tab);
  closeIfOk(state);
});

document.getElementById("shot").addEventListener("click", async () => {
  const tab = await activeTab();
  const state = await send({ type: "CAPTURE_NOW", tabId: tab?.id });
  paint({ ...state, restricted: false }, tab);
  closeIfOk(state);
});

document.getElementById("create").addEventListener("click", async () => {
  const tab = await activeTab();
  const state = await send({ type: "CREATE_PROJECT", editorOrigin: editorOrigin() });
  paint({ ...state, restricted: false }, tab);
  closeIfOk(state);
});

document.getElementById("append").addEventListener("click", async () => {
  const tab = await activeTab();
  const state = await send({ type: "APPEND_TO_PROJECT", editorOrigin: editorOrigin() });
  paint({ ...state, restricted: false }, tab);
  closeIfOk(state);
});

document.getElementById("undo").addEventListener("click", async () => {
  const tab = await activeTab();
  paint({ ...(await send({ type: "UNDO" })), restricted: false }, tab);
});

document.getElementById("cancel").addEventListener("click", async () => {
  const tab = await activeTab();
  const state = await send({ type: "CANCEL" });
  paint({ ...state, restricted: false }, tab);
  closeIfOk(state);
});

send({ type: "SET_LOCALE", locale: getLocale() }).then(() => refresh());
