import { DEFAULT_EDITOR_ORIGIN } from "./lib/editor-origin.js";
import { initLocale, applyI18n, bindLocaleSelect, t, getLocale } from "./lib/i18n.js";

const idle = document.getElementById("idle");
const live = document.getElementById("live");
const countEl = document.getElementById("count");
const statusEl = document.getElementById("status");
const nameEl = document.getElementById("project-name");
const originEl = document.getElementById("editor-origin");

originEl.placeholder = DEFAULT_EDITOR_ORIGIN;
if (!originEl.value) originEl.value = DEFAULT_EDITOR_ORIGIN;

function paint(state) {
  const active = Boolean(state?.active);
  idle.hidden = active;
  live.hidden = !active;
  const count = state?.count || 0;
  countEl.textContent = active
    ? count === 1
      ? t("ext.stepOne")
      : t("ext.stepsN", { n: count })
    : t("ext.off");
  statusEl.textContent = state?.error || state?.status || "";
  statusEl.classList.toggle("is-error", Boolean(state?.error));

  if (document.activeElement !== originEl) {
    originEl.value = state?.editorOrigin || DEFAULT_EDITOR_ORIGIN;
  }
  if (document.activeElement !== nameEl) {
    if (state?.projectName) nameEl.value = state.projectName;
    else if (!nameEl.value && state?.suggestedName) nameEl.placeholder = state.suggestedName;
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

initLocale();
applyI18n(document);
bindLocaleSelect(document.getElementById("locale-select"), (locale) => {
  send({ type: "SET_LOCALE", locale }).then(paint);
});
send({ type: "SET_LOCALE", locale: getLocale() });

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function settingsPayload() {
  return {
    name: nameEl.value.trim(),
    editorOrigin: originEl.value.trim() || DEFAULT_EDITOR_ORIGIN,
  };
}

async function persistSettings() {
  return send({
    type: "SAVE_SETTINGS",
    projectName: nameEl.value.trim(),
    editorOrigin: originEl.value.trim() || DEFAULT_EDITOR_ORIGIN,
  });
}

nameEl.addEventListener("change", () => {
  persistSettings().then(paint);
});
originEl.addEventListener("change", () => {
  persistSettings().then(paint);
});

document.getElementById("start").addEventListener("click", async () => {
  await persistSettings();
  const tab = await activeTab();
  if (!tab?.id) {
    paint({ ok: false, error: t("ext.noActiveTab") });
    return;
  }
  const state = await send({ type: "START", tabId: tab.id });
  paint(state);
  closeIfOk(state);
});

document.getElementById("shot").addEventListener("click", async () => {
  const tab = await activeTab();
  const state = await send({ type: "CAPTURE_NOW", tabId: tab?.id });
  paint(state);
  closeIfOk(state);
});

document.getElementById("create").addEventListener("click", async () => {
  const { name, editorOrigin } = settingsPayload();
  const state = await send({ type: "CREATE_PROJECT", name, editorOrigin });
  paint(state);
  closeIfOk(state);
});

document.getElementById("append").addEventListener("click", async () => {
  const { name, editorOrigin } = settingsPayload();
  const state = await send({ type: "APPEND_TO_PROJECT", name, editorOrigin });
  paint(state);
  closeIfOk(state);
});

document.getElementById("download").addEventListener("click", async () => {
  const state = await send({ type: "DOWNLOAD_JSON" });
  paint(state);
  closeIfOk(state);
});

document.getElementById("undo").addEventListener("click", async () => {
  paint(await send({ type: "UNDO" }));
});

document.getElementById("cancel").addEventListener("click", async () => {
  const state = await send({ type: "CANCEL" });
  paint(state);
  closeIfOk(state);
});

send({ type: "STATUS" }).then(paint);
