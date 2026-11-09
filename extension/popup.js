import { hostLabel } from "./lib/demo-payload.js";
import { DEFAULT_EDITOR_ORIGIN } from "./lib/editor-origin.js";
import { initLocale, applyI18n, bindLocaleSelect, t, getLocale } from "./lib/i18n.js";
import { fileSchemeAllowed, isRestrictedUrl } from "./lib/tab-access.js";
import { releaseNoteDate, releaseNoteHelpUrl, splitReleaseNote } from "./lib/releaseNotes.js";
import { WHATS_NEW_PREVIEW, popupEntries } from "./lib/whats-new.js";

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

  const typingEl = document.getElementById("record-typing");
  if (typingEl && document.activeElement !== typingEl) typingEl.checked = state?.recordTyping === true;

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

/* ---------- Novidades ---------- */

const SVG_NS = "http://www.w3.org/2000/svg";
// why: ícones fixos montados com createElementNS (nada de HTML vindo de texto)
const NEWS_ICONS = {
  bell: ["M8 2.2a3.6 3.6 0 0 0-3.6 3.6v2.6L3 10.6h10l-1.4-2.2V5.8A3.6 3.6 0 0 0 8 2.2z", "M6.6 12.4a1.5 1.5 0 0 0 2.8 0"],
  video: ["M2.2 4.4h8.2v7.2H2.2z", "M10.4 7.2l3.4-2v5.6l-3.4-2"],
  caption: ["M2 3.6h12v8.8H2z", "M4.4 8.6h3M8.8 8.6h2.8M4.4 10.4h7.2"],
  slide: ["M2.2 3.2h11.6v8.2H2.2z", "M8 11.4v2M5.6 13.4h4.8"],
  text: ["M3 3.4h6.4M6.2 3.4v9.2", "M9.6 8.2h3.6M9.6 10.4h3.6M9.6 12.6h2.4"],
  gallery: ["M2.2 3.4h11.6v9.2H2.2z", "M2.2 10.4l3.2-3 2.6 2.4 1.8-1.6 3.8 3.4", "M10.6 6.2h.01"],
};
const newsList = document.getElementById("news-list");
const newsToggle = document.getElementById("news-toggle");
let newsExpanded = false;

function newsIcon(name) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("class", "news-ico");
  svg.setAttribute("aria-hidden", "true");
  for (const d of NEWS_ICONS[name] || NEWS_ICONS.bell) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.4");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.append(path);
  }
  return svg;
}

function newsItem(entry, locale, index) {
  const li = document.createElement("li");
  li.className = "news-item";
  li.hidden = !newsExpanded && index >= WHATS_NEW_PREVIEW;
  const meta = document.createElement("p");
  meta.className = "news-meta";
  const tag = document.createElement("span");
  tag.className = `news-tag is-${entry.tag}`;
  tag.textContent = t(`releaseNotes.tag.${entry.tag}`);
  const time = document.createElement("time");
  time.dateTime = entry.date;
  time.textContent = releaseNoteDate(locale, entry.date);
  meta.append(tag, time);
  const { title, desc } = splitReleaseNote(t(`releaseNotes.${entry.key}`));
  const h = document.createElement("h3");
  h.className = "news-item-title";
  const label = document.createElement("span");
  label.textContent = title;
  h.append(newsIcon(entry.icon), label);
  li.append(meta, h);
  if (desc) {
    const p = document.createElement("p");
    p.className = "news-desc";
    p.textContent = desc;
    li.append(p);
  }
  if (entry.help) {
    const a = document.createElement("a");
    a.className = "news-link";
    a.href = releaseNoteHelpUrl(locale, entry.help);
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = t("ext.news.help");
    a.setAttribute("aria-label", t("ext.news.helpAria", { title }));
    li.append(a);
  }
  return li;
}

function renderNews() {
  const entries = popupEntries();
  const locale = getLocale();
  newsList.replaceChildren(...entries.map((e, i) => newsItem(e, locale, i)));
  const extra = entries.length - WHATS_NEW_PREVIEW;
  newsToggle.hidden = extra <= 0;
  newsToggle.setAttribute("aria-expanded", String(newsExpanded));
  newsToggle.textContent = newsExpanded ? t("ext.news.less") : t("ext.news.more", { n: extra });
  document.getElementById("news").hidden = entries.length === 0;
}

newsToggle.addEventListener("click", () => {
  newsExpanded = !newsExpanded;
  renderNews();
  // why: ao abrir, o primeiro item novo recebe o foco; ao fechar, o foco fica no botão
  if (newsExpanded) newsList.children[WHATS_NEW_PREVIEW]?.querySelector("a")?.focus();
});

initLocale();
applyI18n(document);
renderNews();
bindLocaleSelect(document.getElementById("locale-select"), () => {
  renderNews();
  send({ type: "SET_LOCALE", locale: getLocale() }).then(() => refresh());
});

originEl.addEventListener("change", () => {
  persistOrigin().then(() => refresh());
});

document.getElementById("record-typing").addEventListener("change", async () => {
  const on = document.getElementById("record-typing").checked;
  const tab = await activeTab();
  const state = await send({ type: "SET_RECORD_TYPING", recordTyping: on });
  paint({ ...state, restricted: false }, tab);
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
// abrir o popup = novidades vistas (apaga o selo NOVO)
send({ type: "WHATS_NEW_SEEN" });
