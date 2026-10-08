import {
  exportDemo,
  importDemoFile,
  applyTheme,
  themeToForm,
  formToTheme,
  normalizeSteps,
} from "./store.js";
import {
  ensureMigrated,
  readIndex,
  getProject,
  putProject,
  putProjectAndHistory,
  getProjectHistory,
  deleteProject,
  setActiveProjectId,
  createEmptyProject,
  demoPayloadToProject,
  projectToDemoPayload,
  duplicateProject,
  renameProject,
  getCustomThemes,
  saveCustomThemes,
  writeIndex,
} from "./projects.js";
import { downscaleImageUrl, isHeavyDataUrl } from "./thumbs.js";
import { appendCaptureToProject } from "./stepClipboard.js";
import { renumberScenes } from "./scenes.js";
import {
  THEME_PRESETS,
  cloneTheme,
  createThemeId,
  matchThemeSelection,
  getPreset,
  getAppearancePreference,
  setAppearancePreference,
  resolveAppearanceMode,
} from "./themes.js";
import { createEditor } from "./editor.js";
import { isTypingTarget } from "./canvasEdit.js";
import { createPlayer } from "./player.js";
import { exportStandaloneHtml, exportVideo } from "./exportPack.js";
import { ensureNarration, ensurePlayback } from "./playback.js";
import { createHistory } from "./history.js";
import {
  publishShareLink,
  publishPermanentShare,
  revokeShareLink,
  copyText,
  permanentShareErrorMessage,
} from "./share.js";
import { shareViewUrl } from "./shareSnapshot.js";
import {
  initLocale,
  applyI18n,
  bindLocaleSelect,
  getLocale,
  t,
  themePresetName,
} from "./i18n.js";
import {
  EXT_BANNER_DISMISS_KEY,
  canOfferChromeExtension,
  shouldShowExtensionBanner,
} from "./extensionBanner.js";
import {
  RELEASE_NOTES_DISMISS_KEY,
  RELEASE_NOTES_VERSION,
  releaseNotesMonth,
  shouldShowReleaseNotes,
} from "./releaseNotes.js";
import { COMPACT_LANDSCAPE_MQ, COMPACT_TOUCH_MQ, isCompactLandscape, isCompactTouch } from "./compact.js";
import {
  CLOUD_SESSION_KEY,
  claimCloudPublishIntent,
  clearCloudPublishIntent,
  cloudAuthMessageOrigins,
  completeCloudAuthCallback,
  endCloudSession,
  establishCloudSession,
  getCloudAccount,
  getCloudFlags,
  isCloudEnabled,
  loginWithPassword,
  parseCloudAuthMessage,
  requestMagicLink,
  takeCloudAuthError,
  writeCloudPublishIntent,
} from "./cloudConfig.js";
import {
  billingMenuModel,
  classifyCloudGate,
  emptyEntitlement,
  exportShowsWatermark,
  fetchBillingEntitlement,
  hostedAccess,
  quotaMessageKey,
  readBillingReturn,
  shouldShowProBadge,
  startBillingCheckout,
  startBillingPortal,
  stripBillingReturn,
  upgradeCopyKeys,
} from "./billing.js";
import {
  formatPaywallAmount,
  isSubscriptionRequired,
  paywallCurrency,
  paywallFeatureOrder,
  paywallOffer,
  shouldShowLocalSave,
} from "./paywall.js";

let project = null;
let selectedIndex = 0;
let selectedNewThemeId = THEME_PRESETS[0].id;
let themeSelection = { kind: "preset", id: THEME_PRESETS[0].id };
let appearancePreference = getAppearancePreference();

const toastEl = document.getElementById("toast");
let toastTimer = null;

function applyChromeAppearance(mode = resolveAppearanceMode(appearancePreference)) {
  document.documentElement.setAttribute("data-appearance", mode);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = mode === "social" ? "#101010" : "#1A4D6D";
  const segment = document.getElementById("appearance-segment");
  if (segment) {
    segment.querySelectorAll(".appearance-opt").forEach((btn) => {
      // why: data-appearance no botão herdava tokens do tema escuro ([data-appearance=social])
      const value = btn.getAttribute("data-mode");
      const pressed = value === appearancePreference;
      btn.setAttribute("aria-pressed", pressed ? "true" : "false");
    });
  }
}

/** Aparência do site — não altera o tema do tour (slides/popover) */
function syncAppearanceOnly() {
  applyChromeAppearance();
}

function beginInlineEdit(host, { value, maxLength = 80, onSave }) {
  if (!host || host.dataset.editing === "1") return;
  host.dataset.editing = "1";
  const current = String(value ?? "").trim();
  const input = document.createElement("input");
  input.type = "text";
  input.className = "inline-edit";
  input.value = current;
  input.maxLength = maxLength;
  input.setAttribute("aria-label", t("toast.rename"));
  host.replaceChildren(input);
  if (host.id === "topbar-project") {
    input.style.width = "100%";
  }
  input.focus();
  input.select();

  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    host.dataset.editing = "0";
    const next = input.value.trim();
    if (save && next && next !== current) {
      try {
        await onSave(next);
        return;
      } catch (err) {
        console.error(err);
        toast(err?.message || t("toast.renameFail"));
      }
    }
    host.textContent = current;
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finish(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      finish(false);
    }
  });
  input.addEventListener("blur", () => finish(true));
}

function namesMatch(expected, typed) {
  return String(expected || "").trim().toLowerCase() === String(typed || "").trim().toLowerCase();
}

async function openDeleteProjectModal(id) {
  const proj = await getProject(id);
  if (!proj) {
    toast(t("toast.projectNotFound"));
    return;
  }
  const modal = document.getElementById("modal-delete-project");
  document.getElementById("delete-project-id").value = id;
  document.getElementById("delete-project-expected").value = proj.name || "";
  document.getElementById("delete-project-name-label").textContent = proj.name || t("modal.thisProject");
  const confirmInput = document.getElementById("delete-project-confirm");
  confirmInput.value = "";
  document.getElementById("delete-project-backup").checked = true;
  document.getElementById("delete-project-hint").hidden = true;
  document.getElementById("btn-confirm-delete-project").disabled = true;
  modal.showModal();
  confirmInput.focus();
}

function bindDeleteProjectModal() {
  const modal = document.getElementById("modal-delete-project");
  const confirmInput = document.getElementById("delete-project-confirm");
  const hint = document.getElementById("delete-project-hint");
  const submitBtn = document.getElementById("btn-confirm-delete-project");

  const syncConfirm = () => {
    const expected = document.getElementById("delete-project-expected").value;
    const ok = namesMatch(expected, confirmInput.value);
    submitBtn.disabled = !ok;
    hint.hidden = !confirmInput.value.trim() || ok;
  };

  confirmInput?.addEventListener("input", syncConfirm);

  document.getElementById("btn-cancel-delete-project")?.addEventListener("click", () => {
    modal.close();
  });

  document.getElementById("form-delete-project")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("delete-project-id").value;
    const expected = document.getElementById("delete-project-expected").value;
    if (!id || !namesMatch(expected, confirmInput.value)) {
      hint.hidden = false;
      submitBtn.disabled = true;
      return;
    }

    const wantBackup = document.getElementById("delete-project-backup").checked;
    const proj = await getProject(id);
    if (!proj) {
      modal.close();
      toast(t("toast.projectNotFound"));
      return;
    }

    if (wantBackup) {
      exportDemo(projectToDemoPayload(proj), { filename: proj.name });
    }

    await deleteProject(id);
    if (project?.id === id) {
      project = null;
      await setActiveProjectId(null);
      showLibrary();
    } else {
      renderLibrary();
    }
    modal.close();
    toast(wantBackup ? t("toast.deletedWithBackup") : t("toast.deleted"));
  });
}

function toast(message, duration = 2200) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.hidden = true;
  }, duration);
}

function getDemo() {
  return project;
}

function setDemo(next) {
  project = next;
}

function getSelectedIndex() {
  return selectedIndex;
}

function setSelectedIndex(i) {
  const max = Math.max(0, (project?.steps?.length || 1) - 1);
  selectedIndex = Math.max(0, Math.min(i, max));
}

const history = createHistory();
let historyLock = false;
let settleTimer = null;
let saveTimer = null;
let saveDirty = false;
let saveChain = Promise.resolve();

function updateHistoryButtons() {
  const undoBtn = document.getElementById("btn-undo");
  const redoBtn = document.getElementById("btn-redo");
  if (undoBtn) undoBtn.disabled = !project || !history.canUndo();
  if (redoBtn) redoBtn.disabled = !project || !history.canRedo();
}

function rememberProject(state) {
  history.reset(state);
  updateHistoryButtons();
}

async function attachSavedHistory(state) {
  const projectChanged = state ? renumberScenes(state) : false;
  let saved = null;
  let stacksChanged = false;
  if (state?.id) {
    try {
      saved = await getProjectHistory(state.id);
      for (const snap of [...(saved?.undo || []), ...(saved?.redo || [])]) {
        if (snap && typeof snap === "object" && renumberScenes(snap)) stacksChanged = true;
      }
    } catch (err) {
      console.error(err);
    }
  }
  if (saved && (saved.undo.length || saved.redo.length)) history.restore(state, saved);
  else history.reset(state);
  updateHistoryButtons();
  if (state?.id && (projectChanged || stacksChanged)) {
    saveDirty = true;
    await flushAutosave();
  }
}

function onChange() {
  if (historyLock || !project) return;
  history.noteChange();
  updateHistoryButtons();
  schedulePersist();
}

function schedulePersist() {
  saveDirty = true;
  clearTimeout(settleTimer);
  clearTimeout(saveTimer);
  settleTimer = setTimeout(commitPendingEdit, 600);
  saveTimer = setTimeout(() => {
    void flushAutosave();
  }, 800);
}

function commitPendingEdit() {
  clearTimeout(settleTimer);
  settleTimer = null;
  if (project && !historyLock) history.settle(project);
  updateHistoryButtons();
}

function applyHistoryState(next) {
  historyLock = true;
  try {
    project = next;
    setSelectedIndex(getSelectedIndex());
    const label = document.getElementById("topbar-project");
    if (label && project) label.textContent = project.name || "";
    syncThemeUi();
    if (presenting) exitPresentation();
    editor.refresh();
  } finally {
    historyLock = false;
  }
  updateHistoryButtons();
  saveDirty = true;
  void flushAutosave();
}

function undoEdit() {
  if (!project) return;
  clearTimeout(settleTimer);
  settleTimer = null;
  const restored = history.undoChange(project);
  if (!restored) {
    updateHistoryButtons();
    return;
  }
  applyHistoryState(restored);
}

function redoEdit() {
  if (!project) return;
  clearTimeout(settleTimer);
  settleTimer = null;
  history.settle(project);
  const restored = history.redoChange();
  if (!restored) {
    updateHistoryButtons();
    return;
  }
  applyHistoryState(restored);
}

function flushAutosave() {
  clearTimeout(saveTimer);
  saveTimer = null;
  commitPendingEdit();
  if (!project || !saveDirty) return saveChain;
  saveDirty = false;
  const snapshot = project;
  saveChain = saveChain
    .then(() => putProjectAndHistory(snapshot, history.exportStacks()))
    .catch((err) => {
      console.error(err);
      toast(t("toast.autosaveFail"));
    });
  return saveChain;
}

const editor = createEditor({
  getDemo,
  setDemo,
  getSelectedIndex,
  setSelectedIndex,
  toast,
  onChange,
  onPlayFrom: (index, opts = {}) => {
    setSelectedIndex(index);
    enterPresentation({
      from: index,
      autoplay: !!opts.autoplay,
      indices: opts.indices,
    });
  },
  ensureHostedFeature,
  presentHostedFailure,
  showHostedBadge,
});

const player = createPlayer({
  getDemo,
  getSelectedIndex,
  setSelectedIndex,
  toast,
  onRequestExit: () => exitPresentation(),
});

let chromeView = "library";
let presenting = false;

function paintChrome() {
  const view = chromeView;
  const libraryView = document.getElementById("view-library");
  const editorView = document.getElementById("view-editor");
  const helpView = document.getElementById("view-help");
  const actionsEditor = document.getElementById("topbar-actions-editor");
  const actionsLibrary = document.getElementById("topbar-actions-library");
  const navEditor = document.getElementById("topbar-nav-editor");
  const moreEditorOnly = document.getElementById("more-editor-only");
  const projectLabel = document.getElementById("topbar-project");
  const title = document.getElementById("topbar-title");
  const presentChrome = document.getElementById("present-chrome");
  const presentClose = document.getElementById("present-close");
  const rotateHint = document.getElementById("rotate-hint");
  const compact = isCompactTouch();

  document.body.classList.toggle("is-compact-touch", compact);

  libraryView.hidden = view !== "library";
  editorView.hidden = view !== "editor";
  if (helpView) helpView.hidden = true;
  actionsEditor.hidden = view === "library" || presenting;
  actionsLibrary.hidden = view !== "library";
  if (navEditor) navEditor.hidden = view !== "editor" || presenting || compact;
  const inEditor = view === "editor" && !presenting;
  if (moreEditorOnly) moreEditorOnly.hidden = !inEditor;
  document.querySelectorAll(".more-editor-pref").forEach((el) => {
    const hidePrefs = !inEditor || compact;
    el.hidden = hidePrefs;
    if (hidePrefs) el.open = false;
  });
  if (presentChrome) presentChrome.hidden = !presenting || view !== "editor";
  if (presentClose) presentClose.hidden = !presenting || view !== "editor" || !compact;
  if (rotateHint) {
    rotateHint.hidden = !presenting || view !== "editor" || !compact || isCompactLandscape();
  }

  if (view === "library") {
    title.hidden = false;
    title.textContent = t("topbar.tagline");
    if (projectLabel) projectLabel.hidden = true;
  } else if (presenting) {
    title.hidden = compact;
    title.textContent = t("topbar.presenting");
    if (projectLabel) projectLabel.hidden = true;
  } else {
    title.hidden = true;
    title.textContent = "";
    if (projectLabel) {
      projectLabel.hidden = compact;
      projectLabel.textContent = project?.name || "";
    }
  }
  paintAccount();
}

function setChrome(view) {
  chromeView = view;
  paintChrome();
}

function enterPresentation(opts = {}) {
  if (!project) {
    showLibrary();
    return;
  }
  project.theme = formToTheme(project.theme);
  applyTheme(project.theme);
  editor.stopPreview?.();
  editor.pauseCaption?.();
  presenting = true;
  document.body.classList.add("is-presenting");
  document.getElementById("view-editor")?.classList.add("is-presenting");
  document.getElementById("hotspot")?.classList.add("is-previewing");
  setChrome("editor");
  paintChrome();
  player.play(opts);
}

function exitPresentation() {
  if (!presenting && !document.getElementById("view-editor")?.classList.contains("is-presenting")) {
    player.stop?.();
    return;
  }
  presenting = false;
  player.stop?.();
  document.body.classList.remove("is-presenting");
  document.getElementById("view-editor")?.classList.remove("is-presenting");
  document.getElementById("hotspot")?.classList.remove("is-previewing");
  paintChrome();
  if (project && chromeView === "editor") editor.refresh();
}

function openEditor() {
  if (!project) {
    showLibrary();
    return;
  }
  project.theme = formToTheme(project.theme);
  applyTheme(project.theme);
  exitPresentation();
  setChrome("editor");
  editor.refresh();
  paintShareMenu();
}

function paintShareMenu() {
  const publishBtn = document.getElementById("btn-share-publish");
  const actions = document.getElementById("share-link-actions");
  const hasShare = Boolean(project?.share?.id && project?.share?.writeToken);
  if (publishBtn) publishBtn.hidden = hasShare;
  if (actions) actions.hidden = !hasShare;
  paintCloudShare();
}

function cloudShareEnabled() {
  return isCloudEnabled() && getCloudFlags().permanentShare;
}

let accountDialogWantsPublish = false;
let billingView = { status: "idle" };
let billingEntitlement = emptyEntitlement();
let billingTicket = 0;
let upgradeCustomMessage = "";
let upgradeFeature = "";
let upgradeEmail = "";
let upgradeEmailNote = false;
let upgradeHandoffToLogin = false;
let pendingHostedResume = null;
let pendingHostedFeature = "";
const LOCAL_SAVE_DISMISS_KEY = "guiaflow.localSaveDismissed";

function accountInitial(email) {
  const ch = String(email || "").trim().charAt(0);
  return ch ? ch.toUpperCase() : "?";
}

function paintAccount() {
  const enabled = isCloudEnabled();
  const account = enabled ? getCloudAccount() : { signedIn: false, email: "" };
  const signedIn = Boolean(account.signedIn);
  const label = signedIn ? account.email || t("share.cloud.signedInAnon") : "";
  const slot = document.getElementById("account-slot");
  const signInBtn = document.getElementById("btn-account-signin");
  const chip = document.getElementById("account-chip");
  const avatar = document.getElementById("account-avatar");
  const emailEl = document.getElementById("account-chip-email");
  const toggle = document.getElementById("account-chip-toggle");
  if (slot) slot.hidden = !enabled;
  if (signInBtn) signInBtn.hidden = !enabled || signedIn;
  if (chip) {
    chip.hidden = !signedIn;
    if (!signedIn) chip.open = false;
  }
  if (emailEl) emailEl.textContent = label;
  if (avatar) avatar.textContent = signedIn ? accountInitial(account.email) : "";
  if (toggle && signedIn) {
    toggle.setAttribute("aria-label", label);
    toggle.setAttribute("title", label);
  }
  const menu = billingMenuModel({
    signedIn,
    status: billingView.status,
    entitlement: billingEntitlement,
  });
  const planEl = document.getElementById("account-chip-plan");
  const billingBtn = document.getElementById("btn-account-billing");
  if (planEl) {
    planEl.hidden = !menu.showPlan;
    if (menu.showPlan) {
      planEl.textContent = t("billing.planLine", { plan: t("billing.planCloud") });
    }
  }
  if (billingBtn) {
    billingBtn.hidden = !menu.showAction;
    if (menu.showAction) {
      billingBtn.textContent = menu.action === "portal" ? t("billing.manage") : t("billing.subscribeMenu");
    }
  }
  editor.paintHostedBadges?.();
  paintExportMark();
  paintLocalSave();
}

function resetBillingView() {
  billingTicket += 1;
  billingView = { status: "idle" };
  billingEntitlement = emptyEntitlement();
}

async function refreshEntitlement(sessionId = "") {
  if (!isCloudEnabled() || !getCloudAccount().signedIn) {
    resetBillingView();
    paintAccount();
    return null;
  }
  const ticket = ++billingTicket;
  const result = await fetchBillingEntitlement(sessionId);
  if (ticket !== billingTicket) return result;
  if (result?.ok && result.entitlement) {
    billingView = { status: "ready" };
    billingEntitlement = result.entitlement;
  } else {
    billingView = { status: "hidden" };
    billingEntitlement = emptyEntitlement();
  }
  paintAccount();
  paintCloudShare();
  editor.paintHostedBadges?.();
  paintExportMark();
  return result;
}

function localSaveDismissed() {
  try {
    return localStorage.getItem(LOCAL_SAVE_DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function paintLocalSave() {
  const signedIn = Boolean(getCloudAccount().signedIn);
  const show = shouldShowLocalSave({
    signedIn,
    active: Boolean(billingEntitlement.active),
    billingReady: !signedIn || billingView.status === "ready" || billingView.status === "hidden",
    dismissed: localSaveDismissed(),
  });
  for (const id of ["local-save-library", "local-save-editor"]) {
    const el = document.getElementById(id);
    if (el) el.hidden = !show;
  }
}

function paintUpgradeCopy() {
  const featured = upgradeFeature && upgradeFeature !== "account";
  const copy = upgradeCopyKeys(upgradeFeature);
  const title = document.getElementById("upgrade-dialog-title");
  if (title) title.textContent = featured ? t(copy.title) : t("billing.title");
  const msg = document.getElementById("upgrade-message");
  if (msg) {
    const lead = upgradeCustomMessage || (featured ? t(copy.subtitle) : t("billing.heroLead"));
    msg.textContent = String(lead || "").slice(0, 500);
  }
  const note = document.getElementById("upgrade-email-note");
  if (note) {
    note.hidden = !upgradeEmailNote;
    note.textContent = upgradeEmailNote ? t("billing.emailMissing") : "";
  }
  const currency = paywallCurrency(getLocale());
  const offer = paywallOffer(currency);
  for (const node of document.querySelectorAll("[data-price]")) {
    const amount = node.getAttribute("data-price") === "year" ? offer.year : offer.month;
    node.textContent = formatPaywallAmount(amount, currency);
  }
  const save = document.getElementById("paywall-save");
  if (save) save.textContent = t("billing.savePercent", { percent: offer.percent });
  const equiv = document.getElementById("paywall-equiv");
  if (equiv) equiv.textContent = t("billing.monthEquiv", { price: formatPaywallAmount(offer.monthEquiv, currency) });
  const list = document.getElementById("paywall-benefits");
  if (list) {
    const order = paywallFeatureOrder(upgradeFeature);
    for (const id of order) {
      const item = list.querySelector(`[data-feature="${id}"]`);
      if (item) list.appendChild(item);
    }
    const highlight = upgradeFeature ? order[0] : "";
    for (const item of list.querySelectorAll("[data-feature]")) {
      item.classList.toggle("is-highlight", item.dataset.feature === highlight);
    }
  }
}

function billingSnapshot() {
  return {
    cloudEnabled: isCloudEnabled(),
    signedIn: getCloudAccount().signedIn,
    status: billingView.status,
    active: Boolean(billingEntitlement.active),
  };
}

function showHostedBadge({ hasByok = false } = {}) {
  return shouldShowProBadge({ ...billingSnapshot(), hasByok });
}

function paintExportMark() {
  const btn = document.getElementById("btn-export-unbrand");
  if (!btn) return;
  btn.hidden = !exportShowsWatermark(billingSnapshot());
}

async function ensureHostedFeature(feature, resume) {
  if (!isCloudEnabled()) return "unavailable";
  if (getCloudAccount().signedIn && billingView.status !== "ready" && billingView.status !== "hidden") {
    await refreshEntitlement();
  }
  const access = hostedAccess({ ...billingSnapshot(), hasByok: false });
  if (access === "upgrade") {
    pendingHostedFeature = feature;
    pendingHostedResume = typeof resume === "function" ? resume : null;
    showUpgradeDialog({ feature });
    return "blocked";
  }
  return "proceed";
}

function presentHostedFailure(result, feature) {
  const gate = classifyCloudGate(result);
  const which = gate.feature || feature;
  if (gate.kind === "subscription_required") {
    showUpgradeDialog({ feature: which, message: gate.message });
    return true;
  }
  if (gate.kind === "quota_exceeded") {
    toast(gate.message || t(quotaMessageKey(which)));
    return true;
  }
  if (gate.kind === "unauthorized") {
    pendingHostedFeature = which;
    showAccountDialog();
    setCloudLoginStatus(t("share.cloud.unauthorized"), "error");
    return true;
  }
  if (result?.status === 503 || result?.error === "config_missing" || gate.kind === "unavailable") {
    toast(t("billing.unconfigured"));
    return true;
  }
  if (result?.status === 502) {
    toast(gate.message || t("billing.unavailable"));
    return true;
  }
  if (gate.kind === "not_found") {
    toast(t("billing.unavailable"));
    return true;
  }
  return false;
}

function setUpgradeStatus(message, tone = "") {
  const status = document.getElementById("upgrade-status");
  if (!status) return;
  status.textContent = message || "";
  status.classList.toggle("is-error", tone === "error");
  status.classList.toggle("is-ok", tone === "ok");
}

function showUpgradeDialog({ message = "", feature = "", email = "", emailNote = false } = {}) {
  if (!isCloudEnabled()) return;
  upgradeFeature = feature || "";
  upgradeCustomMessage = String(message || "").trim();
  upgradeEmail = String(email || "").trim();
  upgradeEmailNote = Boolean(emailNote && upgradeEmail);
  const dialog = document.getElementById("modal-upgrade");
  if (!dialog) return;
  paintUpgradeCopy();
  setUpgradeStatus("");
  const button = document.getElementById("btn-upgrade-subscribe");
  if (button) button.disabled = false;
  if (!dialog.open) dialog.showModal();
}

function closeUpgradeDialog() {
  const dialog = document.getElementById("modal-upgrade");
  if (dialog?.open) dialog.close();
}

function cloudShareNeedsUpgrade() {
  return billingView.status === "ready" && !billingEntitlement.active;
}

async function consumeBillingReturn() {
  const found = readBillingReturn(location.href);
  if (found.kind) applyCloudAuthHref(stripBillingReturn(location.href));
  if (!isCloudEnabled() || !found.kind) return;
  if (found.kind === "cancel") {
    toast(t("billing.toastCancel"), 4200);
    return;
  }
  if (getCloudAccount().signedIn && (found.kind === "welcome" || found.kind === "pending" || found.kind === "portal")) {
    await refreshEntitlement(found.sessionId || "");
  }
  if (found.kind === "welcome") toast(t("billing.toastWelcome"), 4800);
  else if (found.kind === "pending") toast(t("billing.toastPending"), 4800);
}

async function openBillingPortal() {
  const result = await startBillingPortal();
  if (result?.status === 401 || result?.error === "unauthorized") {
    await endCloudSession();
    resetBillingView();
    paintCloudShare();
    showAccountDialog();
    setCloudLoginStatus(t("share.cloud.unauthorized"), "error");
    return;
  }
  if (!result?.ok || !result.url) {
    toast(result?.error === "network" ? t("share.cloud.network") : t("billing.unavailable"));
    return;
  }
  location.assign(result.url);
}

async function submitUpgrade(interval) {
  const button = document.getElementById("btn-upgrade-subscribe");
  if (button) button.disabled = true;
  setUpgradeStatus("");
  try {
    const result = await startBillingCheckout({
      interval,
      currency: paywallCurrency(getLocale()),
      email: upgradeEmail || getCloudAccount().email || "",
      source: upgradeFeature || "account",
    });
    if (result?.status === 401 || result?.error === "unauthorized") {
      closeUpgradeDialog();
      await endCloudSession();
      resetBillingView();
      paintCloudShare();
      showAccountDialog();
      setCloudLoginStatus(t("share.cloud.unauthorized"), "error");
      return;
    }
    if (!result?.ok || !result.url) {
      setUpgradeStatus(
        result?.error === "network" ? t("share.cloud.network") : t("billing.unavailable"),
        "error"
      );
      return;
    }
    location.assign(result.url);
  } catch (err) {
    console.error(err);
    setUpgradeStatus(t("billing.unavailable"), "error");
  } finally {
    if (button) button.disabled = false;
  }
}

function setCloudLoginStatus(message, tone = "") {
  const status = document.getElementById("cloud-login-status");
  if (!status) return;
  status.textContent = message || "";
  status.classList.toggle("is-error", tone === "error");
  status.classList.toggle("is-ok", tone === "ok");
}

function showAccountDialog({ publish = false } = {}) {
  if (!isCloudEnabled()) return;
  accountDialogWantsPublish = publish;
  const dialog = document.getElementById("modal-account");
  if (!dialog) return;
  setCloudLoginStatus("");
  if (!dialog.open) dialog.showModal();
  document.getElementById("cloud-email")?.focus();
}

function closeAccountDialog() {
  const dialog = document.getElementById("modal-account");
  if (dialog?.open) dialog.close();
}

function closeAccountMenus() {
  const chip = document.getElementById("account-chip");
  if (chip) chip.open = false;
  const more = document.getElementById("more-panel");
  if (more) more.open = false;
}

function paintCloudShare() {
  const block = document.getElementById("cloud-share-block");
  if (!block) return;
  const enabled = cloudShareEnabled();
  block.hidden = !enabled;
  const signedIn = enabled && getCloudAccount().signedIn;
  const url = signedIn ? String(project?.cloudShare?.url || "") : "";
  const guest = document.getElementById("cloud-share-guest");
  const publishBtn = document.getElementById("btn-cloud-share");
  const result = document.getElementById("cloud-share-actions");
  const urlInput = document.getElementById("cloud-share-url");
  if (guest) guest.hidden = !enabled || signedIn;
  if (publishBtn) publishBtn.hidden = !signedIn || Boolean(url);
  if (result) result.hidden = !url;
  if (urlInput) urlInput.value = url;
  const badge = document.getElementById("cloud-share-badge");
  if (badge) {
    badge.hidden = Boolean(url) || !shouldShowProBadge({ ...billingSnapshot(), hasByok: false });
  }
  paintAccount();
}

let resumeCloudPublishAfterLogin = async () => {};

function applyCloudAuthHref(href) {
  if (!href) return;
  try {
    const next = new URL(href, location.href);
    if (next.origin !== location.origin) return;
    const relative = `${next.pathname}${next.search}${next.hash}`;
    const current = `${location.pathname}${location.search}${location.hash}`;
    if (relative === current) return;
    // why: `history` neste módulo é a pilha de desfazer, não a do navegador.
    //      replaceState cedo demais também pode ser reposto pelo carregamento.
    window.history.replaceState(null, "", relative);
  } catch (err) {
    console.error(err);
  }
}

function showStashedAuthError() {
  const code = takeCloudAuthError();
  if (!code) return;
  showAccountDialog();
  setCloudLoginStatus(permanentShareErrorMessage({ error: code }), "error");
}

async function finishCloudAuthCallback(callback) {
  if (!callback?.consumed) return;
  paintCloudShare();
  if (!callback.ok) {
    showAccountDialog();
    setCloudLoginStatus(permanentShareErrorMessage(callback), "error");
    return;
  }
  closeAccountDialog();
  await resumeCloudPublishAfterLogin({ delay: 800 });
}

function syncThemeUi() {
  if (!project?.theme) return;
  applyTheme(project.theme);
  themeToForm(project.theme);
  themeSelection = matchThemeSelection(project.theme, getCustomThemes());
  renderThemePanel();
  const delBtn = document.getElementById("btn-del-theme");
  delBtn.hidden = !(themeSelection.kind === "custom" && themeSelection.id);
}

function renderThemeSwatches(container, items, { selectedId, onPick, customActions } = {}) {
  if (!container) return;
  container.innerHTML = items
    .map((item) => {
      const colors = item.colors || item;
      const id = item.id;
      const name = item.id && THEME_PRESETS.some((p) => p.id === item.id)
        ? themePresetName(item.id, item.name)
        : item.name || id;
      const active = selectedId && id === selectedId ? "is-active" : "";
      return `
        <button type="button" class="theme-swatch ${active}" data-theme-id="${id}" title="${escapeAttr(name)}">
          <span class="theme-swatch-dots">
            <i style="background:${colors.accent}"></i>
            <i style="background:${colors.popoverBg};border:1px solid var(--ns-border)"></i>
            <i style="background:${colors.button}"></i>
          </span>
          <span class="theme-swatch-name">${escapeHtml(name)}</span>
        </button>`;
    })
    .join("");

  if (!items.length && customActions) {
    container.innerHTML = `<p class="theme-empty">${escapeHtml(t("theme.empty"))}</p>`;
  }

  container.querySelectorAll("[data-theme-id]").forEach((btn) => {
    btn.addEventListener("click", () => onPick?.(btn.dataset.themeId));
  });
}

function renderThemePanel() {
  const customs = getCustomThemes();
  renderThemeSwatches(document.getElementById("theme-presets"), THEME_PRESETS, {
    selectedId: themeSelection.kind === "preset" ? themeSelection.id : null,
    onPick: (id) => applyPresetTheme(id),
  });
  renderThemeSwatches(document.getElementById("theme-customs"), customs, {
    selectedId: themeSelection.kind === "custom" ? themeSelection.id : null,
    onPick: (id) => applyCustomTheme(id),
    customActions: true,
  });
}

function applyPresetTheme(id) {
  const preset = getPreset(id);
  if (!preset || !project) return;
  project.theme = cloneTheme(preset.colors, { presetId: id });
  delete project.theme.customId;
  themeSelection = { kind: "preset", id };
  syncThemeUi();
  onChange();
}

function applyCustomTheme(id) {
  const custom = getCustomThemes().find((t) => t.id === id);
  if (!custom || !project) return;
  project.theme = cloneTheme(custom.colors, { customId: id });
  delete project.theme.presetId;
  themeSelection = { kind: "custom", id };
  syncThemeUi();
  onChange();
}

function renderNewProjectThemes() {
  renderThemeSwatches(document.getElementById("new-project-themes"), THEME_PRESETS, {
    selectedId: selectedNewThemeId,
    onPick: (id) => {
      selectedNewThemeId = id;
      renderNewProjectThemes();
    },
  });
}

function formatDate(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function renderLibrary() {
  const index = readIndex();
  const grid = document.getElementById("library-grid");
  const empty = document.getElementById("library-empty");
  const projects = index.projects || [];

  const hint = document.getElementById("library-import-hint");
  const compact = isCompactTouch();
  if (!projects.length) {
    grid.innerHTML = "";
    empty.hidden = compact;
    if (!compact) empty.textContent = t("library.empty");
    if (hint) hint.hidden = !compact;
    return;
  }
  empty.hidden = true;
  if (hint) hint.hidden = true;

  grid.innerHTML = projects
    .map((p) => {
      const dots = (p.themePreview || [])
        .map((c) => `<i style="background:${c}"></i>`)
        .join("");
      const thumbSrc = p.thumb && !isHeavyDataUrl(p.thumb) ? p.thumb : "";
      const thumb = thumbSrc
        ? `<img src="${escapeAttr(thumbSrc)}" alt="" loading="lazy" decoding="async" />`
        : `<div class="project-card-placeholder">${escapeHtml(t("library.demoPlaceholder"))}</div>`;
      return `
        <article class="project-card" data-id="${escapeAttr(p.id)}" tabindex="0" aria-label="${escapeAttr(t("library.openAria", { name: p.name }))}">
          <button type="button" class="project-card-close" data-action="delete" title="${escapeAttr(t("library.deleteTitle"))}" aria-label="${escapeAttr(t("library.deleteAria", { name: p.name }))}">
            <svg class="btn-ico" aria-hidden="true"><use href="#i-close"></use></svg>
          </button>
          <div class="project-card-thumb">${thumb}</div>
          <div class="project-card-body">
            <h3 class="project-card-title" data-action="rename-inline" title="${escapeAttr(t("library.renameTitle"))}">${escapeHtml(p.name)}</h3>
            <p>${p.stepCount || 0} passo(s) · ${escapeHtml(formatDate(p.updatedAt))}</p>
            <div class="project-card-dots">${dots}</div>
            <div class="project-card-actions">
              <button type="button" class="btn btn-sm" data-action="export">
                <svg class="btn-ico" aria-hidden="true"><use href="#i-export"></use></svg>
                Exportar
              </button>
              <button type="button" class="btn btn-sm" data-action="duplicate">
                <svg class="btn-ico" aria-hidden="true"><use href="#i-copy"></use></svg>
                Duplicar
              </button>
            </div>
          </div>
        </article>`;
    })
    .join("");
  scheduleLibraryThumbSlim();
}

let slimmingLibraryThumbs = false;

function scheduleLibraryThumbSlim() {
  if (slimmingLibraryThumbs) return;
  const index = readIndex();
  if (!(index.projects || []).some((p) => isHeavyDataUrl(p.thumb))) return;
  slimmingLibraryThumbs = true;
  void slimLibraryThumbs().finally(() => {
    slimmingLibraryThumbs = false;
  });
}

async function slimLibraryThumbs() {
  const index = readIndex();
  let changed = false;
  for (const project of index.projects || []) {
    if (!isHeavyDataUrl(project.thumb)) continue;
    try {
      project.thumb = (await downscaleImageUrl(project.thumb, { maxEdge: 480, quality: 0.72 })) || null;
    } catch {
      project.thumb = null;
    }
    delete project.thumbSig;
    changed = true;
  }
  if (!changed) return;
  const fresh = readIndex();
  const slimById = new Map((index.projects || []).map((p) => [p.id, p.thumb]));
  for (const project of fresh.projects || []) {
    if (!slimById.has(project.id) || !isHeavyDataUrl(project.thumb)) continue;
    project.thumb = slimById.get(project.id) || null;
    delete project.thumbSig;
  }
  writeIndex(fresh);
  if (chromeView === "library") renderLibrary();
}

function clearBootGate() {
  document.body.classList.remove("is-booting");
  const splash = document.getElementById("boot-splash");
  if (splash) {
    splash.hidden = true;
    splash.setAttribute("aria-busy", "false");
  }
}

function setProjectOpenBusy(busy) {
  document.body.classList.toggle("is-opening-project", busy);
  document.body.setAttribute("aria-busy", busy ? "true" : "false");
  const overlay = document.getElementById("project-open-overlay");
  if (!overlay) return;
  if (!busy) {
    overlay.hidden = true;
    overlay.setAttribute("aria-busy", "false");
  }
}

async function openProject(id, { autoPreview = false } = {}) {
  const overlay = document.getElementById("project-open-overlay");
  const showOverlayTimer = setTimeout(() => {
    // why: no boot o splash já cobre — evita overlay duplicado piscando
    if (document.body.classList.contains("is-booting")) return;
    if (overlay) {
      overlay.hidden = false;
      overlay.setAttribute("aria-busy", "true");
    }
  }, 150);
  setProjectOpenBusy(true);
  try {
    const loaded = await getProject(id);
    if (!loaded) {
      toast(t("toast.projectNotFound"));
      return;
    }
    if (!loaded.customImages) loaded.customImages = {};
    if (!loaded.steps) loaded.steps = [];
    normalizeSteps(loaded.steps);
    ensurePlayback(loaded);
    ensureNarration(loaded);
    project = loaded;
    selectedIndex = 0;
    await attachSavedHistory(project);
    await setActiveProjectId(id);
    syncThemeUi();

    openEditor();
    if (isCompactTouch()) {
      if (autoPreview && loaded.steps.length) toast(t("toast.editOnTouch"), 4200);
      else toast(t("toast.opened", { name: loaded.name }));
      return;
    }

    if (autoPreview && loaded.steps.length) {
      // why: deixa o editor pintar o palco antes do tour automático da primeira visita
      requestAnimationFrame(() => {
        enterPresentation({ from: 0, autoplay: true });
      });
      toast(t("toast.watchExample"));
    } else {
      toast(t("toast.opened", { name: loaded.name }));
    }
  } finally {
    clearTimeout(showOverlayTimer);
    setProjectOpenBusy(false);
  }
}

async function closeProject() {
  if (project) {
    project.theme = formToTheme(project.theme);
    clearTimeout(settleTimer);
    history.settle(project);
    saveDirty = true;
    await flushAutosave();
  }
  presenting = false;
  document.body.classList.remove("is-presenting");
  document.getElementById("view-editor")?.classList.remove("is-presenting");
  document.getElementById("hotspot")?.classList.remove("is-previewing");
  project = null;
  selectedIndex = 0;
  rememberProject(null);
  await setActiveProjectId(null);
  showLibrary();
}

function openNewProjectDialog() {
  selectedNewThemeId = resolveAppearanceMode(appearancePreference);
  document.getElementById("new-project-name").value = "";
  renderNewProjectThemes();
  document.getElementById("modal-new-project").showModal();
}

function showLibrary() {
  exitPresentation();
  player.stop?.();
  applyChromeAppearance();
  setChrome("library");
  renderLibrary();
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(str) {
  return escapeHtml(str);
}

function bindChrome() {
  document.getElementById("btn-menu-projects")?.addEventListener("click", () => {
    const more = document.getElementById("more-panel");
    if (more) more.open = false;
    closeProject();
  });
  document.getElementById("btn-menu-new")?.addEventListener("click", () => {
    const more = document.getElementById("more-panel");
    if (more) more.open = false;
    openNewProjectDialog();
  });
  document.getElementById("btn-menu-open")?.addEventListener("click", () => {
    const more = document.getElementById("more-panel");
    if (more) more.open = false;
    if (chromeView === "library") {
      document.getElementById("library-board")?.focus();
      return;
    }
    void closeProject();
  });
  document.getElementById("btn-menu-import")?.addEventListener("click", () => {
    const more = document.getElementById("more-panel");
    if (more) more.open = false;
    document.getElementById("import-file")?.click();
  });
  document.getElementById("btn-shortcuts")?.addEventListener("click", () => {
    const more = document.getElementById("more-panel");
    if (more) more.open = false;
    document.getElementById("modal-shortcuts")?.showModal();
  });
  document.getElementById("btn-close-shortcuts")?.addEventListener("click", () => {
    document.getElementById("modal-shortcuts")?.close();
  });
  document.getElementById("modal-shortcuts")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) e.currentTarget.close();
  });
  document.getElementById("btn-undo")?.addEventListener("click", () => undoEdit());
  document.getElementById("btn-redo")?.addEventListener("click", () => redoEdit());
  document.getElementById("present-close")?.addEventListener("click", () => exitPresentation());

  if (window.matchMedia) {
    const onCompactChrome = () => {
      paintChrome();
      if (chromeView === "library") renderLibrary();
    };
    for (const query of [COMPACT_TOUCH_MQ, COMPACT_LANDSCAPE_MQ]) {
      const mq = window.matchMedia(query);
      if (mq.addEventListener) mq.addEventListener("change", onCompactChrome);
      else if (mq.addListener) mq.addListener(onCompactChrome);
    }
  }

  window.addEventListener("keydown", (e) => {
    if (!project) return;
    if (presenting) return;
    if (document.querySelector("dialog[open]")) return;
    if (isTypingTarget(e.target)) return;
    const mod = e.metaKey || e.ctrlKey;
    if (!mod || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === "z" && !e.shiftKey) {
      e.preventDefault();
      undoEdit();
    } else if ((key === "z" && e.shiftKey) || key === "y") {
      e.preventDefault();
      redoEdit();
    }
  });

  const persistOnLeave = () => {
    void flushAutosave();
  };
  window.addEventListener("pagehide", persistOnLeave);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") persistOnLeave();
  });

  document.getElementById("appearance-segment")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".appearance-opt");
    if (!btn) return;
    const next = btn.getAttribute("data-mode");
    if (!next || next === appearancePreference) return;
    appearancePreference = next;
    setAppearancePreference(appearancePreference);
    syncAppearanceOnly();
  });

  const flyouts = [
    document.getElementById("narration-panel"),
    document.getElementById("theme-panel"),
  ].filter(Boolean);
  const settingsFolds = [
    document.getElementById("settings-tts"),
    document.getElementById("settings-llm"),
  ].filter(Boolean);
  const flyoutHoverMq =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(hover: hover) and (min-width: 701px)")
      : null;
  const flyoutHover = () => Boolean(flyoutHoverMq?.matches);
  /** @type {Map<HTMLElement, ReturnType<typeof setTimeout>>} */
  const flyoutCloseTimers = new Map();

  function clearFlyoutPlacement(body) {
    if (!body) return;
    body.style.top = "";
    body.style.maxHeight = "";
  }

  /** why: Preferências/Temas com top:0 estouravam a viewport ao expandir Cartesia/IA */
  function placeMoreFlyout(panel) {
    const body = panel?.querySelector(":scope > .more-flyout-body");
    if (!body) return;
    if (!flyoutHover() || !panel.open) {
      clearFlyoutPlacement(body);
      return;
    }
    const pad = 12;
    const vh = window.innerHeight;
    const cap = Math.min(560, Math.floor(vh * 0.7));
    body.style.top = "0px";
    body.style.maxHeight = `${cap}px`;
    const panelRect = panel.getBoundingClientRect();
    const spaceBelow = vh - pad - panelRect.top;
    const spaceAbove = panelRect.bottom - pad;
    let maxH;
    let top;
    if (spaceBelow >= 200 || spaceBelow >= spaceAbove) {
      maxH = Math.min(cap, Math.max(140, spaceBelow));
      top = 0;
      if (panelRect.top + maxH > vh - pad) {
        top = vh - pad - maxH - panelRect.top;
        if (panelRect.top + top < pad) {
          top = pad - panelRect.top;
          maxH = Math.max(120, vh - pad * 2);
        }
      }
    } else {
      maxH = Math.min(cap, Math.max(140, spaceAbove));
      top = panelRect.height - maxH;
      const absTop = panelRect.top + top;
      if (absTop < pad) {
        top = pad - panelRect.top;
        maxH = Math.max(120, panelRect.bottom - pad);
      }
    }
    body.style.top = `${Math.round(top)}px`;
    body.style.maxHeight = `${Math.max(120, Math.round(maxH))}px`;
  }

  function placeOpenFlyouts() {
    for (const panel of flyouts) placeMoreFlyout(panel);
  }

  for (const panel of flyouts) {
    panel.addEventListener("toggle", () => {
      if (!panel.open) {
        clearFlyoutPlacement(panel.querySelector(":scope > .more-flyout-body"));
        return;
      }
      for (const other of flyouts) {
        if (other !== panel) other.open = false;
      }
      requestAnimationFrame(placeOpenFlyouts);
    });
    const summary = panel.querySelector(":scope > summary");
    summary?.addEventListener("click", (e) => {
      // why: no desktop o submenu abre no hover; o clique nativo do details atrapalhava
      if (!flyoutHover()) return;
      e.preventDefault();
    });
    // why: Excalidraw abre Preferences no hover — sem precisar clicar
    panel.addEventListener("pointerenter", () => {
      if (!flyoutHover()) return;
      const pending = flyoutCloseTimers.get(panel);
      if (pending) {
        clearTimeout(pending);
        flyoutCloseTimers.delete(panel);
      }
      for (const other of flyouts) {
        if (other !== panel) other.open = false;
      }
      panel.open = true;
      requestAnimationFrame(placeOpenFlyouts);
    });
    panel.addEventListener("pointerleave", () => {
      if (!flyoutHover()) return;
      const pending = flyoutCloseTimers.get(panel);
      if (pending) clearTimeout(pending);
      flyoutCloseTimers.set(
        panel,
        setTimeout(() => {
          panel.open = false;
          flyoutCloseTimers.delete(panel);
        }, 160),
      );
    });
  }

  // why: Cartesia/IA só no clique — hover automático atrapalhava ao passar pelo painel
  for (const fold of settingsFolds) {
    fold.addEventListener("toggle", () => {
      if (!fold.open) return;
      for (const other of settingsFolds) {
        if (other !== fold) other.open = false;
      }
      const host = fold.closest(".more-flyout");
      requestAnimationFrame(() => {
        placeMoreFlyout(host);
        fold.scrollIntoView({ block: "nearest", inline: "nearest" });
      });
    });
  }

  window.addEventListener("resize", placeOpenFlyouts);

  if (window.matchMedia) {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onScheme = () => {
      if (appearancePreference !== "system") return;
      syncAppearanceOnly();
    };
    if (mq.addEventListener) mq.addEventListener("change", onScheme);
    else if (mq.addListener) mq.addListener(onScheme);
  }

  document.getElementById("topbar-project")?.addEventListener("click", (e) => {
    if (!project || e.target.closest("input")) return;
    const host = e.currentTarget;
    beginInlineEdit(host, {
      value: project.name,
      onSave: async (name) => {
        project.name = name;
        host.textContent = name;
        onChange();
        toast(t("toast.renamed"));
      },
    });
  });
  document.getElementById("topbar-project")?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (!project || e.target.closest("input")) return;
    e.preventDefault();
    e.currentTarget.click();
  });

  // Fecha painéis Tema / Narração / Exportar / Mais ao clicar fora
  const menuPanel = document.getElementById("more-panel");
  const menuButton = document.getElementById("btn-menu");
  menuPanel?.addEventListener("toggle", () => {
    menuButton?.setAttribute("aria-expanded", menuPanel.open ? "true" : "false");
  });

  document.addEventListener("pointerdown", (e) => {
    document
      .querySelectorAll(
        "details.theme-panel[open], details.export-panel[open], details.more-panel[open], details.account-chip[open]",
      )
      .forEach((panel) => {
        if (!panel.contains(e.target)) panel.open = false;
      });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !menuPanel?.open) return;
    if (document.querySelector("dialog[open]")) return;
    e.preventDefault();
    e.stopPropagation();
    menuPanel.open = false;
    menuButton?.focus();
  });

  const captureBtns = [
    document.getElementById("btn-capture-desktop"),
    document.getElementById("btn-capture-desktop-lib"),
  ].filter(Boolean);
  if (window.guiaDesktopApp?.isDesktop) {
    for (const captureBtn of captureBtns) {
      captureBtn.hidden = false;
      captureBtn.addEventListener("click", async () => {
        try {
          await window.guiaDesktopApp.openCapture();
        } catch (err) {
          console.error(err);
          toast(err?.message || t("toast.captureWindowFail"));
        }
      });
    }
  }

  document.getElementById("btn-new-project").addEventListener("click", () => {
    openNewProjectDialog();
  });

  document.getElementById("btn-cancel-new-project").addEventListener("click", () => {
    document.getElementById("modal-new-project").close();
  });

  document.getElementById("form-new-project").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("new-project-name").value.trim();
    if (!name) return;
    const preset = getPreset(selectedNewThemeId) || THEME_PRESETS[0];
    const created = createEmptyProject({
      name,
      theme: cloneTheme(preset.colors, { presetId: preset.id }),
    });
    await putProject(created);
    document.getElementById("modal-new-project").close();
    await openProject(created.id);
  });

  document.getElementById("library-import-hint")?.addEventListener("click", () => {
    document.getElementById("import-file")?.click();
  });

  document.getElementById("import-file").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = await importDemoFile(file);
      await importCapturePayload(data, {
        name: data.name || file.name.replace(/\.json$/i, "") || t("default.importedProject"),
      });
      toast(t("toast.imported"));
    } catch (err) {
      console.error(err);
      toast(t("toast.importFail"));
    }
    e.target.value = "";
  });

  document.getElementById("library-grid").addEventListener("click", async (e) => {
    const card = e.target.closest("[data-id]");
    if (!card) return;
    const id = card.dataset.id;

    const title = e.target.closest("[data-action='rename-inline']");
    if (title) {
      e.preventDefault();
      e.stopPropagation();
      const proj = await getProject(id);
      if (!proj) return;
      beginInlineEdit(title, {
        value: proj.name,
        onSave: async (name) => {
          await renameProject(id, name);
          title.textContent = name;
          toast(t("toast.renamed"));
        },
      });
      return;
    }

    const btn = e.target.closest("[data-action]");
    if (btn) {
      const action = btn.dataset.action;
      if (action === "export") {
        const proj = await getProject(id);
        if (!proj) return;
        exportDemo(projectToDemoPayload(proj), { filename: proj.name });
        toast(t("toast.jsonExported"));
        return;
      }
      if (action === "duplicate") {
        const copy = await duplicateProject(id);
        renderLibrary();
        toast(t("toast.duplicated", { name: copy.name }));
        return;
      }
      if (action === "delete") {
        e.preventDefault();
        e.stopPropagation();
        await openDeleteProjectModal(id);
      }
      return;
    }

    await openProject(id);
  });

  document.getElementById("library-grid").addEventListener("keydown", async (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest(".project-card");
    if (!card || e.target !== card) return;
    e.preventDefault();
    await openProject(card.dataset.id);
  });

  bindDeleteProjectModal();

  // Theme panel
  document.querySelectorAll("[data-theme-key]").forEach((input) => {
    input.addEventListener("input", () => {
      if (!project) return;
      project.theme = formToTheme(project.theme);
      delete project.theme.presetId;
      delete project.theme.customId;
      themeSelection = { kind: "custom", id: null };
      applyTheme(project.theme);
      renderThemePanel();
      document.getElementById("btn-del-theme").hidden = true;
      onChange();
    });
  });

  document.getElementById("btn-save-theme").addEventListener("click", () => {
    if (!project) return;
    document.getElementById("save-theme-name").value = "";
    document.getElementById("modal-save-theme").showModal();
  });

  document.getElementById("btn-cancel-save-theme").addEventListener("click", () => {
    document.getElementById("modal-save-theme").close();
  });

  document.getElementById("form-save-theme").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!project) return;
    const name = document.getElementById("save-theme-name").value.trim();
    if (!name) return;
    project.theme = formToTheme(project.theme);
    const colors = cloneTheme(project.theme);
    const id = createThemeId();
    const themes = getCustomThemes();
    themes.unshift({ id, name, colors, createdAt: Date.now() });
    saveCustomThemes(themes);
    project.theme = cloneTheme(colors, { customId: id });
    delete project.theme.presetId;
    themeSelection = { kind: "custom", id };
    document.getElementById("modal-save-theme").close();
    syncThemeUi();
    toast(t("toast.themeSaved"));
  });

  document.getElementById("btn-dup-theme").addEventListener("click", () => {
    if (!project) return;
    project.theme = formToTheme(project.theme);
    const baseName =
      themeSelection.kind === "preset"
        ? themePresetName(themeSelection.id, getPreset(themeSelection.id)?.name) || t("theme.generic")
        : getCustomThemes().find((th) => th.id === themeSelection.id)?.name || t("theme.generic");
    document.getElementById("save-theme-name").value = t("theme.copySuffix", { name: baseName });
    document.getElementById("modal-save-theme").showModal();
  });

  document.getElementById("btn-del-theme").addEventListener("click", () => {
    if (themeSelection.kind !== "custom" || !themeSelection.id) return;
    if (!confirm(t("theme.confirmDelete"))) return;
    const themes = getCustomThemes().filter((theme) => theme.id !== themeSelection.id);
    saveCustomThemes(themes);
    themeSelection = { kind: "custom", id: null };
    syncThemeUi();
    toast(t("toast.themeDeleted"));
  });

  // Export
  const overlay = document.getElementById("export-overlay");
  const overlayTitle = document.getElementById("export-overlay-title");
  const overlayStatus = document.getElementById("export-overlay-status");
  const previewCanvas = document.getElementById("export-preview");
  const cancelBtn = document.getElementById("btn-export-cancel");
  const exportPanel = document.querySelector(".export-panel");
  let exportAbort = null;

  function closeExportMenu() {
    if (exportPanel) exportPanel.open = false;
  }

  function showExportOverlay(title, { cancelable = false, preview = false } = {}) {
    overlayTitle.textContent = title;
    overlayStatus.textContent = "";
    overlay.hidden = false;
    cancelBtn.hidden = !cancelable;
    previewCanvas.hidden = !preview;
  }

  function hideExportOverlay() {
    overlay.hidden = true;
    previewCanvas.hidden = true;
    cancelBtn.hidden = true;
    exportAbort = null;
  }

  cancelBtn.addEventListener("click", () => {
    exportAbort?.abort();
  });

  document.getElementById("btn-export-json").addEventListener("click", () => {
    closeExportMenu();
    if (!project) return;
    project.theme = formToTheme(project.theme);
    exportDemo(projectToDemoPayload(project), { filename: project.name });
    toast(t("toast.jsonExported"));
  });

  document.getElementById("btn-export-html").addEventListener("click", async () => {
    closeExportMenu();
    if (!project) return;
    project.theme = formToTheme(project.theme);
    showExportOverlay(t("export.overlayHtml"));
    try {
      const size = await exportStandaloneHtml(project, {
        onProgress: (msg) => {
          overlayStatus.textContent = msg;
        },
      });
      hideExportOverlay();
      const mb = (size / (1024 * 1024)).toFixed(1);
      toast(t("toast.htmlDownloaded", { mb }));
    } catch (err) {
      console.error(err);
      hideExportOverlay();
      toast(err?.message || t("toast.htmlFail"));
    }
  });

  document.getElementById("btn-export-unbrand")?.addEventListener("click", () => {
    closeExportMenu();
    pendingHostedFeature = "branding";
    showUpgradeDialog({ feature: "branding" });
  });

  document.getElementById("btn-export-video").addEventListener("click", async () => {
    closeExportMenu();
    if (!project) return;
    project.theme = formToTheme(project.theme);
    if (getCloudAccount().signedIn && billingView.status !== "ready" && billingView.status !== "hidden") {
      await refreshEntitlement();
    }
    const watermark = exportShowsWatermark(billingSnapshot());
    exportAbort = new AbortController();
    showExportOverlay(t("export.overlayVideo"), { cancelable: true, preview: true });
    overlayStatus.textContent = t("export.overlayVideoHint");
    try {
      const result = await exportVideo(project, {
        watermark,
        canvas: previewCanvas,
        signal: exportAbort.signal,
        onProgress: (msg) => {
          overlayStatus.textContent = msg;
        },
      });
      hideExportOverlay();
      if (result.ext === "webm") {
        toast(t("toast.webmDownloaded"));
      } else {
        toast(t("toast.videoDownloaded", { ext: result.ext }));
      }
    } catch (err) {
      console.error(err);
      hideExportOverlay();
      if (err?.name === "AbortError") {
        toast(t("toast.videoCancelled"));
      } else {
        toast(err?.message || t("toast.videoFail"));
      }
    }
  });

  async function runSharePublish({ update }) {
    closeExportMenu();
    if (!project) return;
    if (!project.steps?.length) {
      toast(t("share.errGeneric"));
      return;
    }
    project.theme = formToTheme(project.theme);
    showExportOverlay(update ? t("share.overlayUpdate") : t("share.overlay"));
    try {
      const share = await publishShareLink(project, {
        onProgress: (msg) => {
          overlayStatus.textContent = msg;
        },
      });
      project.share = {
        id: share.id,
        writeToken: share.writeToken,
        updatedAt: share.updatedAt,
      };
      saveDirty = true;
      await flushAutosave();
      paintShareMenu();
      hideExportOverlay();
      await copyText(share.url);
      toast(
        share.renewed
          ? t("toast.shareRenewed")
          : update
            ? t("toast.shareUpdated")
            : t("toast.sharePublished"),
        4200
      );
    } catch (err) {
      console.error(err);
      hideExportOverlay();
      toast(err?.message || t("share.errGeneric"));
    }
  }

  document.getElementById("btn-share-publish")?.addEventListener("click", () => {
    void runSharePublish({ update: false });
  });
  document.getElementById("btn-share-update")?.addEventListener("click", () => {
    void runSharePublish({ update: true });
  });
  document.getElementById("btn-share-copy")?.addEventListener("click", async () => {
    closeExportMenu();
    if (!project?.share?.id) return;
    try {
      await copyText(shareViewUrl(project.share.id));
      toast(t("toast.shareCopied"));
    } catch (err) {
      console.error(err);
      toast(err?.message || t("share.errGeneric"));
    }
  });
  document.getElementById("btn-account-signin")?.addEventListener("click", () => {
    showUpgradeDialog({ feature: "account" });
  });
  document.getElementById("btn-cloud-share-signin")?.addEventListener("click", () => {
    showUpgradeDialog({ feature: "permanentShare" });
  });
  document.getElementById("btn-account-signout")?.addEventListener("click", () => {
    void signOutAccount();
  });
  document.getElementById("btn-account-billing")?.addEventListener("click", () => {
    closeAccountMenus();
    if (billingView.status === "ready" && billingEntitlement.active) void openBillingPortal();
    else showUpgradeDialog();
  });
  document.getElementById("btn-upgrade-close")?.addEventListener("click", () => {
    closeUpgradeDialog();
  });
  document.getElementById("btn-upgrade-login")?.addEventListener("click", () => {
    upgradeHandoffToLogin = true;
    const email = upgradeEmail || document.getElementById("cloud-email")?.value || "";
    closeUpgradeDialog();
    showAccountDialog();
    const input = document.getElementById("cloud-email");
    if (input && email && !input.value) input.value = email;
  });
  document.getElementById("modal-upgrade")?.addEventListener("close", () => {
    if (upgradeHandoffToLogin) {
      upgradeHandoffToLogin = false;
      return;
    }
    pendingHostedResume = null;
    pendingHostedFeature = "";
  });
  document.getElementById("modal-upgrade")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) e.currentTarget.close();
  });
  document.querySelectorAll("[data-local-save-open]").forEach((button) => {
    button.addEventListener("click", () => {
      showUpgradeDialog({ feature: "account" });
    });
  });
  document.querySelectorAll("[data-local-save-dismiss]").forEach((button) => {
    button.addEventListener("click", () => {
      try {
        localStorage.setItem(LOCAL_SAVE_DISMISS_KEY, "1");
      } catch {
        /* o aviso some nesta visita */
      }
      paintLocalSave();
    });
  });
  document.getElementById("upgrade-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const picked = document.querySelector('#upgrade-form input[name="billing-interval"]:checked');
    void submitUpgrade(picked?.value || "monthly");
  });
  document.getElementById("btn-account-dialog-close")?.addEventListener("click", () => {
    closeAccountDialog();
  });
  document.getElementById("modal-account")?.addEventListener("close", () => {
    accountDialogWantsPublish = false;
    pendingHostedResume = null;
    pendingHostedFeature = "";
  });
  document.getElementById("modal-account")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) e.currentTarget.close();
  });

  document.getElementById("btn-cloud-share")?.addEventListener("click", () => {
    if (!project || !cloudShareEnabled()) return;
    if (!getCloudAccount().signedIn || cloudShareNeedsUpgrade()) {
      showUpgradeDialog({ feature: "permanentShare" });
      return;
    }
    clearCloudPublishIntent();
    void runCloudPublish();
  });

  document.getElementById("cloud-magic-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void sendCloudMagicLink();
  });

  document.getElementById("cloud-password-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void sendCloudPassword();
  });

  document.getElementById("btn-cloud-continue")?.addEventListener("click", () => {
    void continueCloudLogin();
  });

  document.getElementById("btn-cloud-copy")?.addEventListener("click", async () => {
    const url = project?.cloudShare?.url;
    if (!url) return;
    try {
      await copyText(url);
      toast(t("toast.cloudCopied"));
    } catch (err) {
      console.error(err);
      const field = document.getElementById("cloud-share-url");
      field?.focus();
      field?.select();
      toast(t("toast.cloudCopyFail"));
    }
  });

  async function signOutAccount() {
    clearCloudPublishIntent();
    accountDialogWantsPublish = false;
    closeAccountMenus();
    resetBillingView();
    await endCloudSession();
    paintCloudShare();
  }

  async function afterAccountSignedIn() {
    const publishNow = accountDialogWantsPublish;
    const resume = pendingHostedResume;
    const feature = pendingHostedFeature;
    accountDialogWantsPublish = false;
    pendingHostedResume = null;
    pendingHostedFeature = "";
    closeAccountDialog();
    paintCloudShare();
    await refreshEntitlement();
    editor.paintHostedBadges?.();
    paintExportMark();
    if (resume) {
      if (billingView.status === "ready" && !billingEntitlement.active) {
        showUpgradeDialog({ feature });
        return;
      }
      await resume();
      return;
    }
    if (publishNow && project?.id && cloudShareEnabled()) {
      clearCloudPublishIntent();
      await runCloudPublish();
      return;
    }
    await resumeCloudPublishAfterLogin({ delay: 0 });
  }

  resumeCloudPublishAfterLogin = async ({ delay = 0 } = {}) => {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    if (!project?.id || !cloudShareEnabled() || !getCloudAccount().signedIn) return;
    if (!claimCloudPublishIntent(project.id)) return;
    await runCloudPublish();
  };

  window.addEventListener("storage", (event) => {
    if (event.key !== CLOUD_SESSION_KEY) return;
    paintCloudShare();
    if (event.newValue) void resumeCloudPublishAfterLogin({ delay: 0 });
  });

  window.addEventListener("message", (event) => {
    if (!cloudShareEnabled()) return;
    const parsed = parseCloudAuthMessage(event.data, event.origin, cloudAuthMessageOrigins());
    if (!parsed) return;
    void (async () => {
      const forceKind = /^eyJ/.test(parsed.token) ? "bearer" : "magic";
      const session = await establishCloudSession(parsed.token, undefined, {
        emailHint: parsed.email,
        forceKind,
      });
      if (!session.ok) {
        showAccountDialog();
        setCloudLoginStatus(permanentShareErrorMessage(session), "error");
        return;
      }
      await afterAccountSignedIn();
    })();
  });

  async function sendCloudMagicLink() {
    const email = document.getElementById("cloud-email")?.value || "";
    const button = document.getElementById("btn-cloud-magic");
    if (button) button.disabled = true;
    setCloudLoginStatus("");
    try {
      const result = await requestMagicLink(email);
      if (isSubscriptionRequired(result)) {
        showUpgradeDialog({ feature: pendingHostedFeature || "account", email, emailNote: true });
        closeAccountDialog();
        return;
      }
      if (!result.ok) {
        setCloudLoginStatus(permanentShareErrorMessage(result), "error");
        return;
      }
      if (accountDialogWantsPublish && project?.id) writeCloudPublishIntent(project.id);
      setCloudLoginStatus(t("share.cloud.sent", { email: String(email).trim() }), "ok");
    } catch (err) {
      console.error(err);
      setCloudLoginStatus(t("share.cloud.network"), "error");
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function sendCloudPassword() {
    const email = document.getElementById("cloud-email")?.value || "";
    const password = document.getElementById("cloud-password")?.value || "";
    const button = document.getElementById("btn-cloud-password");
    if (button) button.disabled = true;
    setCloudLoginStatus("");
    try {
      const session = await loginWithPassword(email, password);
      if (isSubscriptionRequired(session)) {
        showUpgradeDialog({ feature: pendingHostedFeature || "account", email, emailNote: true });
        closeAccountDialog();
        return;
      }
      if (!session.ok) {
        setCloudLoginStatus(permanentShareErrorMessage(session), "error");
        return;
      }
      const field = document.getElementById("cloud-password");
      if (field) field.value = "";
      await afterAccountSignedIn();
    } catch (err) {
      console.error(err);
      setCloudLoginStatus(t("share.cloud.network"), "error");
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function continueCloudLogin() {
    const pasted = document.getElementById("cloud-paste")?.value || "";
    const emailHint = document.getElementById("cloud-email")?.value || "";
    const button = document.getElementById("btn-cloud-continue");
    if (button) button.disabled = true;
    try {
      const session = await establishCloudSession(pasted, undefined, { emailHint });
      if (!session.ok) {
        setCloudLoginStatus(permanentShareErrorMessage(session), "error");
        return;
      }
      const paste = document.getElementById("cloud-paste");
      if (paste) paste.value = "";
      setCloudLoginStatus("");
      await afterAccountSignedIn();
    } catch (err) {
      console.error(err);
      setCloudLoginStatus(err?.message || t("share.cloud.network"), "error");
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function runCloudPublish() {
    closeExportMenu();
    if (!project || !cloudShareEnabled()) return;
    if (!project.steps?.length) {
      toast(t("share.errGeneric"));
      return;
    }
    if (!getCloudAccount().signedIn) {
      showAccountDialog({ publish: true });
      return;
    }
    if (cloudShareNeedsUpgrade()) {
      showUpgradeDialog();
      return;
    }
    project.theme = formToTheme(project.theme);
    showExportOverlay(t("share.cloud.overlay"));
    try {
      const share = await publishPermanentShare(project, {
        onProgress: (msg) => {
          overlayStatus.textContent = msg;
        },
      });
      project.cloudShare = {
        id: share.id,
        url: share.url,
        updatedAt: share.updatedAt,
      };
      saveDirty = true;
      await flushAutosave();
      paintCloudShare();
      hideExportOverlay();
      if (exportPanel) exportPanel.open = true;
      try {
        await copyText(share.url);
        toast(t("toast.cloudPublished"), 4200);
      } catch (err) {
        console.error(err);
      }
    } catch (err) {
      console.error(err);
      hideExportOverlay();
      const gate = classifyCloudGate({
        status: err?.status,
        error: err?.code,
        message: err?.message,
        data: {
          code: err?.code,
          feature: err?.feature,
          plan: err?.plan,
          message: err?.message,
        },
      });
      if (gate.kind === "unauthorized") {
        await endCloudSession();
        resetBillingView();
        paintCloudShare();
        showAccountDialog({ publish: true });
        setCloudLoginStatus(err?.message || t("share.cloud.unauthorized"), "error");
        toast(err?.message || t("share.cloud.generic"));
        return;
      }
      if (gate.kind === "subscription_required") {
        showUpgradeDialog({ message: gate.message || err?.message });
        return;
      }
      if (gate.kind === "quota_exceeded") {
        toast(gate.message || t("billing.quota"));
        return;
      }
      if (gate.kind === "unavailable") {
        toast(t("billing.unavailable"));
        return;
      }
      toast(err?.message || t("share.cloud.generic"));
    }
  }

  document.getElementById("btn-share-revoke")?.addEventListener("click", async () => {
    closeExportMenu();
    if (!project?.share) return;
    showExportOverlay(t("share.overlay"));
    overlayStatus.textContent = t("share.revoke");
    try {
      await revokeShareLink(project.share);
      delete project.share;
      saveDirty = true;
      await flushAutosave();
      paintShareMenu();
      hideExportOverlay();
      toast(t("toast.shareRevoked"));
    } catch (err) {
      console.error(err);
      hideExportOverlay();
      toast(err?.message || t("share.errGeneric"));
    }
  });
}

async function importCapturePayload(data, { name } = {}) {
  if (!data || !Array.isArray(data.steps)) {
    throw new Error(t("err.captureNoSteps"));
  }
  const created = demoPayloadToProject(data, {
    name: name || data.name || t("default.capturedProject"),
  });
  if (!created.sceneLabels) created.sceneLabels = data.sceneLabels || {};
  await putProject(created);
  await openProject(created.id);
  return created;
}

async function appendCapturePayload(data) {
  if (!data || !Array.isArray(data.steps)) {
    throw new Error(t("err.captureNoSteps"));
  }
  if (!project?.id) {
    throw new Error(t("ext.appendNoProject"));
  }
  const { startIndex } = appendCaptureToProject(project, data, {
    sceneLabel: data.sceneLabels?.[1] || data.sceneLabels?.["1"] || data.name,
  });
  renumberScenes(project);
  setSelectedIndex(startIndex);
  onChange();
  editor.refresh?.();
  paintChrome();
  return project;
}

function signalGuiaReady() {
  document.documentElement.dataset.guiaReady = "1";
  window.postMessage({ source: "guia-editor", type: "guia-ready" }, location.origin);
}

function bindCaptureInbox() {
  window.addEventListener("message", async (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.source !== "guia-capture") return;
    if (data.type !== "import-project" && data.type !== "append-steps") return;

    const mode = data.type === "append-steps" ? "append" : "create";
    try {
      if (!Array.isArray(data.payload?.steps)) {
        throw new Error(t("err.captureNoSteps"));
      }
      let result;
      if (mode === "append") {
        result = await appendCapturePayload(data.payload);
        toast(t("toast.stepsAppended"));
      } else {
        result = await importCapturePayload(data.payload);
        toast(t("toast.projectCreated", { name: result.name }));
      }
      window.postMessage(
        {
          source: "guia-capture",
          type: "import-ack",
          ok: true,
          mode,
          projectId: result.id,
        },
        location.origin
      );
    } catch (err) {
      console.error(err);
      window.postMessage(
        {
          source: "guia-capture",
          type: "import-ack",
          ok: false,
          mode,
          error: err?.message || t("err.createProjectFail"),
        },
        location.origin
      );
      toast(err?.message || t("toast.captureCreateFail"));
    }
  });

  window.addEventListener("guia-desktop-import", async (event) => {
    try {
      const created = await importCapturePayload(event.detail);
      toast(t("toast.projectCreated", { name: created.name }));
    } catch (err) {
      console.error(err);
      toast(err?.message || t("toast.captureCreateFail"));
    }
  });
}

function bindExtensionBanner() {
  const banner = document.getElementById("ext-banner");
  if (!banner) return;

  const sync = () => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(EXT_BANNER_DISMISS_KEY) === "1";
    } catch (err) {
      dismissed = false;
    }
    banner.hidden = !shouldShowExtensionBanner({
      dismissed,
      isDesktop: Boolean(window.guiaDesktopApp?.isDesktop),
      installed: document.documentElement.dataset.guiaExtension === "1",
      canOffer: canOfferChromeExtension({
        userAgent: navigator.userAgent || "",
        maxTouchPoints: navigator.maxTouchPoints || 0,
        hasChrome: Boolean(window.chrome),
      }),
    });
  };

  document.documentElement.addEventListener("guia-extension-present", sync);
  document.getElementById("ext-banner-dismiss")?.addEventListener("click", () => {
    try {
      localStorage.setItem(EXT_BANNER_DISMISS_KEY, "1");
    } catch (err) {
      /* o aviso some nesta visita mesmo se o storage falhar */
    }
    banner.hidden = true;
  });
  sync();
}

function paintReleaseNotesTitle() {
  const title = document.getElementById("release-notes-title");
  if (!title) return;
  title.textContent = t("releaseNotes.title", {
    version: RELEASE_NOTES_VERSION,
    month: releaseNotesMonth(getLocale()),
  });
}

function bindReleaseNotes() {
  const banner = document.getElementById("release-notes");
  if (!banner) return;
  paintReleaseNotesTitle();

  const sync = () => {
    let dismissedVersion = null;
    try {
      dismissedVersion = localStorage.getItem(RELEASE_NOTES_DISMISS_KEY);
    } catch (err) {
      dismissedVersion = null;
    }
    banner.hidden = !shouldShowReleaseNotes({
      dismissedVersion,
      currentVersion: RELEASE_NOTES_VERSION,
    });
  };

  document.getElementById("release-notes-dismiss")?.addEventListener("click", () => {
    try {
      localStorage.setItem(RELEASE_NOTES_DISMISS_KEY, RELEASE_NOTES_VERSION);
    } catch (err) {
      /* o aviso some nesta visita mesmo se o storage falhar */
    }
    banner.hidden = true;
  });
  sync();
}

async function boot() {
  initLocale();
  applyI18n(document);
  let authCallback = { ok: false, consumed: false };
  try {
    authCallback = await completeCloudAuthCallback(location.href);
    if (authCallback.consumed) {
      applyCloudAuthHref(authCallback.href);
      window.addEventListener("load", () => applyCloudAuthHref(authCallback.href), { once: true });
    }
  } catch (err) {
    console.error(err);
  }
  bindExtensionBanner();
  bindReleaseNotes();
  bindLocaleSelect(document.getElementById("locale-select"), () => {
    applyChromeAppearance();
    paintChrome();
    paintShareMenu();
    paintUpgradeCopy();
    paintReleaseNotesTitle();
    renderLibrary();
    syncThemeUi();
    editor.refresh?.();
  });

  let seeded = false;
  try {
    const migration = await ensureMigrated();
    seeded = Boolean(migration?.seeded);
  } catch (err) {
    console.error(err);
    toast(t("toast.migrationFail"));
  }

  appearancePreference = getAppearancePreference();
  applyChromeAppearance();
  bindChrome();
  bindCaptureInbox();

  const index = readIndex();
  try {
    if (index.activeProjectId) {
      const loaded = await getProject(index.activeProjectId);
      if (loaded) {
        await openProject(loaded.id, { autoPreview: seeded && (loaded.steps || []).length > 0 });
        return;
      }
      await setActiveProjectId(null);
    }

    if (seeded) {
      const first = (readIndex().projects || [])[0];
      if (first?.id) {
        await openProject(first.id, { autoPreview: true });
        return;
      }
    }

    showLibrary();
  } finally {
    if (authCallback.consumed) applyCloudAuthHref(authCallback.href);
    clearBootGate();
    signalGuiaReady();
    showStashedAuthError();
    if (authCallback.consumed) void finishCloudAuthCallback(authCallback);
    else if (getCloudAccount().signedIn) void resumeCloudPublishAfterLogin({ delay: 800 });
    void consumeBillingReturn();
  }
}

boot();
