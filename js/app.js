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
} from "./projects.js";
import {
  THEME_PRESETS,
  cloneTheme,
  createThemeId,
  matchThemeSelection,
  getPreset,
  getAppearancePreference,
  setAppearancePreference,
  resolveAppearanceMode,
  cycleAppearancePreference,
} from "./themes.js";
import { createEditor } from "./editor.js";
import { createPlayer } from "./player.js";
import { exportStandaloneHtml, exportVideo } from "./exportPack.js";
import { ensureNarration, ensurePlayback } from "./playback.js";
import { createHistory } from "./history.js";
import { renumberScenes } from "./scenes.js";
import {
  initLocale,
  applyI18n,
  bindLocaleSelect,
  t,
  themePresetName,
} from "./i18n.js";

let project = null;
let selectedIndex = 0;
let selectedNewThemeId = THEME_PRESETS[0].id;
let themeSelection = { kind: "preset", id: THEME_PRESETS[0].id };
let appearancePreference = getAppearancePreference();

const toastEl = document.getElementById("toast");
let toastTimer = null;

const APPEARANCE_LABELS = () => ({
  system: t("appearance.system"),
  documento: t("appearance.light"),
  social: t("appearance.dark"),
});

const APPEARANCE_ICONS = {
  system: "#i-appearance",
  documento: "#i-sun",
  social: "#i-moon",
};

function applyChromeAppearance(mode = resolveAppearanceMode(appearancePreference)) {
  document.documentElement.setAttribute("data-appearance", mode);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = mode === "social" ? "#101010" : "#1A4D6D";
  const btn = document.getElementById("btn-appearance");
  const icon = document.getElementById("btn-appearance-icon");
  const labels = APPEARANCE_LABELS();
  const prefLabel = labels[appearancePreference] || t("appearance.system");
  const effective = labels[mode] || mode;
  if (icon) {
    const href = APPEARANCE_ICONS[appearancePreference] || APPEARANCE_ICONS.system;
    icon.setAttribute("href", href);
    icon.setAttribute("xlink:href", href);
  }
  if (btn) {
    btn.title =
      appearancePreference === "system"
        ? t("appearance.followSystem", { effective, next: cycleHint(appearancePreference) })
        : t("appearance.fixed", { label: prefLabel, next: cycleHint(appearancePreference) });
    btn.setAttribute("aria-label", t("appearance.aria", { label: prefLabel }));
  }
}

function cycleHint(current) {
  const next = {
    system: t("appearance.light"),
    documento: t("appearance.dark"),
    social: t("appearance.system"),
  };
  return next[current] || t("appearance.nextMode");
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

function toast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.hidden = true;
  }, 2200);
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
    enterPresentation({ from: index, autoplay: !!opts.autoplay });
  },
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
  const projectLabel = document.getElementById("topbar-project");
  const title = document.getElementById("topbar-title");
  const presentChrome = document.getElementById("present-chrome");

  libraryView.hidden = view !== "library";
  editorView.hidden = view !== "editor";
  if (helpView) helpView.hidden = true;
  actionsEditor.hidden = view === "library" || presenting;
  actionsLibrary.hidden = view !== "library";
  if (presentChrome) presentChrome.hidden = !presenting || view !== "editor";

  if (view === "library") {
    title.hidden = false;
    title.textContent = t("topbar.tagline");
    if (projectLabel) projectLabel.hidden = true;
  } else if (presenting) {
    title.hidden = false;
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

  if (!projects.length) {
    grid.innerHTML = "";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  grid.innerHTML = projects
    .map((p) => {
      const dots = (p.themePreview || [])
        .map((c) => `<i style="background:${c}"></i>`)
        .join("");
      const thumb = p.thumb
        ? `<img src="${escapeAttr(p.thumb)}" alt="" loading="lazy" />`
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
}

async function openProject(id, { autoPreview = false } = {}) {
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
  if (autoPreview && loaded.steps.length) {
    // why: deixa o editor pintar o palco antes do tour automático da primeira visita
    requestAnimationFrame(() => {
      enterPresentation({ from: 0, autoplay: true });
    });
    toast(t("toast.watchExample"));
  } else {
    toast(t("toast.opened", { name: loaded.name }));
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
  document.getElementById("btn-projects").addEventListener("click", () => closeProject());
  document.getElementById("btn-undo")?.addEventListener("click", () => undoEdit());
  document.getElementById("btn-redo")?.addEventListener("click", () => redoEdit());

  window.addEventListener("keydown", (e) => {
    if (!project) return;
    if (presenting) return;
    const tag = e.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target?.isContentEditable) return;
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

  document.getElementById("btn-appearance")?.addEventListener("click", () => {
    appearancePreference = cycleAppearancePreference(appearancePreference);
    setAppearancePreference(appearancePreference);
    syncAppearanceOnly();
  });

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

  // Fecha painéis Tema / Narração / Exportar ao clicar fora
  document.addEventListener("pointerdown", (e) => {
    document.querySelectorAll("details.theme-panel[open], details.export-panel[open]").forEach((panel) => {
      if (!panel.contains(e.target)) panel.open = false;
    });
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
    selectedNewThemeId = resolveAppearanceMode(appearancePreference);
    document.getElementById("new-project-name").value = "";
    renderNewProjectThemes();
    document.getElementById("modal-new-project").showModal();
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

  document.getElementById("btn-import-library").addEventListener("click", () => {
    document.getElementById("import-file").click();
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

  document.getElementById("btn-export-video").addEventListener("click", async () => {
    closeExportMenu();
    if (!project) return;
    project.theme = formToTheme(project.theme);
    exportAbort = new AbortController();
    showExportOverlay(t("export.overlayVideo"), { cancelable: true, preview: true });
    overlayStatus.textContent = t("export.overlayVideoHint");
    try {
      const result = await exportVideo(project, {
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

function signalGuiaReady() {
  document.documentElement.dataset.guiaReady = "1";
  window.postMessage({ source: "guia-editor", type: "guia-ready" }, location.origin);
}

function bindCaptureInbox() {
  window.addEventListener("message", async (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.source !== "guia-capture" || data.type !== "import-project") return;

    try {
      if (!Array.isArray(data.payload?.steps)) {
        throw new Error(t("err.captureNoSteps"));
      }
      const created = await importCapturePayload(data.payload);
      window.postMessage(
        {
          source: "guia-capture",
          type: "import-ack",
          ok: true,
          projectId: created.id,
        },
        location.origin
      );
      toast(t("toast.projectCreated", { name: created.name }));
    } catch (err) {
      console.error(err);
      window.postMessage(
        {
          source: "guia-capture",
          type: "import-ack",
          ok: false,
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

async function boot() {
  initLocale();
  applyI18n(document);
  bindLocaleSelect(document.getElementById("locale-select"), () => {
    applyChromeAppearance();
    paintChrome();
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
  if (index.activeProjectId) {
    const loaded = await getProject(index.activeProjectId);
    if (loaded) {
      await openProject(loaded.id, { autoPreview: seeded && (loaded.steps || []).length > 0 });
      signalGuiaReady();
      return;
    }
    await setActiveProjectId(null);
  }

  if (seeded) {
    const first = (readIndex().projects || [])[0];
    if (first?.id) {
      await openProject(first.id, { autoPreview: true });
      signalGuiaReady();
      return;
    }
  }

  showLibrary();
  signalGuiaReady();
}

boot();
