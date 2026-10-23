import { captureFileName, optimizeCaptureDataUrl } from "./lib/capture-image.js";
import { buildDemoPayload, hostLabel, nextClickAction, pointFromClick, suggestCaptureName } from "./lib/demo-payload.js";
import {
  DEFAULT_EDITOR_ORIGIN,
  originToMatchPattern,
  resolveEditorOrigin,
  tabMatchesOrigin,
} from "./lib/editor-origin.js";
import { setLocale, resolveLocale, getLocale, t } from "./lib/i18n.js";
import { fileSchemeAllowed, isRestrictedUrl } from "./lib/tab-access.js";

const LOCALE_KEY = "guiaLocale";

setLocale(resolveLocale(typeof navigator !== "undefined" ? navigator.languages || [navigator.language] : []), { persist: false });
chrome.storage.local.get(LOCALE_KEY).then((stored) => {
  if (stored[LOCALE_KEY]) setLocale(stored[LOCALE_KEY], { persist: false });
  return syncAllTabActions();
}).catch(() => {});

const SCRIPT_ID = "guia-capture";
const BRIDGE_ID = "guia-bridge";
const BRIDGE_FILES = ["lib/handoff-deliver.js", "bridge.js"];
const STORAGE_KEY = "guiaCapture";
const SETTINGS_KEY = "guiaCaptureSettings";
const HANDOFF_KEY = "guiaCaptureHandoff";

const COLOR_ICONS = {
  16: "icons/icon16.png",
  32: "icons/icon32.png",
  48: "icons/icon48.png",
};
const GREY_ICONS = {
  16: "icons/icon16-off.png",
  32: "icons/icon32-off.png",
  48: "icons/icon48-off.png",
};

let session = null;
let settings = null;
let captureLock = false;
let lastCaptureAt = 0;
let handoffTimer = null;
let fileAccess = false;

function emptySession() {
  return { active: false, shots: [] };
}

function defaultSettings() {
  return {
    editorOrigin: DEFAULT_EDITOR_ORIGIN,
    projectName: "",
  };
}

async function loadSession() {
  if (session) return session;
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  session = stored[STORAGE_KEY] || emptySession();
  if (!Array.isArray(session.shots)) session.shots = [];
  return session;
}

async function loadSettings() {
  if (settings) return settings;
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const raw = stored[SETTINGS_KEY] || {};
  settings = {
    editorOrigin: resolveEditorOrigin(raw.editorOrigin),
    projectName: typeof raw.projectName === "string" ? raw.projectName : "",
  };
  return settings;
}

async function saveSession() {
  await chrome.storage.local.set({ [STORAGE_KEY]: session });
  await updateBadge();
}

async function saveSettings(next) {
  settings = {
    editorOrigin: resolveEditorOrigin(next.editorOrigin),
    projectName: String(next.projectName || "").trim(),
  };
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  return settings;
}

function publicState(extra = {}) {
  const last = session?.shots?.[session.shots.length - 1];
  return {
    ok: true,
    active: Boolean(session?.active),
    count: session?.shots?.length || 0,
    awaitingHotspot: Boolean(last?.awaitingHotspot),
    editorOrigin: settings?.editorOrigin || DEFAULT_EDITOR_ORIGIN,
    projectName: settings?.projectName || "",
    suggestedName: suggestProjectName(),
    locale: getLocale(),
    ui: captureUi(),
    ...extra,
  };
}

function captureUi() {
  return {
    title: t("ext.barTitle"),
    capture: t("ext.barCapture"),
    create: t("ext.create"),
    append: t("ext.append"),
    undo: t("ext.undo"),
    cancel: t("ext.cancel"),
    stepOne: t("ext.stepOne"),
    stepsN: t("ext.stepsN", { n: "{n}" }),
    hint: t("ext.barHint"),
    hintHotspot: t("ext.barHintHotspot"),
    lostApp: t("ext.barLostApp"),
    lostExt: t("ext.barLostExt"),
  };
}

function suggestProjectName() {
  return suggestCaptureName(session?.shots, "");
}

function canCapture(url) {
  return !isRestrictedUrl(url, { fileAccess });
}

async function refreshFileAccess() {
  fileAccess = await fileSchemeAllowed();
  return fileAccess;
}

// why: chrome.action.disable impede o popup; o ícone cinza por aba deixa o aviso abrir
async function syncTabAction(tab) {
  if (!tab?.id) return;
  const restricted = isRestrictedUrl(tab.url, { fileAccess });
  await chrome.action.setIcon({ tabId: tab.id, path: restricted ? GREY_ICONS : COLOR_ICONS });
  await chrome.action.setTitle({
    tabId: tab.id,
    title: restricted ? t("ext.restrictedTitle") : t("ext.actionTitle"),
  });
}

async function syncAllTabActions() {
  await refreshFileAccess();
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((tab) => syncTabAction(tab).catch(() => {})));
}

async function updateBadge() {
  const count = session?.active ? session.shots.length : 0;
  await chrome.action.setBadgeBackgroundColor({ color: "#1A4D6D" });
  await chrome.action.setBadgeText({ text: count ? String(count) : "" });
}

function randId(prefix) {
  return prefix + Math.random().toString(36).slice(2, 9);
}

function trimTitle(title) {
  const text = String(title || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}


async function ensureBridge(origin) {
  const pattern = originToMatchPattern(origin);
  if (!pattern) throw new Error(t("ext.badOrigin"));
  await chrome.scripting.unregisterContentScripts({ ids: [BRIDGE_ID] }).catch(() => {});
  await chrome.scripting.registerContentScripts([
    {
      id: BRIDGE_ID,
      js: BRIDGE_FILES,
      matches: [pattern],
      runAt: "document_idle",
      persistAcrossSessions: false,
    },
  ]);
  return pattern;
}

async function dropRegistered() {
  await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] }).catch(() => {});
}

async function dropBridge() {
  await chrome.scripting.unregisterContentScripts({ ids: [BRIDGE_ID] }).catch(() => {});
}

async function inject(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
  });
}

async function injectBridge(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: BRIDGE_FILES,
  });
}

async function relayHandoff(message, sender) {
  const tabId = sender?.tab?.id;
  if (!tabId || !message?.payload) return { ok: false };
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [message],
      func: (data) => {
        window.postMessage(data, location.origin);
        document.dispatchEvent(new CustomEvent("guia-capture-handoff", { detail: data }));
      },
    });
  } catch {
    return { ok: false };
  }
  return { ok: true };
}

async function broadcast(state) {
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  await Promise.all(
    tabs.map((tab) => chrome.tabs.sendMessage(tab.id, { type: "STATE", ...state }).catch(() => {}))
  );
}

async function hideOverlay(tabId) {
  await chrome.tabs.sendMessage(tabId, { type: "HIDE_OVERLAY" });
}

async function start(tab) {
  if (!tab?.id || !canCapture(tab.url)) {
    return publicState({
      ok: false,
      error: t("ext.openProduct"),
    });
  }
  session.active = true;
  await saveSession();
  try {
    await inject(tab.id);
  } catch {
    return publicState({
      ok: false,
      error: t("ext.prepareFail"),
    });
  }
  const state = publicState({
    status: t("ext.captureOn"),
  });
  await broadcast(state);
  return state;
}

async function captureShot(tab, meta, { withClick }) {
  if (!session?.active) return publicState({ ok: false, error: t("ext.notActive") });
  if (!tab?.id || !canCapture(tab.url)) {
    return publicState({ ok: false, error: t("ext.pageBlocked") });
  }
  if (captureLock) return { ignore: true };
  if (Date.now() - lastCaptureAt < 400) {
    const state = publicState({ status: t("ext.prevValid") });
    await broadcast(state);
    return state;
  }

  captureLock = true;
  try {
    await hideOverlay(tab.id).catch(() => {});
    let dataUrl;
    try {
      // why: PNG é a fonte sem perda; o WebP sai em seguida, nos limites do editor
      dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    } catch {
      const state = publicState({
        ok: false,
        error: t("ext.chromeBlocked"),
      });
      await broadcast(state);
      return state;
    }

    const encoded = await optimizeCaptureDataUrl(dataUrl);
    // why: sem WebP menor, o PNG da tela inteira inchava o handoff; o JPEG antigo segura o passo
    if (!encoded.optimized) {
      dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 70 });
    } else {
      dataUrl = encoded.dataUrl;
    }
    const stepNumber = session.shots.length + 1;
    session.shots.push({
      imageId: randId("img-"),
      stepId: randId("step-"),
      name: captureFileName(stepNumber, dataUrl),
      label: trimTitle(meta?.title) || t("ext.defaultStep", { n: stepNumber }),
      host: hostLabel(meta?.url || tab.url),
      url: meta?.url || tab.url || "",
      dataUrl,
      addedAt: Date.now(),
      clickPoint: withClick ? pointFromClick(meta) : null,
      awaitingHotspot: !withClick,
    });
    lastCaptureAt = Date.now();
    await saveSession();
    const state = publicState({
      status: withClick
        ? t("ext.clickSaved", { n: stepNumber })
        : t("ext.screenSaved"),
    });
    await broadcast(state);
    return state;
  } finally {
    captureLock = false;
  }
}

async function markHotspot(meta) {
  const last = session.shots[session.shots.length - 1];
  const point = pointFromClick(meta);
  if (!last || !point) return publicState({ ok: false, error: t("ext.badClick") });
  last.clickPoint = point;
  last.awaitingHotspot = false;
  await saveSession();
  const state = publicState({
    status: t("ext.highlightMarked"),
  });
  await broadcast(state);
  return state;
}

async function onPageClick(msg, sender) {
  if (!session.active) return publicState({ active: false, show: false });
  const tab = sender.tab;
  if (nextClickAction(session.shots) === "mark") return markHotspot(msg);
  return captureShot(tab, msg, { withClick: true });
}

async function undo() {
  if (!session.shots.length) return publicState({ ok: false, error: t("ext.nothingUndo") });
  session.shots.pop();
  await saveSession();
  const state = publicState({ status: t("ext.lastRemoved") });
  await broadcast(state);
  return state;
}

async function clearHandoff() {
  if (handoffTimer) {
    clearTimeout(handoffTimer);
    handoffTimer = null;
  }
  await chrome.storage.local.remove(HANDOFF_KEY);
  await dropBridge();
}

async function cancel() {
  await clearHandoff();
  session = emptySession();
  await saveSession();
  await dropRegistered();
  const state = publicState({ show: false, status: t("ext.cancelled") });
  await broadcast(state);
  return state;
}

function fileStamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `guia-captura-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function buildPayload(name) {
  const projectName = String(name || "").trim() || suggestCaptureName(session.shots, fileStamp());
  return buildDemoPayload({ name: projectName, shots: session.shots });
}

async function findEditorTab(origin) {
  const pattern = originToMatchPattern(origin);
  if (!pattern) return null;
  const tabs = await chrome.tabs.query({ url: pattern });
  const matched = tabs.filter((tab) => tabMatchesOrigin(tab.url, origin));
  if (!matched.length) return null;
  const active = matched.find((tab) => tab.active);
  return active || matched[0];
}

async function waitTabComplete(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (tab.status === "complete") return tab;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error(t("ext.editorTimeout")));
    }, 20000);
    function onUpdated(id, info) {
      if (id !== tabId || info.status !== "complete") return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.get(tabId).then(resolve, reject);
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function createProject({ name, editorOrigin } = {}) {
  return deliverHandoff({ name, editorOrigin, mode: "create" });
}

async function appendToProject({ name, editorOrigin } = {}) {
  return deliverHandoff({ name, editorOrigin, mode: "append" });
}

async function deliverHandoff({ name, editorOrigin, mode } = {}) {
  if (!session.shots.length) {
    return publicState({ ok: false, error: t("ext.needOne") });
  }

  if (editorOrigin || name !== undefined) {
    await saveSettings({
      editorOrigin: editorOrigin || settings.editorOrigin,
      projectName: name !== undefined ? name : settings.projectName,
    });
  }

  const origin = settings.editorOrigin;
  let payload;
  try {
    payload = buildPayload(name);
  } catch {
    return publicState({ ok: false, error: t("ext.incomplete") });
  }

  try {
    await ensureBridge(origin);
  } catch {
    return publicState({ ok: false, error: t("ext.badOriginAdjust") });
  }

  const handoffMode = mode === "append" ? "append" : "create";
  const handoffId = Date.now();
  await chrome.storage.local.set({
    [HANDOFF_KEY]: { id: handoffId, payload, mode: handoffMode, createdAt: handoffId, origin },
  });

  let tab = await findEditorTab(origin);
  try {
    if (tab?.id) {
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
      await waitTabComplete(tab.id);
    } else {
      if (handoffMode === "append") {
        return publicState({ ok: false, error: t("ext.appendNoProject") });
      }
      tab = await chrome.tabs.create({ url: origin, active: true });
      await waitTabComplete(tab.id);
    }
    await injectBridge(tab.id);
    await chrome.tabs
      .sendMessage(tab.id, { type: "HANDOFF_PUSH", id: handoffId, payload, mode: handoffMode })
      .catch(() => {});
  } catch {
    return publicState({
      ok: false,
      error: t("ext.openEditorFail"),
    });
  }

  if (handoffTimer) clearTimeout(handoffTimer);
  handoffTimer = setTimeout(async () => {
    const stored = await chrome.storage.local.get(HANDOFF_KEY);
    if (!stored[HANDOFF_KEY]) return;
    await clearHandoff();
    session = await loadSession();
    await broadcast(
      publicState({
        ok: false,
        error: t("ext.editorNoReply"),
      })
    );
  }, 30000);

  const state = publicState({
    status: handoffMode === "append" ? t("ext.appendOpening") : t("ext.openingEditor"),
  });
  await broadcast(state);
  return state;
}

async function onHandoffAck(msg) {
  await clearHandoff();
  if (!msg.ok) {
    const state = publicState({
      ok: false,
      error: msg.error || t("ext.editorRefused"),
    });
    await broadcast(state);
    return state;
  }
  session = emptySession();
  await saveSession();
  await dropRegistered();
  const state = publicState({
    show: false,
    status: msg.mode === "append" ? t("ext.appendOk") : t("ext.projectCreated"),
  });
  await broadcast(state);
  return state;
}

async function getHandoff() {
  const stored = await chrome.storage.local.get(HANDOFF_KEY);
  return { ok: true, handoff: stored[HANDOFF_KEY] || null };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender)
    .then(sendResponse)
    .catch((err) => {
      sendResponse({ ok: false, error: err?.message || t("ext.captureFail") });
    });
  return true;
});

async function handle(msg, sender) {
  await refreshFileAccess();
  session = await loadSession();
  settings = await loadSettings();
  switch (msg.type) {
    case "STATUS":
      return publicState();
    case "SET_LOCALE": {
      const locale = setLocale(msg.locale || "en", { persist: false });
      await chrome.storage.local.set({ [LOCALE_KEY]: locale });
      const state = publicState();
      await broadcast(state);
      await syncAllTabActions().catch(() => {});
      return state;
    }
    case "SAVE_SETTINGS":
      await saveSettings({
        editorOrigin: msg.editorOrigin,
        projectName: msg.projectName,
      });
      return publicState({ status: t("ext.prefsSaved") });
    case "START":
      return start(await chrome.tabs.get(msg.tabId));
    case "CAPTURE_NOW": {
      const tab = await chrome.tabs.get(msg.tabId);
      await inject(tab.id).catch(() => {});
      return captureShot(tab, { title: tab.title, url: tab.url }, { withClick: false });
    }
    case "CAPTURE_FROM_PAGE":
      return captureShot(sender.tab, { title: msg.title, url: sender.tab?.url }, { withClick: false });
    case "PAGE_CLICK":
      return onPageClick(msg, sender);
    case "UNDO":
      return undo();
    case "CANCEL":
      return cancel();
    case "CREATE_PROJECT":
      return createProject({ name: msg.name, editorOrigin: msg.editorOrigin });
    case "APPEND_TO_PROJECT":
      return appendToProject({ name: msg.name, editorOrigin: msg.editorOrigin });
    case "FINISH":
      return createProject();
    case "HANDOFF_GET":
      return getHandoff();
    case "HANDOFF_RELAY":
      return relayHandoff(msg.message, sender);
    case "HANDOFF_ACK":
      return onHandoffAck(msg);
    default:
      return { ok: false, error: t("ext.unknownMsg") };
  }
}

chrome.commands.onCommand.addListener(async (command) => {
  await refreshFileAccess();
  session = await loadSession();
  settings = await loadSettings();
  if (!session.active) return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) return;
  if (command === "capture-now") {
    await inject(tab.id).catch(() => {});
    await captureShot(tab, { title: tab.title, url: tab.url }, { withClick: false });
  } else if (command === "finish-capture") {
    await createProject();
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  refreshFileAccess()
    .then(() => chrome.tabs.get(tabId))
    .then((tab) => syncTabAction(tab))
    .catch(() => {});
});

chrome.tabs.onUpdated.addListener((_tabId, info, tab) => {
  if (!info.url && info.status !== "complete") return;
  refreshFileAccess()
    .then(() => syncTabAction(tab))
    .catch(() => {});
});

chrome.tabs.onReplaced.addListener((addedTabId) => {
  refreshFileAccess()
    .then(() => chrome.tabs.get(addedTabId))
    .then((tab) => syncTabAction(tab))
    .catch(() => {});
});

chrome.runtime.onInstalled.addListener(() => {
  syncAllTabActions().catch(() => {});
});

chrome.runtime.onStartup.addListener(async () => {
  session = await loadSession();
  settings = await loadSettings();
  await updateBadge();
  await syncAllTabActions();
});

syncAllTabActions().catch(() => {});
