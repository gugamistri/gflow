import { buildDemoPayload, nextClickAction, pointFromClick } from "./lib/demo-payload.js";
import {
  DEFAULT_EDITOR_ORIGIN,
  normalizeEditorOrigin,
  originToMatchPattern,
  tabMatchesOrigin,
} from "./lib/editor-origin.js";
import { setLocale, resolveLocale, getLocale, t } from "./lib/i18n.js";

const LOCALE_KEY = "guiaLocale";

setLocale(resolveLocale(typeof navigator !== "undefined" ? navigator.languages || [navigator.language] : []), { persist: false });
chrome.storage.local.get(LOCALE_KEY).then((stored) => {
  if (stored[LOCALE_KEY]) setLocale(stored[LOCALE_KEY], { persist: false });
});

const SCRIPT_ID = "guia-capture";
const BRIDGE_ID = "guia-bridge";
const STORAGE_KEY = "guiaCapture";
const SETTINGS_KEY = "guiaCaptureSettings";
const HANDOFF_KEY = "guiaCaptureHandoff";

let session = null;
let settings = null;
let captureLock = false;
let lastCaptureAt = 0;
let blobUrl = null;
let handoffTimer = null;

function emptySession() {
  return { active: false, shots: [], pendingDownloadId: null };
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
    editorOrigin: normalizeEditorOrigin(raw.editorOrigin) || DEFAULT_EDITOR_ORIGIN,
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
    editorOrigin: normalizeEditorOrigin(next.editorOrigin) || DEFAULT_EDITOR_ORIGIN,
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
    download: t("ext.download"),
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
  const first = session?.shots?.[0]?.label;
  if (first) return first;
  return fileStamp();
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

function isCapturable(url) {
  return /^https?:\/\//.test(url || "");
}

async function ensureBridge(origin) {
  const pattern = originToMatchPattern(origin);
  if (!pattern) throw new Error(t("ext.badOrigin"));
  await chrome.scripting.unregisterContentScripts({ ids: [BRIDGE_ID] }).catch(() => {});
  await chrome.scripting.registerContentScripts([
    {
      id: BRIDGE_ID,
      js: ["bridge.js"],
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
    files: ["bridge.js"],
  });
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
  if (!tab?.id || !isCapturable(tab.url)) {
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
  if (!tab?.id || !isCapturable(tab.url)) {
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
      dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
        format: "jpeg",
        quality: 70,
      });
    } catch {
      const state = publicState({
        ok: false,
        error: t("ext.chromeBlocked"),
      });
      await broadcast(state);
      return state;
    }

    const stepNumber = session.shots.length + 1;
    session.shots.push({
      imageId: randId("img-"),
      stepId: randId("step-"),
      name: `passo-${stepNumber}.jpg`,
      label: trimTitle(meta?.title) || `Passo ${stepNumber}`,
      dataUrl,
      addedAt: Date.now(),
      clickPoint: withClick ? pointFromClick(meta) : null,
      awaitingHotspot: !withClick,
    });
    lastCaptureAt = Date.now();
    await saveSession();
    const state = publicState({
      status: withClick
        ? `Passo ${stepNumber} salvo com o clique.`
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
  if (blobUrl) {
    URL.revokeObjectURL(blobUrl);
    blobUrl = null;
  }
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
  const projectName = String(name || settings?.projectName || "").trim() || suggestProjectName();
  return buildDemoPayload({ name: projectName, shots: session.shots });
}

async function downloadJson() {
  if (!session.shots.length) {
    return publicState({ ok: false, error: t("ext.needOne") });
  }
  let payload;
  try {
    payload = buildPayload();
  } catch {
    return publicState({ ok: false, error: t("ext.incomplete") });
  }

  if (blobUrl) URL.revokeObjectURL(blobUrl);
  blobUrl = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));

  let downloadId;
  try {
    downloadId = await chrome.downloads.download({
      url: blobUrl,
      filename: `${payload.name || fileStamp()}.json`,
      saveAs: true,
      conflictAction: "uniquify",
    });
  } catch {
    return publicState({
      ok: false,
      error: t("ext.downloadFail"),
    });
  }

  session.pendingDownloadId = downloadId;
  await saveSession();
  return publicState({ status: t("ext.chooseSave") });
}

async function findEditorTab(origin) {
  const pattern = originToMatchPattern(origin);
  if (!pattern) return null;
  const tabs = await chrome.tabs.query({ url: pattern });
  return tabs.find((tab) => tabMatchesOrigin(tab.url, origin)) || null;
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

  await chrome.storage.local.set({
    [HANDOFF_KEY]: { payload, createdAt: Date.now(), origin },
  });

  let tab = await findEditorTab(origin);
  try {
    if (tab?.id) {
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
      await waitTabComplete(tab.id);
    } else {
      tab = await chrome.tabs.create({ url: origin, active: true });
      await waitTabComplete(tab.id);
    }
    await injectBridge(tab.id);
    await chrome.tabs.sendMessage(tab.id, { type: "HANDOFF_PUSH", payload }).catch(() => {});
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
    status: t("ext.openingEditor"),
  });
  await broadcast(state);
  return state;
}

async function settleDownload(downloadId, state) {
  session = await loadSession();
  if (!session.pendingDownloadId || session.pendingDownloadId !== downloadId) return;
  if (state === "complete") {
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
      blobUrl = null;
    }
    session = emptySession();
    await saveSession();
    await dropRegistered();
    await broadcast(publicState({ show: false, status: t("ext.jsonDownloaded") }));
    return;
  }
  if (state === "interrupted") {
    session.pendingDownloadId = null;
    await saveSession();
    await broadcast(
      publicState({
        ok: false,
        error: t("ext.downloadCancelled"),
      })
    );
  }
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
    status: t("ext.projectCreated"),
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
    case "DOWNLOAD_JSON":
      return downloadJson();
    case "FINISH":
      return createProject();
    case "HANDOFF_GET":
      return getHandoff();
    case "HANDOFF_ACK":
      return onHandoffAck(msg);
    default:
      return { ok: false, error: t("ext.unknownMsg") };
  }
}

chrome.commands.onCommand.addListener(async (command) => {
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

chrome.downloads.onChanged.addListener((delta) => {
  const state = delta.state?.current;
  if (state !== "complete" && state !== "interrupted") return;
  settleDownload(delta.id, state).catch(() => {});
});

chrome.runtime.onStartup.addListener(async () => {
  session = await loadSession();
  settings = await loadSettings();
  await updateBadge();
});
