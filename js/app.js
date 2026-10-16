import { THEME_FONTS, getThemeFont, themeFontFaceCss } from "./tour-schema/fonts.js";
import {
  exportDemo,
  importDemoFile,
  applyTheme,
  themeToForm,
  formToTheme,
  normalizeSteps,
  resolveImageSrc,
  createStepId,
  clampStepClickPoints,
  slugifyFilename,
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
  listAllProjects,
  createProjectId,
  onLocalProjectChange,
  STOCK_DEMO_NAME,
  isUntouchedStockDemo,
} from "./projects.js";
import { bytesToDataUrl, createCloudSync, restoreFromPublishedLinks } from "./cloudSync.js";
import { formatBytes } from "./mediaBytes.js";
import {
  applyMediaMap,
  collectProjectMedia,
  optimizeProjectMedia,
  projectSizeBytes,
  replaceMediaStrings,
} from "./projectOptimize.js";
import { downscaleImageUrl, isHeavyDataUrl } from "./thumbs.js";
import { appendCaptureToProject } from "./stepClipboard.js";
import { bootShouldSkipSavedOpen, createCaptureClaim, planCaptureHandoff } from "./captureInbox.js";
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
import { themeContrastIssues } from "./a11y.js";
import { exportStandaloneHtml, exportVideo } from "./exportPack.js";
import { buildVtt, exportLangs, htmlLangData, langFileName, videoDemoForLang } from "./exportLangs.js";
import { ensureNarration, ensurePlayback, holdMs } from "./playback.js";
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
  hashSharePayload,
  permanentPublicUrl,
  permanentSlug,
  publishedPayloadFromShare,
  shareBaselineHash,
  shareRecordIsStale,
} from "./shareLink.js";
import { permanentShareEndpoint } from "./viewShare.js";
import { buildEmbedSnippet, embedRatio, isLinkEmbedFlavor, normalizeEmbedFlavor } from "./embedSnippet.js";
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
  exchangeCloudAuthCode,
  PUBLISHED_CLOUD_BASE,
  getCloudAccount,
  getCloudBaseUrl,
  getCloudFlags,
  isCloudEnabled,
  readCloudSession,
  cloudFetch,
  loginWithPassword,
  parseCloudAuthMessage,
  requestMagicLink,
  takeCloudAuthError,
  writeCloudPublishIntent,
} from "./cloudConfig.js";
import {
  accountBillingDestination,
  billingMenuModel,
  cancelSubscription,
  classifyCloudGate,
  emptyEntitlement,
  exportShowsWatermark,
  fetchAccountProfile,
  fetchBillingEntitlement,
  fetchSubscription,
  hostedAccess,
  mergeAccountAccess,
  hostedQuotaCopy,
  hostedUsageMeters,
  resumeSubscription,
  shouldShowByokSettings,
  readBillingReturn,
  shouldShowProBadge,
  startAdminHandoff,
  startBillingCheckout,
  startBillingPortal,
  stripBillingReturn,
  subscriptionConflictKey,
  subscriptionScreen,
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
import { createFixedStepsEditor } from "./fixedStepsEditor.js";
import { createLeadsDialog } from "./leadsDialog.js";
import { createApiKeysDialog, agentTagInfo } from "./apiKeysDialog.js";
import { createAnalyticsDialog } from "./analyticsDialog.js";
import { createTranslationsDialog } from "./translationsDialog.js";
import { createTranslationGrid } from "./translationGrid.js";
import { createMobileBar } from "./mobileBar.js";
import { createLangMenu, readStoredLangs, resolvePlayerLangs, storeLangs } from "./langMenu.js";
import { resolveContent } from "./tour-schema/i18n.js";
import { MAX_TARGET_LANGS, langAudioPlan, langLabel, projectI18n, translationStatus } from "./tour-schema/i18n.js";
import { listHostedVoices } from "./hosted.js";
import { listCartesiaVoices } from "./cartesia.js";
import { readCartesiaKey } from "./cartesia-store.js";
import { applyTranslations, batchItems, buildTranslateMessages, hostedTranslateRequest, parseTranslateResult } from "./tour-schema/translate.js";

let project = null;
let captureGeneration = 0;
const captureClaims = createCaptureClaim();
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
  if (project.name === STOCK_DEMO_NAME && !project.stockEdited) project.stockEdited = true;
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
  paintShareMenu();
}

function applyHistoryState(next) {
  historyLock = true;
  try {
    project = next;
    setSelectedIndex(getSelectedIndex());
    const label = document.getElementById("topbar-project");
    if (label && project) label.textContent = project.name || "";
    paintAgentTag(Boolean(label && !label.hidden));
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

/* ---------- mídia leve na entrada ---------- */

let ingestChain = Promise.resolve();

/**
 * Otimiza em segundo plano a mídia que acabou de entrar (captura, upload, colar, importar).
 * why: a captura ao vivo entra na hora com o original; a versão leve troca de lugar logo depois,
 *      no projeto e em todo o desfazer (mesma imagem, menos bytes), sem criar passo de desfazer.
 * @param {Set<string>|null} sources data URLs novos; null = toda a mídia do projeto aberto
 */
function optimizeIncomingMedia(sources, { audio = true } = {}) {
  const targetId = project?.id;
  if (!targetId) return ingestChain;
  if (sources && !sources.size) return ingestChain;
  ingestChain = ingestChain
    .then(async () => {
      const base = project && project.id === targetId ? project : await getProject(targetId);
      if (!base) return;
      const res = await optimizeProjectMedia(base, { only: sources || undefined, audio });
      if (!res.map.size) return;
      if (project && project.id === targetId) {
        replaceMediaStrings(project, res.map);
        history.replaceMedia(res.map);
        saveDirty = true;
        await flushAutosave();
        paintProjectSize();
        // why: a filmstrip já pintou o original; sem isto a versão leve não aparece
        editor.refresh?.();
        editor.revealSelected?.();
      } else {
        const saved = await getProject(targetId);
        if (!saved) return;
        replaceMediaStrings(saved, res.map);
        await putProject(saved, { keepUpdatedAt: true });
      }
    })
    .catch((err) => console.warn("media optimize", err));
  return ingestChain;
}

function paintProjectSize() {
  const label = document.getElementById("file-optimize-size");
  if (!label) return;
  if (!project) {
    label.textContent = "";
    return;
  }
  label.textContent = formatBytes(projectSizeBytes(project), getLocale());
}

const editor = createEditor({
  onRefresh: () => paintEditLang(),
  onMediaAdded: (sources) => void optimizeIncomingMedia(new Set(sources)),
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
  prefersHostedGeneration,
  noteHostedUsage: rememberHostedUsage,
  coverMenuState: () => ({ enabled: cloudShareEnabled(), pro: viewerIsPro() }),
  onSetCover: (index) => setCoverStep(index),
  viewerIsPro: () => viewerIsPro(),
  onOpenFixedStep: (kind) => openFixedStep(kind),
});

// why: passos fixos (Início/Fim) mudam o payload, então o link fica "Desatualizado" até republicar
const fixedStepsEditor = createFixedStepsEditor({
  getProject: () => project,
  viewerIsPro: () => viewerIsPro(),
  openFeatureGate: (feature) => openFeatureGate(feature),
  openLeads: () => leadsDialog.open(),
  onSaved: (kind) => {
    onChange();
    editor.refresh();
    paintShareMenu();
    toast(t(kind === "start" ? "fixed.start.saved" : "fixed.saved"), 4200);
  },
});

const leadsDialog = createLeadsDialog({
  getSlug: () => (viewerIsPro() ? permanentSlug(project?.cloudShare) || "" : ""),
  toast,
});

const apiKeysDialog = createApiKeysDialog({ toast, onUpgrade: () => showUpgradeDialog() });

function paintAgentTag(show) {
  const tag = document.getElementById("topbar-agent-tag");
  if (!tag) return;
  const info = show ? agentTagInfo(project) : null;
  tag.hidden = !info;
  if (info) tag.title = t("agent.tagTitle", { client: info.client ? ` (${info.client})` : "" });
}

// why: análise (F4) é Pro; sem Pro o botão abre o paywall, sem link permanente pede para publicar
const analyticsDialog = createAnalyticsDialog({
  getSlug: () => (viewerIsPro() ? permanentSlug(activeShareRecord()) || "" : ""),
  getTitle: () => project?.name || "",
  toast,
  onPaywall: () => openFeatureGate("analytics"),
});

// why: idiomas do tour (PRD multi-idioma): formato e edição manual são OSS
const translationsDialog = createTranslationsDialog({
  getProject: () => project,
  onChange: () => {
    onChange();
    paintEditLang();
  },
  toast,
  listProjects: () => listAllProjects(),
  onOpenGrid: () => translationGrid.open(),
  onTranslate: ({ render }) => runTranslate({ after: render }),
  loadVoices: (lang) => loadLangVoices(lang),
  onEditLangChange: () => {
    paintEditLang();
    editor.refresh();
  },
});

const translationGrid = createTranslationGrid({
  onTranslate: ({ langs }) => runTranslate({ langs }),
  onGenerateAudio: ({ langs, stepIds, render }) => runLangAudio({ langs, stepIds, render }),
  onRetranslate: ({ lang, row }) => runTranslate({ langs: [lang], keys: row.fields.map((f) => f.key) }),
  getProject: () => project,
  onChange: () => {
    onChange();
    editor.refresh();
  },
  toast,
});

/** Vozes dinâmicas (Q9): Pro pelo cloud; sem Pro, com a chave Cartesia do autor. { [lang]: [...] } */
async function loadLangVoices(lang) {
  let voices = [];
  if (prefersHostedGeneration()) voices = await listHostedVoices(lang).catch(() => []);
  else {
    const apiKey = await readCartesiaKey().catch(() => "");
    if (apiKey) voices = await listCartesiaVoices({ apiKey, language: lang }).catch(() => []);
  }
  return voices.length ? { [lang]: voices } : {};
}

let generatingAudio = false;

/** “Gerar áudios” por idioma (RF16): estimativa + saldo antes, só faltando/desatualizado (RF17). */
async function runLangAudio({ langs = null, stepIds = null, render } = {}) {
  if (!project || generatingAudio) return;
  const plan = langAudioPlan(project, { langs, stepIds });
  if (!plan.length) {
    toast(t("tg.audioNone"), 4200);
    return;
  }
  const seconds = plan.reduce((a, x) => a + x.seconds, 0);
  const k = new Set(plan.map((x) => x.lang)).size;
  let msg = t("tg.audioConfirm", { n: plan.length, k, m: Math.max(1, Math.round(seconds / 60)) });
  if (prefersHostedGeneration() && hostedMeters.audioMinutes != null) {
    msg += " " + t("tg.audioBalance", { left: Math.max(0, hostedMeters.audioLimit - hostedMeters.audioMinutes), limit: hostedMeters.audioLimit });
  }
  if (plan.length > 1 && !confirm(msg)) return;
  generatingAudio = true;
  try {
    const r = await editor.generateLangAudio(plan);
    if (r.gated) return;
    if (r.ok && !r.failed) toast(t("tg.audioDone", { n: r.ok }));
    else if (r.ok) toast(t("tg.audioPartial", { ok: r.ok, fail: r.failed }), 4200);
  } finally {
    generatingAudio = false;
    render?.();
  }
}

let translating = false;

/**
 * “Traduzir tudo” (RF6–RF10): Pro usa a IA hospedada (1 unidade por idioma); sem Pro, a chave
 * do autor (BYOK); sem nenhum dos dois, a tela do Pro com feature "translate".
 */
async function runTranslate({ langs = null, keys = null, overwriteReviewed = false, after } = {}) {
  if (!project || translating) return;
  const cfg = projectI18n(project);
  const targets = (langs?.length ? langs : cfg?.langs.map((l) => l.lang)) || [];
  if (!targets.length) return;
  const hosted = prefersHostedGeneration();
  const byok = !hosted && editor.hasByokLlm?.();
  if (!hosted && !byok) {
    if ((await ensureHostedFeature("translate", () => runTranslate({ langs, keys, overwriteReviewed, after }))) !== "proceed") {
      if (!isCloudEnabled()) toast(t("ml.needKey"), 4200);
      return;
    }
  }
  if (hosted && cfg.langs.length > MAX_TARGET_LANGS) {
    toast(t("ml.maxLangs"), 4200);
    return;
  }
  translating = true;
  let fields = 0;
  let rejected = 0;
  let done = 0;
  try {
    for (const lang of targets) {
      const req = hostedTranslateRequest(project, lang, { keys, overwriteReviewed });
      if (!req.items.length) continue;
      toast(t("ml.translating", { lang: langLabel(lang) }), 60000);
      let translations = {};
      let bad = [];
      if (hosted || !byok) {
        const res = await cloudFetch("/ai/translate", { method: "POST", body: JSON.stringify(req), timeoutMs: 120 * 1000 });
        if (!res.ok) {
          if (!presentHostedFailure(res, "translate")) toast(res.data?.message || t("billing.tryAgain"), 4200);
          break;
        }
        rememberHostedUsage(res.data?.usage);
        const parsed = parseTranslateResult(res.data?.translations || {}, req.items);
        translations = parsed.translations;
        bad = parsed.rejected;
      } else {
        for (const batch of batchItems(req.items)) {
          const messages = buildTranslateMessages({ ...req, items: batch });
          let parsed = null;
          for (let attempt = 0; attempt < 2 && !parsed?.ok; attempt++) {
            const res = await editor.byokLlmComplete(messages, { maxTokens: 4096 });
            if (!res?.ok) break;
            parsed = parseTranslateResult(res.content, batch);
          }
          if (!parsed?.ok) {
            bad.push(...batch.map((i) => i.id));
            continue;
          }
          Object.assign(translations, parsed.translations);
          bad.push(...parsed.rejected);
        }
      }
      fields += applyTranslations(project, lang, translations);
      rejected += bad.length;
      done++;
    }
  } finally {
    translating = false;
  }
  if (fields) {
    onChange();
    editor.refresh();
  }
  translationGrid.render();
  after?.();
  toast(done ? t("ml.translated", { n: fields, k: done, r: rejected }) : t("ml.nothingToTranslate"), 4200);
}

/** Aviso ao publicar com traduções não revisadas (RF8, Q7): avisa, não bloqueia. */
function confirmI18nPublish() {
  const cfg = project ? projectI18n(project) : null;
  if (!cfg?.langs.some((l) => l.enabled)) return true;
  const status = translationStatus(project);
  let n = 0;
  let c = 0;
  for (const l of cfg.langs) {
    if (!l.enabled) continue;
    n += (status[l.lang]?.auto || 0) + (status[l.lang]?.stale || 0);
    c += status[l.lang]?.consentAuto || 0;
  }
  return !n || confirm(t("tg.publishWarn", { n, c }));
}

/** Seletor “Editando em:” do canvas (RF15); só aparece com idiomas-alvo. */
function paintEditLang() {
  const wrap = document.getElementById("edit-lang-wrap");
  const select = document.getElementById("edit-lang");
  if (!wrap || !select) return;
  const cfg = project ? projectI18n(project) : null;
  const langs = cfg && cfg.langs.length ? [cfg.defaultLang, ...cfg.langs.map((l) => l.lang)] : [];
  wrap.hidden = !langs.length;
  const current = editor.getEditLang?.() || cfg?.defaultLang || "";
  const key = langs.join("|");
  if (select.dataset.key !== key) {
    select.replaceChildren(...langs.map((lang, i) => {
      const opt = document.createElement("option");
      opt.value = lang;
      opt.textContent = i === 0 ? `${langLabel(lang)} · ${t("ml.sourceShort")}` : langLabel(lang);
      return opt;
    }));
    select.dataset.key = key;
  }
  select.value = langs.includes(current) ? current : langs[0] || "";
}

function bindEditLang() {
  document.getElementById("edit-lang")?.addEventListener("change", (e) => {
    editor.setEditLang(e.target.value);
  });
  document.getElementById("btn-languages")?.addEventListener("click", () => {
    document.getElementById("prefs-panel")?.removeAttribute("open");
    translationsDialog.open();
  });
}
bindEditLang();

function openAnalytics() {
  if (!viewerIsPro()) {
    openFeatureGate("analytics");
    return;
  }
  const slug = permanentSlug(activeShareRecord());
  const link = document.getElementById("analytics-preview-link");
  if (link) {
    link.hidden = !slug;
    if (slug) link.href = `${location.origin}/p/${encodeURIComponent(slug)}?preview=1`;
  }
  analyticsDialog.open();
}

/** Início = captura de lead (Pro, precisa do link permanente); Fim = livre. */
function openFixedStep(kind) {
  if (kind === "start" && !cloudShareEnabled()) {
    toast(t("fixed.start.needsCloud"), 4200);
    return;
  }
  fixedStepsEditor.open(kind);
}

// why: a prévia do editor também troca áudio/texto/legenda quando o projeto tem mais de um idioma
let previewLang = null;
let previewView = null;
let previewMenu = null;

function previewViewFor(state) {
  const view = resolveContent(project, state.text, { audioLang: state.audio });
  if (!state.cc) view.steps = view.steps.map((s) => ({ ...s, showCaption: false }));
  return view;
}

function startPreviewLangs() {
  stopPreviewLangs();
  if (!project) return;
  const nav = typeof navigator !== "undefined" ? navigator : {};
  const editLang = editor.getEditLang?.();
  const state = resolvePlayerLangs(project, {
    search: editLang ? `?lang=${encodeURIComponent(editLang)}` : "",
    stored: readStoredLangs(`editor-${project.id || "p"}`),
    languages: nav.languages?.length ? nav.languages : [nav.language].filter(Boolean),
  });
  if (!state) return;
  previewLang = state;
  previewView = previewViewFor(state);
  previewMenu = createLangMenu({
    demo: project,
    getState: () => previewLang,
    onChange: (next) => {
      previewLang = next;
      previewView = previewViewFor(next);
      storeLangs(`editor-${project.id || "p"}`, next);
      previewMenu?.paint();
      if (player.isRunning?.()) player.play({ from: getSelectedIndex(), autoplay: previewAutoplay });
    },
  });
  const mount = (tries = 30) => {
    const host = document.querySelector(".gf-player-controls");
    if (host) previewMenu?.mount(host);
    else if (tries > 0) requestAnimationFrame(() => mount(tries - 1));
  };
  mount();
}

function stopPreviewLangs() {
  previewMenu?.destroy?.();
  previewMenu = null;
  previewLang = null;
  previewView = null;
}
let previewAutoplay = false;

const player = createPlayer({
  getDemo: () => previewView || project,
  getSelectedIndex,
  setSelectedIndex,
  toast,
  // why: no editor o X do balão sai da prévia (igual ao Esc)
  closeLabelKey: "player.exitPreview",
  onRequestExit: () => exitPresentation(),
});

let chromeView = "library";
let presenting = false;
let mobileBar = null;

function getMobileBar() {
  mobileBar ||= createMobileBar({
    t,
    onSettings: () => {
      const prefs = document.getElementById("prefs-panel");
      if (prefs && !prefs.hidden) prefs.open = true;
    },
  });
  return mobileBar;
}

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
  if (navEditor) navEditor.hidden = view !== "editor" || presenting;
  const inEditor = view === "editor" && !presenting;
  if (moreEditorOnly) moreEditorOnly.hidden = !inEditor;
  document.querySelectorAll(".more-editor-pref").forEach((el) => {
    const hidePrefs = !inEditor;
    el.hidden = hidePrefs;
    if (hidePrefs) el.open = false;
  });
  // why: no editor (desktop) Novo/Abrir/Importar ficam no menu Arquivo; o ☰ fica só com o app.
  const fileInEditor = inEditor && !compact;
  for (const id of ["more-file-group", "more-file-divider"]) {
    const el = document.getElementById(id);
    if (el) el.hidden = fileInEditor;
  }
  document.querySelectorAll("details.menu-panel").forEach((el) => {
    if (!inEditor) el.open = false;
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
      projectLabel.hidden = false;
      projectLabel.textContent = project?.name || "";
    }
  }
  paintAgentTag(view !== "library" && !presenting && !compact);
  getMobileBar().paint({ compact, view, presenting });
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
  previewAutoplay = !!opts.autoplay;
  startPreviewLangs();
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
  stopPreviewLangs();
  document.body.classList.remove("is-presenting");
  document.getElementById("view-editor")?.classList.remove("is-presenting");
  document.getElementById("hotspot")?.classList.remove("is-previewing");
  paintChrome();
  if (project && chromeView === "editor") editor.refresh();
  // why: sair pelo X/Esc não pode largar o foco no body (teclado perde o lugar)
  const active = document.activeElement;
  if (!active || active === document.body) {
    document.getElementById("btn-play-from")?.focus({ preventScroll: true });
  }
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

function viewerIsPro() {
  return billingEntitlement.plan === "pro";
}

function activeShareRecord() {
  if (!project) return null;
  if (viewerIsPro()) return project.cloudShare || null;
  return project.share?.id && project.share?.writeToken ? project.share : null;
}

function displayedShareUrl(record) {
  if (!record) return "";
  if (viewerIsPro()) return permanentPublicUrl(record);
  return record.id ? shareViewUrl(record.id) : "";
}

const shareServerChecked = new Set();
const shareServerPending = new Set();

function rememberShareHash(record, hash) {
  if (!record || !hash || record.payloadHash === hash) return false;
  record.payloadHash = hash;
  saveDirty = true;
  schedulePersist();
  return true;
}

function rememberLocalShareBaseline(record) {
  return rememberShareHash(record, shareBaselineHash(record, project));
}

async function reconcilePublishedBaseline(record) {
  const slug = permanentSlug(record);
  if (!slug || shareServerChecked.has(slug) || shareServerPending.has(slug)) return;
  shareServerPending.add(slug);
  let data = null;
  try {
    const endpoint = permanentShareEndpoint(getCloudBaseUrl() || PUBLISHED_CLOUD_BASE, slug);
    const res = await fetch(endpoint);
    data = await res.json().catch(() => null);
    if (!res.ok && !data?.payload) data = null;
  } catch {
    data = null;
  } finally {
    shareServerPending.delete(slug);
    shareServerChecked.add(slug);
  }
  const published = publishedPayloadFromShare(data);
  const next = published ? hashSharePayload(published) : shareBaselineHash(record, project);
  if (rememberShareHash(record, next)) paintShareMenu();
}

function paintShareMenu() {
  const pro = viewerIsPro();
  const record = activeShareRecord();
  if (record && pro && permanentSlug(record)) {
    void reconcilePublishedBaseline(record);
  } else if (record) {
    rememberLocalShareBaseline(record);
  }
  const hasLink = Boolean(record);
  const stale = Boolean(record && project && shareRecordIsStale(record, project));
  const expiry = document.getElementById("share-expiry-note");
  const upsell = document.getElementById("cloud-share-block");
  const publishBtn = document.getElementById("btn-share-publish");
  const publishDesc = document.getElementById("share-publish-desc");
  const actions = document.getElementById("share-link-actions");
  const republish = document.getElementById("btn-share-republish");
  const revoke = document.getElementById("btn-share-revoke");
  const staleBadge = document.getElementById("share-stale");
  const extra = document.getElementById("share-link-extra");
  const urlInput = document.getElementById("share-link-url");
  const dot = document.getElementById("share-stale-dot");
  if (expiry) expiry.hidden = pro;
  if (upsell) upsell.hidden = pro || !isCloudEnabled();
  if (publishBtn) publishBtn.hidden = hasLink;
  if (publishDesc) {
    publishDesc.textContent = t(pro ? "share.proDesc" : "share.linkDesc");
    publishDesc.dataset.i18n = pro ? "share.proDesc" : "share.linkDesc";
  }
  if (actions) actions.hidden = !hasLink;
  if (urlInput) urlInput.value = displayedShareUrl(record);
  if (republish) republish.hidden = !stale;
  if (revoke) revoke.hidden = pro || !hasLink;
  if (staleBadge) staleBadge.hidden = !stale;
  if (extra) extra.hidden = Boolean(republish?.hidden) && Boolean(revoke?.hidden);
  if (dot) {
    dot.hidden = !stale;
    dot.title = t("share.staleDot");
  }
  paintShareCover(record, pro);
  const embedBtn = document.getElementById("btn-share-embed");
  if (embedBtn) embedBtn.hidden = !cloudShareEnabled();
  const embedBadge = document.getElementById("embed-pro-badge");
  if (embedBadge) embedBadge.hidden = pro;
  const analyticsBtn = document.getElementById("btn-share-analytics");
  if (analyticsBtn) analyticsBtn.hidden = !cloudShareEnabled() || (pro && !permanentSlug(record));
  const analyticsBadge = document.getElementById("analytics-pro-badge");
  if (analyticsBadge) analyticsBadge.hidden = pro;
  const leadsBtn = document.getElementById("btn-share-leads");
  if (leadsBtn) leadsBtn.hidden = !(pro && cloudShareEnabled() && permanentSlug(record));
  // why: só o Pro tem /p; a marca sai por padrão e o autor pode pedir o crédito «Feito com GuiaFlow»
  const brandToggle = document.getElementById("share-brand-toggle");
  if (brandToggle) brandToggle.hidden = !(pro && cloudShareEnabled());
  const brandBox = document.getElementById("share-remove-brand");
  if (brandBox) brandBox.checked = project?.removeBranding !== false;
  paintAccount();
}

/** Miniatura da capa do /p (só Pro com link permanente publicado). */
function paintShareCover(record, pro) {
  const box = document.getElementById("share-cover");
  const img = document.getElementById("share-cover-img");
  if (!box || !img) return;
  const url = pro && permanentSlug(record) && typeof record?.coverUrl === "string" ? record.coverUrl : "";
  box.hidden = !url;
  if (url && img.getAttribute("src") !== url) img.setAttribute("src", url);
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
let subscriptionRecord = null;
let subscriptionPhase = "loading";
let subscriptionBusy = false;
let subscriptionTicket = 0;
let pendingHostedResume = null;
let pendingHostedFeature = "";
const LOCAL_SAVE_DISMISS_KEY = "guiaflow.localSaveDismissed";

/* ---------- sincronização de projetos (Pro) ---------- */

let syncState = { phase: "off", done: 0, total: 0, error: "" };

async function fetchSyncAsset(sha) {
  const base = getCloudBaseUrl();
  const token = readCloudSession()?.accessToken || "";
  if (!base || !token) return "";
  const res = await fetch(`${base}/media/${encodeURIComponent(sha)}`, {
    headers: { Authorization: `Bearer ${token}` },
    credentials: "omit",
  });
  if (!res.ok) return "";
  const mime = (res.headers.get("content-type") || "application/octet-stream").split(";")[0];
  return bytesToDataUrl(new Uint8Array(await res.arrayBuffer()), mime);
}

const cloudSync = createCloudSync({
  request: (path, init) => cloudFetch(path, { timeoutMs: 120 * 1000, ...init }),
  fetchAsset: fetchSyncAsset,
  uploadAsset: (sha, bytes, mime) =>
    cloudFetch(`/media/${encodeURIComponent(sha)}`, {
      method: "PUT",
      body: bytes,
      headers: { "Content-Type": mime },
      timeoutMs: 180 * 1000,
    }),
  store: {
    listAllProjects,
    getProject,
    putProject,
    deleteProject,
    getCustomThemes,
    saveCustomThemes,
    createProjectId,
  },
  // why: o tour de exemplo vem com o editor; só sobe depois que o usuário edita (vira dele)
  skipProject: (p) => isUntouchedStockDemo(p),
  isProjectBusy: (id) => Boolean(project && project.id === id && (saveDirty || saveTimer)),
  conflictName: (name) => t("sync.conflictCopy", { name }),
  onStatus: (next) => {
    syncState = next;
    paintSyncStatus();
  },
  onRemoteChange: (change) => handleRemoteProjectChange(change),
});

onLocalProjectChange((event) => cloudSync.notifyLocalChange(event));

async function handleRemoteProjectChange({ type, id }) {
  if (project && project.id === id) {
    if (type === "delete") {
      project = null;
      rememberProject(null);
      showLibrary();
      toast(t("sync.deletedOpen"), 4200);
      return;
    }
    if (!saveDirty && !saveTimer) {
      await openProject(id);
      toast(t("sync.updatedOpen"), 3200);
      return;
    }
  }
  if (chromeView === "library") renderLibrary();
}

function syncWanted() {
  return Boolean(isCloudEnabled() && getCloudAccount().signedIn && billingView.status === "ready" && billingEntitlement.active);
}

function reconcileSync() {
  const account = getCloudAccount();
  if (syncWanted()) {
    cloudSync.enable(account.email || "conta");
    return;
  }
  // why: carregando o plano não desliga; só sem sessão ou com plano confirmado sem Pro
  if (!account.signedIn || billingView.status === "ready" || billingView.status === "hidden") {
    if (cloudSync.isEnabled()) cloudSync.disable();
  }
}

function syncStatusText() {
  const { phase, done, total, error } = syncState;
  if (phase === "syncing") return total ? t("sync.progress", { done, total }) : t("sync.syncing");
  if (phase === "offline") return t("sync.offline");
  if (phase === "error") return error === "media_quota_exceeded" ? t("sync.quota") : t("sync.error");
  return t("sync.synced");
}

function syncChipVisible() {
  return cloudSync.isEnabled() && syncState.phase !== "off" && syncState.phase !== "inactive";
}

function paintSyncStatus() {
  const visible = syncChipVisible();
  for (const id of ["sync-status-library", "sync-status-editor"]) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.hidden = !visible;
    el.dataset.phase = syncState.phase;
    const text = el.querySelector("[data-sync-text]");
    if (text) text.textContent = syncStatusText();
    const chip = el.querySelector("[data-sync-now]");
    if (chip) chip.title = t("sync.tip");
  }
  const restore = document.getElementById("btn-file-restore-links");
  if (restore) restore.hidden = !visible;
}

async function restorePublishedLinks() {
  toast(t("sync.restoring"), 3000);
  try {
    const result = await restoreFromPublishedLinks({
      request: (path, init) => cloudFetch(path, { timeoutMs: 120 * 1000, ...init }),
      store: { listAllProjects, putProject },
      toProject: (payload, opts) => demoPayloadToProject(payload, opts),
      slugOf: (record) => permanentSlug(record),
    });
    if (chromeView === "library") renderLibrary();
    toast(result.restored ? t("sync.restored", { n: result.restored }) : t("sync.restoreNone"), 4200);
  } catch (err) {
    console.error(err);
    toast(t("sync.restoreFail"), 4200);
  }
}

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
  const menuSignIn = document.getElementById("btn-menu-account");
  if (menuSignIn) menuSignIn.hidden = !enabled || signedIn;
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
    const pending = menu.planLabel === "past_due";
    planEl.hidden = !menu.showPlan;
    planEl.classList.toggle("is-pending", pending);
    if (pending) planEl.textContent = t("billing.pastDue");
    else if (menu.planLabel === "comp") planEl.textContent = t("billing.planLine", { plan: t("billing.planComp") });
    else if (menu.showPlan) planEl.textContent = t("billing.planLine", { plan: t("billing.planCloud") });
  }
  const adminBtn = document.getElementById("btn-account-admin");
  if (adminBtn) adminBtn.hidden = !menu.showAdmin;
  if (billingBtn) {
    billingBtn.hidden = !menu.showAction;
    if (menu.showAction) {
      billingBtn.textContent = menu.action === "portal" ? t("billing.manage") : t("billing.subscribeMenu");
    }
  }
  editor.paintHostedBadges?.();
  paintExportMark();
  paintLocalSave();
  paintByokSettings();
  paintHostedUsage();
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
  const [result, profile] = await Promise.all([
    fetchBillingEntitlement(sessionId),
    fetchAccountProfile(),
  ]);
  if (ticket !== billingTicket) return result;
  if (result?.ok || profile?.ok) {
    billingView = { status: "ready" };
    billingEntitlement = mergeAccountAccess(
      result?.ok ? result.entitlement : null,
      profile?.ok ? profile.profile : null
    );
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
  reconcileSync();
  paintSyncStatus();
  const signedIn = Boolean(getCloudAccount().signedIn);
  const show = !syncChipVisible() && shouldShowLocalSave({
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
  const locale = getLocale();
  const currency = paywallCurrency(locale);
  const offer = paywallOffer(currency);
  const monthPrice = document.getElementById("paywall-month-price");
  if (monthPrice) monthPrice.textContent = t("billing.monthEquiv", { price: formatPaywallAmount(offer.month, currency, locale) });
  const monthNote = document.getElementById("paywall-month-note");
  if (monthNote) monthNote.textContent = t("billing.billedMonth");
  const yearPrice = document.getElementById("paywall-year-price");
  if (yearPrice) {
    yearPrice.textContent = t("billing.monthEquiv", { price: formatPaywallAmount(offer.monthEquiv, currency, locale) });
  }
  const yearNote = document.getElementById("paywall-year-note");
  if (yearNote) yearNote.textContent = t("billing.billedYear", { price: formatPaywallAmount(offer.year, currency, locale) });
  const free = document.getElementById("paywall-free");
  if (free) free.textContent = t("billing.freeMonths", { n: offer.freeMonths });
  const yearCard = document.getElementById("paywall-year-card");
  const saveTip = t("billing.savePercent", { percent: offer.percent });
  if (yearCard) yearCard.title = saveTip;
  const annual = document.querySelector('#upgrade-form input[name="billing-interval"]:checked')?.value === "year";
  const subscribe = document.getElementById("btn-upgrade-subscribe");
  if (subscribe) {
    const key = annual ? "billing.subscribeAnnual" : "billing.subscribeMonthly";
    subscribe.dataset.i18n = key;
    subscribe.textContent = t(key);
  }
  const payNote = document.getElementById("paywall-pay-note");
  if (payNote) {
    payNote.hidden = !annual;
    payNote.textContent = annual ? t("billing.payMonths", { paid: offer.paidMonths, total: 12 }) : "";
  }
  const list = document.getElementById("paywall-benefits");
  if (list) {
    const order = paywallFeatureOrder(upgradeFeature);
    for (const id of order) {
      const item = list.querySelector(`[data-feature="${id}"]`);
      if (item) list.appendChild(item);
    }
    const highlight = featured ? order[0] : "";
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

let hostedMeters = { texts: null, textLimit: 100, audioMinutes: null, audioLimit: 30 };

function prefersHostedGeneration() {
  const snap = billingSnapshot();
  return Boolean(snap.signedIn && snap.status === "ready" && snap.active);
}

function rememberHostedUsage(usage) {
  const next = hostedUsageMeters(usage);
  if (!next) return;
  if (next.texts != null) {
    hostedMeters.texts = next.texts;
    hostedMeters.textLimit = next.textLimit;
  }
  if (next.audioMinutes != null) {
    hostedMeters.audioMinutes = next.audioMinutes;
    hostedMeters.audioLimit = next.audioLimit;
  }
  paintHostedUsage();
}

function paintHostedUsage() {
  const el = document.getElementById("account-chip-usage");
  if (!el) return;
  const snap = billingSnapshot();
  const pro = snap.signedIn && snap.status === "ready" && snap.active;
  const lines = [];
  if (pro && hostedMeters.texts != null) {
    lines.push(t("billing.usageTexts", { used: hostedMeters.texts, limit: hostedMeters.textLimit }));
  }
  if (pro && hostedMeters.audioMinutes != null) {
    lines.push(t("billing.usageAudio", { used: hostedMeters.audioMinutes, limit: hostedMeters.audioLimit }));
  }
  el.hidden = !lines.length;
  el.textContent = lines.join("\n");
}

function paintByokSettings() {
  const show = shouldShowByokSettings(billingSnapshot());
  for (const id of ["settings-llm", "settings-tts"]) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.hidden = !show;
    if (!show) el.open = false;
  }
}

function showHostedBadge({ hasByok = false } = {}) {
  return shouldShowProBadge({ ...billingSnapshot(), hasByok });
}

function paintExportMark() {
  const btn = document.getElementById("btn-export-unbrand");
  if (btn) btn.hidden = !exportShowsWatermark(billingSnapshot());
  paintExportQuality();
}

/** Qualidade alta segue a mesma regra da marca d'água: quem exporta limpo exporta em alta. */
function exportQualityUnlocked() {
  return !exportShowsWatermark(billingSnapshot());
}

function paintExportQuality() {
  const pro = exportQualityUnlocked();
  const badge = document.getElementById("export-quality-badge");
  if (badge) badge.hidden = pro;
  const hint = document.getElementById("export-quality-hint");
  if (hint) {
    const key = pro ? "export.qualityHintPro" : "export.qualityHintFree";
    hint.dataset.i18n = key;
    hint.textContent = t(key);
  }
  const q = document.getElementById("export-video-quality");
  const f = document.getElementById("export-video-fps");
  if (!pro) {
    if (q) q.value = "standard";
    if (f) f.value = "30";
  }
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
    openFeatureGate(feature);
    return "blocked";
  }
  return "proceed";
}

function presentHostedFailure(result, feature) {
  const gate = classifyCloudGate(result);
  const which = gate.feature || feature;
  if (gate.kind === "subscription_required") {
    openFeatureGate(which);
    return true;
  }
  if (gate.kind === "quota_exceeded") {
    const usage = result?.data?.usage || result?.usage;
    rememberHostedUsage(usage);
    const copy = hostedQuotaCopy(which === "tts" ? "tts" : "hostedAi", usage);
    toast(t(copy.key, copy.vars));
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
    toast(t("billing.tryAgain"));
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
  return billingView.status === "ready" && !billingEntitlement.active && billingEntitlement.status !== "past_due";
}

function isPastDue() {
  return billingView.status === "ready" && billingEntitlement.status === "past_due";
}

function openFeatureGate(feature) {
  if (isPastDue()) {
    toast(t("billing.pastDueHint"), 4200);
    void openBillingPortal();
    return;
  }
  showUpgradeDialog({ feature });
}

/**
 * "Usar como capa do link". Marcar o passo que já é a capa volta ao padrão (1º passo).
 * why: muda o payload (coverStepId), então o link fica "Desatualizado" até republicar.
 */
function setCoverStep(index) {
  if (!project || !cloudShareEnabled()) return;
  if (!viewerIsPro()) {
    openFeatureGate("cover");
    return;
  }
  const step = project.steps?.[index];
  if (!step) return;
  if (!step.id) step.id = createStepId();
  if (project.coverStepId === step.id) {
    delete project.coverStepId;
    toast(t("toast.coverReset"), 4200);
  } else {
    project.coverStepId = step.id;
    toast(t("toast.coverSet"), 4200);
  }
  onChange();
  paintShareMenu();
}

/**
 * /editor?pro=1 vem do botão "Assinar o Pro" da landing: abre o diálogo do GuiaFlow Pro
 * e tira o parâmetro da barra para um F5 não reabrir.
 */
function consumeProIntent() {
  let url;
  try {
    url = new URL(location.href);
  } catch {
    return;
  }
  if (url.searchParams.get("pro") !== "1") return;
  url.searchParams.delete("pro");
  applyCloudAuthHref(url.toString());
  if (!isCloudEnabled()) return;
  if (viewerIsPro()) return;
  showUpgradeDialog({ feature: "account" });
}

async function consumeBillingReturn() {
  const found = readBillingReturn(location.href);
  if (!isCloudEnabled() || !found.kind) return;
  if (found.kind === "welcome" && found.code) {
    const session = await exchangeCloudAuthCode(found.code);
    if (session?.error === "network") {
      toast(t("share.cloud.network"), 4200);
      return;
    }
    applyCloudAuthHref(stripBillingReturn(location.href));
    if (isSubscriptionRequired(session)) {
      showUpgradeDialog({ feature: "account" });
      return;
    }
    if (!session?.ok) {
      toast(session?.message || t("share.cloud.invalidToken"), 4800);
      return;
    }
    paintCloudShare();
    await refreshEntitlement();
    toast(t("billing.toastWelcome"), 5200);
    return;
  }
  applyCloudAuthHref(stripBillingReturn(location.href));
  if (found.kind === "cancel") {
    toast(t("billing.toastCancel"), 4200);
    return;
  }
  if (found.kind === "pending") {
    toast(t("billing.toastPending"), 4800);
    return;
  }
  if (found.kind === "welcome") {
    // why: a API não abre mais sessão na volta do pagamento; quem não está logado entra pelo link
    //      enviado por e-mail, então não dá boas-vindas (ainda não é Pro neste navegador).
    if (!getCloudAccount().signedIn) {
      toast(t("billing.toastPaidCheckEmail"), 9000);
      return;
    }
    await refreshEntitlement(found.sessionId || "");
    toast(t("billing.toastWelcome"), 5200);
    return;
  }
  if (found.kind === "portal" && getCloudAccount().signedIn) await refreshEntitlement();
}

function openAdmin() {
  const tab = window.open("about:blank", "_blank");
  if (!tab) {
    toast(t("account.adminFail"));
    return;
  }
  void (async () => {
    try {
      const result = await startAdminHandoff();
      if (result?.status === 401 || result?.error === "unauthorized") {
        tab.close();
        toast(t("share.cloud.unauthorized"));
        return;
      }
      if (result?.status === 403) {
        tab.close();
        toast(t("account.adminDenied"));
        return;
      }
      if (!result?.ok || !result.url) {
        tab.close();
        toast(t("account.adminFail"));
        return;
      }
      tab.location.href = result.url;
    } catch (err) {
      console.error(err);
      tab.close();
      toast(t("account.adminFail"));
    }
  })();
}

function paintSubscription() {
  const loading = document.getElementById("subscription-loading");
  const error = document.getElementById("subscription-error");
  const ready = document.getElementById("subscription-ready");
  const confirm = document.getElementById("subscription-confirm");
  const facts = document.getElementById("subscription-facts");
  const none = document.getElementById("subscription-none");
  if (loading) loading.hidden = subscriptionPhase !== "loading";
  if (error) error.hidden = subscriptionPhase !== "error";
  if (ready) ready.hidden = subscriptionPhase !== "ready";
  if (confirm) confirm.hidden = subscriptionPhase !== "confirm";
  const screen = subscriptionRecord ? subscriptionScreen(subscriptionRecord, getLocale()) : null;
  const showFacts = Boolean(screen && screen.kind !== "none");
  if (facts) facts.hidden = !showFacts;
  if (none) none.hidden = screen?.kind !== "none";
  const plan = document.getElementById("subscription-plan");
  if (plan) plan.textContent = screen?.planKey ? t(screen.planKey) : "";
  const price = document.getElementById("subscription-price");
  if (price) {
    price.hidden = !screen?.priceKey;
    price.textContent = screen?.priceKey ? t(screen.priceKey, { price: screen.price }) : "";
  }
  const statusLabel = document.getElementById("subscription-status-label");
  const state = document.getElementById("subscription-state");
  if (statusLabel) statusLabel.hidden = !screen?.statusKey;
  if (state) {
    state.hidden = !screen?.statusKey;
    state.textContent = screen?.statusKey ? t(screen.statusKey) : "";
    state.classList.toggle("is-pending", screen?.statusKey === "billing.pastDue");
    state.classList.toggle("is-scheduled", screen?.statusKey === "billing.subStatusScheduled");
  }
  const when = document.getElementById("subscription-when");
  if (when) {
    when.hidden = !screen?.whenKey;
    when.textContent = !screen?.whenKey
      ? ""
      : screen.whenKey === "billing.subNoEnd"
        ? t(screen.whenKey)
        : t(screen.whenKey, { date: screen.whenDate });
  }
  const cancel = document.getElementById("btn-subscription-cancel");
  if (cancel) {
    cancel.hidden = !screen?.canCancel;
    cancel.disabled = subscriptionBusy;
  }
  const resume = document.getElementById("btn-subscription-resume");
  if (resume) {
    resume.hidden = !screen?.canResume;
    resume.disabled = subscriptionBusy;
  }
  const upsell = document.getElementById("btn-subscription-upsell");
  if (upsell) upsell.hidden = screen?.kind !== "none";
  const portal = document.getElementById("btn-subscription-portal");
  if (portal) portal.hidden = !screen?.showPortal;
  const confirmCopy = document.getElementById("subscription-confirm-copy");
  if (confirmCopy) {
    confirmCopy.textContent = screen?.whenDate
      ? t("billing.subConfirm", { date: screen.whenDate })
      : t("billing.subConfirmOpen");
  }
  const confirmBtn = document.getElementById("btn-subscription-confirm");
  if (confirmBtn) confirmBtn.disabled = subscriptionBusy;
}

function closeSubscriptionDialog() {
  subscriptionTicket += 1;
  const dialog = document.getElementById("modal-subscription");
  if (dialog?.open) dialog.close();
}

async function loadSubscription() {
  const ticket = ++subscriptionTicket;
  subscriptionPhase = "loading";
  subscriptionBusy = false;
  paintSubscription();
  const result = await fetchSubscription();
  if (ticket !== subscriptionTicket) return;
  if (result?.status === 401 || result?.error === "unauthorized") {
    closeSubscriptionDialog();
    await endCloudSession();
    resetBillingView();
    paintCloudShare();
    showAccountDialog();
    setCloudLoginStatus(t("share.cloud.unauthorized"), "error");
    return;
  }
  if (!result?.ok || !result.subscription) {
    subscriptionPhase = "error";
    subscriptionRecord = null;
    paintSubscription();
    return;
  }
  subscriptionRecord = result.subscription;
  subscriptionPhase = "ready";
  paintSubscription();
}

async function openSubscriptionDialog() {
  if (!isCloudEnabled()) return;
  const dialog = document.getElementById("modal-subscription");
  if (!dialog) return;
  subscriptionRecord = null;
  subscriptionPhase = "loading";
  subscriptionBusy = false;
  paintSubscription();
  if (!dialog.open) dialog.showModal();
  await loadSubscription();
}

async function changeSubscription(action) {
  if (subscriptionBusy) return;
  subscriptionBusy = true;
  paintSubscription();
  const result = action === "resume" ? await resumeSubscription() : await cancelSubscription();
  subscriptionBusy = false;
  if (result?.status === 401 || result?.error === "unauthorized") {
    closeSubscriptionDialog();
    await endCloudSession();
    resetBillingView();
    paintCloudShare();
    showAccountDialog();
    setCloudLoginStatus(t("share.cloud.unauthorized"), "error");
    return;
  }
  const conflict = subscriptionConflictKey(result);
  if (conflict) {
    toast(t(conflict));
    await loadSubscription();
    return;
  }
  if (!result?.ok || !result.subscription) {
    toast(result?.error === "network" ? t("share.cloud.network") : t("billing.unavailable"));
    paintSubscription();
    return;
  }
  subscriptionRecord = result.subscription;
  subscriptionPhase = "ready";
  paintSubscription();
  toast(t(action === "resume" ? "billing.subToastResume" : "billing.subToastCancel"));
  void refreshEntitlement();
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
    if (result?.status === 400 && (result.error === "invalid_interval" || result.error === "invalid_currency")) {
      setUpgradeStatus(
        result.error === "invalid_currency" ? t("billing.invalidCurrency") : t("billing.invalidInterval"),
        "error"
      );
      return;
    }
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
  paintShareMenu();
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

function renderThemeContrastWarning() {
  const el = document.getElementById("theme-contrast-warn");
  if (!el) return;
  const issues = themeContrastIssues(project?.theme);
  el.hidden = !issues.length;
  if (!issues.length) {
    el.textContent = "";
    return;
  }
  const names = { title: "theme.titleColor", text: "theme.textColor", accent: "theme.accent", button: "theme.buttonColor" };
  const list = issues.map((i) => `${t(names[i.key])} ${String(i.ratio).replace(".", ",")}:1`).join(" · ");
  el.textContent = t("theme.contrastWarn", { list });
}

/** why: a prévia de cada opção usa a própria fonte — só no editor, para o player carregar só a escolhida. */
function ensureFontPreviewFaces() {
  if (document.getElementById("gf-font-previews")) return;
  const base = new URL("../fonts/", import.meta.url).href;
  const style = document.createElement("style");
  style.id = "gf-font-previews";
  style.textContent = THEME_FONTS.map((f) => themeFontFaceCss(f.id, base)).join("\n");
  document.head.appendChild(style);
}

function renderThemeFonts() {
  const box = document.getElementById("theme-fonts");
  if (!box) return;
  const current = getThemeFont(project?.theme?.font).id;
  box.textContent = "";
  for (const f of THEME_FONTS) {
    const label = document.createElement("label");
    label.className = "theme-font-option";
    label.style.fontFamily = f.stack;
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "theme-font";
    input.value = f.id;
    input.checked = f.id === current;
    input.addEventListener("change", () => {
      if (!project?.theme || !input.checked) return;
      if (f.id === "default") delete project.theme.font;
      else project.theme.font = f.id;
      applyTheme(project.theme);
      onChange();
    });
    const name = document.createElement("span");
    name.textContent = f.id === "default" ? t("theme.fontDefault") : f.label;
    const sample = document.createElement("span");
    sample.className = "theme-font-sample";
    sample.setAttribute("aria-hidden", "true");
    sample.textContent = "Aa";
    label.append(input, name, sample);
    box.appendChild(label);
  }
}

function renderThemePanel() {
  ensureFontPreviewFaces();
  renderThemeFonts();
  renderThemeContrastWarning();
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
  const keepFont = project.theme?.font;
  project.theme = cloneTheme(preset.colors, { presetId: id });
  if (keepFont) project.theme.font = keepFont;
  delete project.theme.customId;
  themeSelection = { kind: "preset", id };
  syncThemeUi();
  onChange();
}

function applyCustomTheme(id) {
  const custom = getCustomThemes().find((t) => t.id === id);
  if (!custom || !project) return;
  const keepFont = project.theme?.font;
  project.theme = cloneTheme(custom.colors, { customId: id });
  if (keepFont) project.theme.font = keepFont;
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

/* ---------- Otimizar projeto ---------- */

let optimizeRun = null;

function optimizeEls() {
  return {
    modal: document.getElementById("modal-optimize"),
    name: document.getElementById("optimize-name"),
    progress: document.getElementById("optimize-progress"),
    status: document.getElementById("optimize-status"),
    sizes: document.getElementById("optimize-sizes"),
    before: document.getElementById("optimize-before"),
    after: document.getElementById("optimize-after"),
    apply: document.getElementById("btn-optimize-apply"),
  };
}

/**
 * Mede e recomprime numa cópia; só grava depois do "Aplicar".
 * why: aberto no editor vira uma edição comum (Desfazer volta ao original);
 *      fechado, o original entra no histórico salvo do projeto antes da troca.
 */
async function openOptimizeProject(id) {
  const els = optimizeEls();
  if (!els.modal || !id) return;
  optimizeRun?.controller.abort();
  const controller = new AbortController();
  const run = { id, controller, result: null };
  optimizeRun = run;
  els.apply.disabled = true;
  els.sizes.hidden = true;
  els.progress.hidden = false;
  els.progress.removeAttribute("value");
  els.status.textContent = t("optimize.loading");
  els.name.textContent = "";
  if (!els.modal.open) els.modal.showModal();
  try {
    const isOpen = project && project.id === id;
    if (isOpen) await flushAutosave();
    const source = isOpen ? project : await getProject(id);
    if (!source) throw new Error(t("toast.projectNotFound"));
    els.name.textContent = source.name || "";
    const res = await optimizeProjectMedia(source, {
      signal: controller.signal,
      onProgress: (i, n) => {
        if (optimizeRun !== run) return;
        els.progress.max = n;
        els.progress.value = i - 1;
        els.status.textContent = t("optimize.analyzing", { i, n });
      },
    });
    if (optimizeRun !== run) return;
    run.result = res;
    const locale = getLocale();
    els.progress.hidden = true;
    els.sizes.hidden = false;
    els.before.textContent = formatBytes(res.before, locale);
    els.after.textContent = formatBytes(res.after, locale);
    if (!res.map.size) {
      els.status.textContent = t("optimize.nothing");
      return;
    }
    const pct = res.before ? Math.max(1, Math.round((1 - res.after / res.before) * 100)) : 0;
    els.status.textContent = t("optimize.ready", { images: res.changedImages, audio: res.changedAudio, pct });
    els.apply.disabled = false;
  } catch (err) {
    if (optimizeRun !== run || err?.code === "aborted") return;
    console.error(err);
    els.progress.hidden = true;
    els.status.textContent = err?.message || t("optimize.fail");
  }
}

async function applyOptimizeResult(run) {
  const { id, result } = run;
  const locale = getLocale();
  const sizes = { before: formatBytes(result.before, locale), after: formatBytes(result.after, locale) };
  if (project && project.id === id) {
    commitPendingEdit();
    replaceMediaStrings(project, result.map);
    onChange();
    commitPendingEdit();
    saveDirty = true;
    await flushAutosave();
    editor.refresh();
    paintProjectSize();
    toast(t("optimize.applied", sizes), 4200);
    return;
  }
  const saved = await getProject(id);
  if (!saved) throw new Error(t("toast.projectNotFound"));
  const savedHistory = await getProjectHistory(id);
  const stacks = createHistory();
  if (savedHistory && (savedHistory.undo.length || savedHistory.redo.length)) stacks.restore(saved, savedHistory);
  else stacks.reset(saved);
  const next = applyMediaMap(saved, result.map);
  stacks.noteChange();
  stacks.settle(next);
  await putProjectAndHistory(next, stacks.exportStacks());
  if (chromeView === "library") renderLibrary();
  toast(t("optimize.appliedClosed", sizes), 4200);
}

function bindOptimizeModal() {
  const els = optimizeEls();
  if (!els.modal) return;
  const close = () => {
    optimizeRun?.controller.abort();
    optimizeRun = null;
    if (els.modal.open) els.modal.close();
  };
  document.getElementById("btn-optimize-cancel")?.addEventListener("click", close);
  els.modal.addEventListener("cancel", () => {
    optimizeRun?.controller.abort();
    optimizeRun = null;
  });
  els.apply.addEventListener("click", async () => {
    const run = optimizeRun;
    if (!run?.result?.map.size) return;
    els.apply.disabled = true;
    try {
      await applyOptimizeResult(run);
      optimizeRun = null;
      els.modal.close();
    } catch (err) {
      console.error(err);
      els.status.textContent = err?.message || t("optimize.fail");
      els.apply.disabled = false;
    }
  });
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
            <div class="project-card-dots">${dots}${p.agent ? `<span class="agent-tag" title="${escapeAttr(t("agent.tagTitle", { client: p.agentClient ? ` (${p.agentClient})` : "" }))}">${escapeHtml(t("agent.tag"))}</span>` : ""}${p.sizeBytes ? `<span class="project-card-size" title="${escapeAttr(t("file.sizeTitle"))}">${escapeHtml(formatBytes(p.sizeBytes, getLocale()))}</span>` : ""}</div>
            <div class="project-card-actions">
              <button type="button" class="btn btn-sm" data-action="export">
                <svg class="btn-ico" aria-hidden="true"><use href="#i-export"></use></svg>
                Exportar
              </button>
              <button type="button" class="btn btn-sm" data-action="duplicate">
                <svg class="btn-ico" aria-hidden="true"><use href="#i-copy"></use></svg>
                Duplicar
              </button>
              <button type="button" class="btn btn-sm btn-icon project-card-optimize" data-action="optimize" title="${escapeAttr(t("library.optimizeTitle"))}" aria-label="${escapeAttr(t("library.optimize"))}">
                <svg class="btn-ico" aria-hidden="true"><use href="#i-compress"></use></svg>
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
    // why: o áudio do projeto anterior (prévia ou player do passo) não pode seguir tocando
    exitPresentation();
    editor.stopAudio?.();
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
  editor.stopAudio?.();
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

  // Menu Arquivo (ao lado do nome do projeto)
  document.getElementById("btn-file-new")?.addEventListener("click", () => {
    openNewProjectDialog();
  });
  document.getElementById("btn-file-open")?.addEventListener("click", () => {
    void closeProject();
  });
  document.getElementById("btn-file-import")?.addEventListener("click", () => {
    document.getElementById("import-file")?.click();
  });
  document.getElementById("btn-file-rename")?.addEventListener("click", () => {
    const label = document.getElementById("topbar-project");
    if (!project || !label) return;
    label.click();
  });
  document.getElementById("btn-file-delete")?.addEventListener("click", () => {
    if (!project?.id) return;
    void openDeleteProjectModal(project.id);
  });
  // why: menus do header (Arquivo, Preview) fecham ao escolher um item.
  document.querySelectorAll("details.menu-panel").forEach((panel) => {
    panel.querySelector(".menu-panel-body")?.addEventListener("click", (e) => {
      if (e.target.closest("button, a")) panel.open = false;
    });
    panel.addEventListener("toggle", () => {
      panel.querySelector(":scope > summary")?.setAttribute("aria-expanded", panel.open ? "true" : "false");
    });
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
      else if (chromeView === "editor") editor.refresh?.();
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
  // why: sair da página (fechar aba, navegar) cala o player de áudio do passo
  window.addEventListener("pagehide", () => editor.stopAudio?.());
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
        "details.theme-panel[open], details.export-panel[open], details.more-panel[open], details.account-chip[open], details.menu-panel[open]",
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
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (document.querySelector("dialog[open]")) return;
    const open = document.querySelector(
      "details.menu-panel[open], details.prefs-panel[open], details.export-panel[open]"
    );
    if (!open) return;
    e.preventDefault();
    e.stopPropagation();
    open.open = false;
    open.querySelector(":scope > summary")?.focus();
  });

  const captureBtns = [
    document.getElementById("btn-capture-desktop"),
    document.getElementById("btn-capture-desktop-lib"),
  ].filter(Boolean);
  if (window.guiaDesktopApp?.isDesktop) {
    // why: a landing (/?landing=1) só existe no site; no app desktop o link não abre nada
    const aboutLink = document.getElementById("btn-about");
    if (aboutLink) aboutLink.hidden = true;
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
      if (action === "optimize") {
        e.preventDefault();
        e.stopPropagation();
        await openOptimizeProject(id);
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

  // RF25: o seletor de idioma do vídeo só aparece em tours com idiomas-alvo habilitados
  function paintExportLangs() {
    const row = document.getElementById("export-lang-row");
    const sel = document.getElementById("export-video-lang");
    if (!row || !sel) return;
    const langs = project ? exportLangs(project) : [];
    row.hidden = !langs.length;
    if (!langs.length) return;
    const prev = sel.value;
    sel.replaceChildren(...langs.map((l) => new Option(langLabel(l), l)), new Option(t("export.allLangs", { n: langs.length }), "all"));
    sel.value = langs.includes(prev) || prev === "all" ? prev : langs[0];
  }
  exportPanel?.addEventListener("toggle", () => {
    if (exportPanel.open) paintExportLangs();
  });

  const overlayCard = overlay?.querySelector(".export-overlay-card");
  const overlayActions = document.getElementById("export-overlay-actions");
  const overlayRetry = document.getElementById("btn-export-retry");
  let overlayRetryAction = null;

  function showExportOverlay(title, { cancelable = false, preview = false } = {}) {
    overlayTitle.textContent = title;
    overlayStatus.textContent = "";
    overlay.hidden = false;
    cancelBtn.hidden = !cancelable;
    previewCanvas.hidden = !preview;
    overlayCard?.classList.remove("is-error");
    if (overlayActions) overlayActions.hidden = true;
    overlayRetryAction = null;
  }

  function hideExportOverlay() {
    overlay.hidden = true;
    previewCanvas.hidden = true;
    cancelBtn.hidden = true;
    exportAbort = null;
    overlayCard?.classList.remove("is-error");
    if (overlayActions) overlayActions.hidden = true;
    overlayRetryAction = null;
  }

  /** Erro no próprio painel, com "Tentar de novo" e "Fechar" — nunca fica parado sem saída. */
  function showExportOverlayError(title, message, onRetry) {
    overlay.hidden = false;
    previewCanvas.hidden = true;
    cancelBtn.hidden = true;
    exportAbort = null;
    overlayTitle.textContent = title;
    overlayStatus.textContent = message;
    overlayCard?.classList.add("is-error");
    overlayRetryAction = typeof onRetry === "function" ? onRetry : null;
    if (overlayRetry) overlayRetry.hidden = !overlayRetryAction;
    if (overlayActions) overlayActions.hidden = false;
    (overlayRetryAction ? overlayRetry : document.getElementById("btn-export-close"))?.focus();
  }

  overlayRetry?.addEventListener("click", () => {
    const retry = overlayRetryAction;
    hideExportOverlay();
    retry?.();
  });
  document.getElementById("btn-export-close")?.addEventListener("click", () => hideExportOverlay());

  cancelBtn.addEventListener("click", () => {
    exportAbort?.abort();
  });

  document.getElementById("btn-file-optimize")?.addEventListener("click", () => {
    document.getElementById("file-panel")?.removeAttribute("open");
    if (project?.id) void openOptimizeProject(project.id);
  });
  document.getElementById("file-panel")?.addEventListener("toggle", (event) => {
    if (event.currentTarget.open) paintProjectSize();
  });
  bindOptimizeModal();

  document.getElementById("btn-export-json").addEventListener("click", () => {
    closeExportMenu();
    if (!project) return;
    project.theme = formToTheme(project.theme);
    exportDemo(projectToDemoPayload(project), { filename: project.name });
    toast(t("toast.jsonExported"));
  });

  // RF27: legendas .vtt por idioma (tempo de cada passo como no player)
  document.getElementById("btn-export-vtt")?.addEventListener("click", () => {
    closeExportMenu();
    if (!project?.steps?.length) return;
    const langs = exportLangs(project);
    const base = slugifyFilename(project.name, "demo");
    let files = 0;
    for (const lang of langs.length ? langs : [""]) {
      const demo = lang ? videoDemoForLang(project, lang) : project;
      ensurePlayback(demo);
      let at = 0;
      const cues = demo.steps.map((step) => {
        const ms = holdMs(step, demo);
        const cue = { text: step.caption || "", startMs: at, endMs: at + ms };
        at += ms;
        return cue;
      });
      if (!cues.some((c) => String(c.text).trim())) continue;
      const blob = new Blob([buildVtt(cues)], { type: "text/vtt;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = langFileName(base, lang, "vtt");
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      files += 1;
    }
    toast(files ? t("toast.vttDownloaded", { n: files }) : t("toast.vttEmpty"));
  });

  document.getElementById("btn-export-html").addEventListener("click", async () => {
    closeExportMenu();
    if (!project) return;
    project.theme = formToTheme(project.theme);
    showExportOverlay(t("export.overlayHtml"));
    try {
      const langData = htmlLangData(project);
      const size = await exportStandaloneHtml(project, {
        langData,
        onProgress: (msg) => {
          overlayStatus.textContent = msg;
        },
      });
      hideExportOverlay();
      const mb = (size / (1024 * 1024)).toFixed(1);
      // why: o HTML leva o áudio de todos os idiomas (RF26): avisa o tamanho
      toast(langData ? t("toast.htmlDownloadedLangs", { mb, n: langData.langs.length }) : t("toast.htmlDownloaded", { mb }), langData ? 5200 : undefined);
    } catch (err) {
      console.error(err);
      hideExportOverlay();
      toast(err?.message || t("toast.htmlFail"));
    }
  });

  document.getElementById("share-remove-brand")?.addEventListener("change", (e) => {
    if (!project || !viewerIsPro()) return;
    if (e.target.checked) delete project.removeBranding;
    else project.removeBranding = false;
    saveDirty = true;
    schedulePersist();
    paintShareMenu();
  });

  document.getElementById("btn-export-unbrand")?.addEventListener("click", () => {
    closeExportMenu();
    pendingHostedFeature = "branding";
    openFeatureGate("branding");
  });

  const qualitySelect = document.getElementById("export-video-quality");
  const fpsSelect = document.getElementById("export-video-fps");
  for (const sel of [qualitySelect, fpsSelect]) {
    sel?.addEventListener("change", (e) => {
      const v = e.target.value;
      const wantsPro = e.target === qualitySelect ? v !== "standard" : v !== "30";
      if (!wantsPro || exportQualityUnlocked()) return;
      e.target.value = e.target === qualitySelect ? "standard" : "30";
      closeExportMenu();
      openFeatureGate("videoQuality");
    });
  }

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
    // RF25: idioma do vídeo (áudio + legenda queimada) e fila “Todos os idiomas”
    const langs = exportLangs(project);
    const pickedLang = langs.length ? document.getElementById("export-video-lang")?.value || langs[0] : "";
    const queue = pickedLang === "all" ? langs : [pickedLang];
    const cc = document.getElementById("export-video-cc")?.value !== "0";
    const base = slugifyFilename(project.name, "demo");
    try {
      let result;
      for (let i = 0; i < queue.length; i += 1) {
        const lang = queue[i];
        const demo = lang ? videoDemoForLang(project, lang, { cc }) : project;
        const tag = queue.length > 1 ? `${lang} (${i + 1}/${queue.length}) · ` : "";
        result = await exportVideo(demo, {
          watermark,
          pro: !watermark,
          quality: qualitySelect?.value || "standard",
          fps: Number(fpsSelect?.value) || 30,
          canvas: previewCanvas,
          signal: exportAbort.signal,
          fileBase: lang ? `${base}.${lang}` : "",
          onProgress: (msg) => {
            overlayStatus.textContent = tag + msg;
          },
        });
      }
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
    if (!confirmI18nPublish()) return;
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
        publishedAt: Date.now(),
        payloadHash: hashSharePayload(project),
      };
      saveDirty = true;
      await flushAutosave();
      paintShareMenu();
      hideExportOverlay();
      await copyText(share.url);
      if (exportPanel) exportPanel.open = true;
      toast(
        share.renewed
          ? t("toast.shareRenewed")
          : update
            ? t("toast.shareRepublished")
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
    if (viewerIsPro()) {
      clearCloudPublishIntent();
      void runCloudPublish();
      return;
    }
    void runSharePublish({ update: false });
  });
  document.getElementById("btn-share-republish")?.addEventListener("click", () => {
    if (viewerIsPro()) {
      clearCloudPublishIntent();
      void runCloudPublish();
      return;
    }
    void runSharePublish({ update: true });
  });
  document.getElementById("btn-share-copy")?.addEventListener("click", async () => {
    const url = displayedShareUrl(activeShareRecord());
    if (!url) return;
    try {
      await copyText(url);
      toast(t("toast.shareCopied"));
    } catch (err) {
      console.error(err);
      const field = document.getElementById("share-link-url");
      field?.focus();
      field?.select();
      toast(err?.message || t("share.errGeneric"));
    }
  });
  document.getElementById("cloud-share-block")?.addEventListener("click", () => {
    showUpgradeDialog({ feature: "permanentShare" });
  });
  document.getElementById("btn-share-cover-change")?.addEventListener("click", () => {
    toast(t("share.cover.changeHint"), 6500);
  });

  // Incorporar no site (só link permanente, Pro)
  const EMBED_AUTOPLAY_KEY = "guiaflow.embed.autoplay";
  const embedModal = document.getElementById("modal-embed");
  let embedFlavor = "html";
  let embedRatioValue = "";
  let embedRatioFor = "";

  function readEmbedAutoplay() {
    try {
      return localStorage.getItem(EMBED_AUTOPLAY_KEY) === "1";
    } catch {
      return false;
    }
  }

  function firstCaptureSrc() {
    for (const step of project?.steps || []) {
      if (step?.type === "slide" || !step?.image) continue;
      const src = resolveImageSrc(project, step.image);
      if (src) return src;
    }
    return "";
  }

  /** Proporção da 1ª captura (naturalWidth/naturalHeight); 16/9 se faltar. */
  function measureEmbedRatio() {
    const src = firstCaptureSrc();
    const key = `${project?.id || ""}|${src.slice(0, 120)}|${src.length}`;
    if (embedRatioFor === key && embedRatioValue) return Promise.resolve(embedRatioValue);
    return new Promise((resolve) => {
      if (!src) {
        resolve(embedRatio(0, 0));
        return;
      }
      const img = new Image();
      img.onload = () => resolve(embedRatio(img.naturalWidth, img.naturalHeight));
      img.onerror = () => resolve(embedRatio(0, 0));
      img.src = src;
    }).then((ratio) => {
      embedRatioFor = key;
      embedRatioValue = ratio;
      return ratio;
    });
  }

  function currentEmbedCode() {
    const record = project?.cloudShare;
    const url = permanentSlug(record) ? permanentPublicUrl(record) : "";
    return buildEmbedSnippet({
      url,
      title: project?.name || "",
      ratio: embedRatioValue || embedRatio(0, 0),
      autoplay: Boolean(document.getElementById("embed-autoplay")?.checked),
      flavor: embedFlavor,
      label: t("embed.frameLabel"),
      lang: document.getElementById("embed-lang")?.value || "",
    });
  }

  function paintEmbedDialog() {
    if (!embedModal) return;
    const record = project?.cloudShare;
    const published = Boolean(permanentSlug(record));
    const needs = document.getElementById("embed-needs-publish");
    const ready = document.getElementById("embed-ready");
    if (needs) needs.hidden = published;
    if (ready) ready.hidden = !published;
    const stale = document.getElementById("embed-stale");
    if (stale) stale.hidden = !(published && project && shareRecordIsStale(record, project));
    for (const tab of embedModal.querySelectorAll(".embed-tab")) {
      const on = tab.dataset.flavor === embedFlavor;
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.tabIndex = on ? 0 : -1;
    }
    const hint = document.getElementById("embed-hint");
    if (hint) {
      const key = `embed.hint.${embedFlavor}`;
      hint.dataset.i18n = key;
      hint.textContent = t(key);
    }
    const linkMode = isLinkEmbedFlavor(embedFlavor);
    const autoplayRow = document.getElementById("embed-autoplay-row");
    if (autoplayRow) autoplayRow.hidden = linkMode;
    paintEmbedLang(linkMode);
    const copyBtn = document.getElementById("btn-embed-copy");
    if (copyBtn) {
      const key = linkMode ? "embed.copyLink" : "embed.copy";
      copyBtn.dataset.i18n = key;
      copyBtn.textContent = t(key);
    }
    const code = document.getElementById("embed-code");
    if (code) {
      code.value = published ? currentEmbedCode() : "";
      code.rows = linkMode ? 2 : 7;
    }
  }

  /** “Idioma inicial” do embed — só com 2+ idiomas no player (RF22). */
  function paintEmbedLang(linkMode) {
    const row = document.getElementById("embed-lang-row");
    const select = document.getElementById("embed-lang");
    if (!row || !select) return;
    const cfg = project ? projectI18n(project) : null;
    const langs = cfg ? [cfg.defaultLang, ...cfg.langs.filter((l) => l.enabled).map((l) => l.lang)] : [];
    row.hidden = linkMode || langs.length < 2;
    const keep = select.value;
    const auto = document.createElement("option");
    auto.value = "";
    auto.textContent = t("embed.langAuto");
    select.replaceChildren(auto, ...langs.map((l) => {
      const o = document.createElement("option");
      o.value = l;
      o.textContent = langLabel(l);
      return o;
    }));
    select.value = langs.includes(keep) ? keep : "";
  }

  function openEmbedDialog() {
    closeExportMenu();
    if (!project || !cloudShareEnabled()) return;
    if (!viewerIsPro()) {
      if (isPastDue()) {
        openFeatureGate("embed");
        return;
      }
      showUpgradeDialog({ feature: "embed" });
      return;
    }
    if (!embedModal) return;
    const autoplay = document.getElementById("embed-autoplay");
    if (autoplay) autoplay.checked = readEmbedAutoplay();
    paintEmbedDialog();
    if (!embedModal.open) embedModal.showModal();
    void measureEmbedRatio().then(() => {
      if (embedModal.open) paintEmbedDialog();
    });
  }

  document.getElementById("btn-share-embed")?.addEventListener("click", openEmbedDialog);
  document.getElementById("btn-share-leads")?.addEventListener("click", () => leadsDialog.open());
  document.getElementById("btn-share-analytics")?.addEventListener("click", () => openAnalytics());
  document.getElementById("btn-embed-close")?.addEventListener("click", () => embedModal?.close());
  embedModal?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) embedModal.close();
  });
  embedModal?.querySelector(".embed-tabs")?.addEventListener("click", (e) => {
    const tab = e.target.closest?.(".embed-tab");
    if (!tab) return;
    embedFlavor = normalizeEmbedFlavor(tab.dataset.flavor);
    paintEmbedDialog();
  });
  embedModal?.querySelector(".embed-tabs")?.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const tabs = [...embedModal.querySelectorAll(".embed-tab")];
    const i = tabs.findIndex((tab) => tab.dataset.flavor === embedFlavor);
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    if (!next) return;
    e.preventDefault();
    embedFlavor = normalizeEmbedFlavor(next.dataset.flavor);
    paintEmbedDialog();
    next.focus();
  });
  document.getElementById("embed-autoplay")?.addEventListener("change", (e) => {
    try {
      localStorage.setItem(EMBED_AUTOPLAY_KEY, e.target.checked ? "1" : "0");
    } catch {
      /* storage cheio ou bloqueado */
    }
    paintEmbedDialog();
  });
  document.getElementById("embed-code")?.addEventListener("focus", (e) => e.target.select());
  document.getElementById("embed-lang")?.addEventListener("change", () => paintEmbedDialog());
  document.getElementById("btn-embed-copy")?.addEventListener("click", async () => {
    const code = currentEmbedCode();
    if (!code) return;
    try {
      await copyText(code);
      toast(t(isLinkEmbedFlavor(embedFlavor) ? "embed.linkCopied" : "embed.copied"), 3200);
    } catch (err) {
      console.error(err);
      const field = document.getElementById("embed-code");
      field?.focus();
      field?.select();
      toast(err?.message || t("share.errGeneric"));
    }
  });
  document.getElementById("btn-embed-publish")?.addEventListener("click", async () => {
    embedModal?.close();
    clearCloudPublishIntent();
    await runCloudPublish();
    if (permanentSlug(project?.cloudShare)) openEmbedDialog();
  });
  document.getElementById("btn-menu-account")?.addEventListener("click", () => {
    document.getElementById("more-panel").open = false;
    document.getElementById("btn-account-signin")?.click();
  });
  document.getElementById("btn-account-signin")?.addEventListener("click", () => {
    showUpgradeDialog({ feature: "account" });
  });
  document.getElementById("btn-account-signout")?.addEventListener("click", () => {
    void signOutAccount();
  });
  document.getElementById("btn-account-billing")?.addEventListener("click", () => {
    closeAccountMenus();
    const destination = accountBillingDestination({
      status: billingView.status,
      entitlement: billingEntitlement,
    });
    if (destination === "subscription") void openSubscriptionDialog();
    else showUpgradeDialog();
  });
  document.getElementById("btn-subscription-close")?.addEventListener("click", () => {
    closeSubscriptionDialog();
  });
  document.getElementById("modal-subscription")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeSubscriptionDialog();
  });
  document.getElementById("btn-subscription-retry")?.addEventListener("click", () => {
    void loadSubscription();
  });
  document.getElementById("btn-subscription-cancel")?.addEventListener("click", () => {
    subscriptionPhase = "confirm";
    paintSubscription();
  });
  document.getElementById("btn-subscription-back")?.addEventListener("click", () => {
    subscriptionPhase = "ready";
    paintSubscription();
  });
  document.getElementById("btn-subscription-confirm")?.addEventListener("click", () => {
    void changeSubscription("cancel");
  });
  document.getElementById("btn-subscription-resume")?.addEventListener("click", () => {
    void changeSubscription("resume");
  });
  document.getElementById("btn-subscription-portal")?.addEventListener("click", () => {
    void openBillingPortal();
  });
  document.getElementById("btn-subscription-upsell")?.addEventListener("click", () => {
    closeSubscriptionDialog();
    showUpgradeDialog();
  });
  document.getElementById("btn-account-api-keys")?.addEventListener("click", () => {
    closeAccountMenus();
    apiKeysDialog.open();
  });
  document.getElementById("btn-account-admin")?.addEventListener("click", () => {
    closeAccountMenus();
    openAdmin();
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
  document.querySelectorAll("[data-sync-now]").forEach((button) => {
    button.addEventListener("click", () => cloudSync.syncNow());
  });
  document.querySelectorAll("[data-sync-restore]").forEach((button) => {
    button.addEventListener("click", () => {
      closeAccountMenus?.();
      restorePublishedLinks();
    });
  });
  window.addEventListener("online", () => cloudSync.syncNow());
  window.addEventListener("focus", () => cloudSync.syncNow());
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
  document.getElementById("upgrade-form")?.addEventListener("change", (event) => {
    if (event.target?.name === "billing-interval") paintUpgradeCopy();
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
      if (isPastDue()) {
        openFeatureGate(feature);
        return;
      }
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
      if (isSubscriptionRequired(session)) {
        showUpgradeDialog({
          feature: pendingHostedFeature || "account",
          email: parsed.email || "",
          emailNote: Boolean(parsed.email),
        });
        return;
      }
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
      if (isSubscriptionRequired(session)) {
        showUpgradeDialog({
          feature: pendingHostedFeature || "account",
          email: emailHint,
          emailNote: Boolean(String(emailHint || "").trim()),
        });
        closeAccountDialog();
        return;
      }
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
    if (isPastDue()) {
      openFeatureGate("permanentShare");
      return;
    }
    if (cloudShareNeedsUpgrade()) {
      showUpgradeDialog({ feature: "permanentShare" });
      return;
    }
    if (!confirmI18nPublish()) return;
    project.theme = formToTheme(project.theme);
    showExportOverlay(t("share.cloud.overlay"), { cancelable: true });
    const abort = new AbortController();
    exportAbort = abort;
    try {
      const updating = Boolean(permanentSlug(project.cloudShare));
      const share = await publishPermanentShare(project, {
        slug: updating ? permanentSlug(project.cloudShare) : "",
        signal: abort.signal,
        onProgress: (msg) => {
          if (!abort.signal.aborted) overlayStatus.textContent = msg;
        },
      });
      const previousCover = updating ? project.cloudShare?.coverUrl || "" : "";
      project.cloudShare = {
        id: share.slug || share.id,
        slug: share.slug || share.id,
        url: share.url,
        updatedAt: share.updatedAt,
        publishedAt: Date.now(),
        payloadHash: hashSharePayload(project),
        coverUrl: share.coverUrl || previousCover,
      };
      saveDirty = true;
      await flushAutosave();
      paintCloudShare();
      hideExportOverlay();
      if (exportPanel) exportPanel.open = true;
      try {
        await copyText(share.url);
        toast(updating ? t("toast.shareRepublished") : t("toast.shareCopied"), 4200);
        if (share.coverSkipped && updating) setTimeout(() => toast(t("share.cover.skipped"), 4200), 4300);
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
        openFeatureGate("permanentShare");
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
      if (err?.code === "aborted") {
        toast(t("share.cloud.aborted"));
        return;
      }
      // why: tamanho, prazo e rede ficam no painel com a causa e um "Tentar de novo"
      showExportOverlayError(t("share.cloud.failedTitle"), err?.message || t("share.cloud.generic"), () => {
        void runCloudPublish();
      });
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
  // why: extensões antigas mandam clique e destaque soltos; captura nova já entra com o clique dentro
  clampStepClickPoints(data.steps);
  const created = demoPayloadToProject(data, {
    name: name || data.name || t("default.capturedProject"),
  });
  if (!created.sceneLabels) created.sceneLabels = data.sceneLabels || {};
  await putProject(created);
  await openProject(created.id);
  editor.revealSelected?.();
  void optimizeIncomingMedia(null);
  return created;
}

async function appendCapturePayload(data) {
  if (!data || !Array.isArray(data.steps)) {
    throw new Error(t("err.captureNoSteps"));
  }
  if (!project?.id) {
    throw new Error(t("ext.appendNoProject"));
  }
  clampStepClickPoints(data.steps);
  const incoming = new Set(collectProjectMedia(data).keys());
  const { startIndex } = appendCaptureToProject(project, data, {
    sceneLabel: data.sceneLabels?.[1] || data.sceneLabels?.["1"] || data.name,
  });
  renumberScenes(project);
  setSelectedIndex(startIndex);
  onChange();
  editor.refresh?.();
  editor.revealSelected?.();
  paintChrome();
  void optimizeIncomingMedia(incoming);
  return project;
}

function signalGuiaReady() {
  document.documentElement.dataset.guiaReady = "1";
  window.postMessage({ source: "guia-editor", type: "guia-ready" }, location.origin);
}

function postCaptureAck({ id, ok, mode, projectId, error }) {
  window.postMessage(
    {
      source: "guia-capture",
      type: "import-ack",
      id: id ?? null,
      ok,
      mode,
      projectId: projectId || null,
      error: error || null,
    },
    location.origin
  );
}

async function receiveCapture(data) {
  if (!data || data.source !== "guia-capture") return;
  if (data.type !== "import-project" && data.type !== "append-steps") return;
  const mode = data.type === "append-steps" ? "append" : "create";
  const claim = captureClaims.claim(data);
  if (claim === "done") {
    postCaptureAck({ id: data.id, ok: true, mode, projectId: project?.id || null });
    return;
  }
  if (claim !== "fresh") return;
  captureGeneration += 1;
  const generation = captureGeneration;
  try {
    if (!Array.isArray(data.payload?.steps)) {
      throw new Error(t("err.captureNoSteps"));
    }
    const plan = planCaptureHandoff({
      mode,
      openProjectId: project?.id || null,
      activeProjectId: readIndex().activeProjectId || null,
    });
    if (plan.action === "reject") throw new Error(t("ext.appendNoProject"));
    if (plan.flushFirst) await flushAutosave();
    if (presenting) exitPresentation();

    let result;
    if (plan.action === "create") {
      result = await importCapturePayload(data.payload);
      toast(t("toast.projectCreated", { name: result.name }));
    } else {
      if (plan.action === "append-saved") {
        await openProject(plan.projectId);
        if (!project?.id) throw new Error(t("ext.appendNoProject"));
      }
      result = await appendCapturePayload(data.payload);
      toast(t("toast.stepsAppended"));
    }
    captureClaims.commit(data);
    postCaptureAck({ id: data.id, ok: true, mode, projectId: result.id });
  } catch (err) {
    console.error(err);
    captureClaims.release(data);
    if (captureGeneration === generation) captureGeneration -= 1;
    postCaptureAck({
      id: data.id,
      ok: false,
      mode,
      error: err?.message || t("err.createProjectFail"),
    });
    toast(err?.message || t("toast.captureCreateFail"));
  }
}

function bindCaptureInbox() {
  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin) return;
    void receiveCapture(event.data);
  });

  document.addEventListener("guia-capture-handoff", (event) => {
    void receiveCapture(event.detail);
  });

  const nudge = () => {
    if (document.visibilityState === "hidden") return;
    signalGuiaReady();
  };
  document.addEventListener("visibilitychange", nudge);
  window.addEventListener("focus", nudge);

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
    paintSubscription();
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
  const bootGeneration = captureGeneration;
  try {
    if (!bootShouldSkipSavedOpen(bootGeneration, captureGeneration) && index.activeProjectId) {
      const loaded = await getProject(index.activeProjectId);
      if (bootShouldSkipSavedOpen(bootGeneration, captureGeneration)) {
        /* a captura já abriu o projeto enquanto este carregava */
      } else if (loaded) {
        await openProject(loaded.id, { autoPreview: seeded && (loaded.steps || []).length > 0 });
        return;
      } else {
        await setActiveProjectId(null);
      }
    }

    if (bootShouldSkipSavedOpen(bootGeneration, captureGeneration)) return;

    if (seeded) {
      const first = (readIndex().projects || [])[0];
      if (first?.id && !bootShouldSkipSavedOpen(bootGeneration, captureGeneration)) {
        await openProject(first.id, { autoPreview: true });
        return;
      }
    }

    if (!bootShouldSkipSavedOpen(bootGeneration, captureGeneration)) showLibrary();
  } finally {
    if (authCallback.consumed) applyCloudAuthHref(authCallback.href);
    clearBootGate();
    signalGuiaReady();
    showStashedAuthError();
    if (authCallback.consumed) void finishCloudAuthCallback(authCallback);
    else if (getCloudAccount().signedIn) void resumeCloudPublishAfterLogin({ delay: 800 });
    void (async () => {
      await consumeBillingReturn();
      if (getCloudAccount().signedIn && billingView.status !== "ready") await refreshEntitlement();
      consumeProIntent();
    })();
  }
}

boot();
