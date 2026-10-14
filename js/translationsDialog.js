/**
 * Painel “Idiomas do tour” (PRD multi-idioma §6.1, RF1–RF5, Q11).
 * Formato e edição manual são OSS; IA e TTS hospedados entram por hooks (`onTranslate`).
 */
import { t } from "./i18n.js";
import { CARTESIA_VOICE_CATALOG, narrationLanguage, voicesForLanguage } from "./cartesia.js";
import {
  CONTENT_LANGS,
  addLang,
  baseLang,
  ensureI18n,
  langLabel,
  projectI18n,
  removeLang,
  translationStatus,
} from "./tour-schema/i18n.js";

const REGIONAL = ["pt-BR", "pt-PT", "es-ES", "es-MX", "en-US", "en-GB"];
/** Lista oferecida no “Adicionar idioma”: variantes regionais de pt/es/en + bases do sonic-3.6. */
export function languageChoices() {
  const out = [...REGIONAL];
  for (const l of CONTENT_LANGS) if (!["pt", "es", "en"].includes(l)) out.push(l);
  out.push("pt", "es", "en");
  return out.map((tag) => ({ tag, label: langLabel(tag) })).sort((a, b) => a.label.localeCompare(b.label));
}

/** Vozes conhecidas para o idioma (catálogo curado + dinâmico injetado). */
export function voiceOptions(tag, extra = {}) {
  const base = baseLang(tag);
  const list = extra[base] || voicesForLanguage(base) || [];
  return list;
}

function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null) node.append(kid);
  return node;
}

export function createTranslationsDialog({
  getProject,
  onChange,
  toast,
  listProjects = async () => [],
  onOpenGrid,
  onTranslate,
  loadVoices,
  onEditLangChange,
  onPreviewVoice,
}) {
  let dialog = null;
  let dynamicVoices = {};
  let createdNow = false;

  function ensureDom() {
    if (dialog) return dialog;
    dialog = el("dialog", { class: "studio-modal ml-modal", id: "modal-languages", "aria-labelledby": "ml-title" });
    document.body.append(dialog);
    dialog.addEventListener("close", () => {
      const project = getProject();
      if (createdNow && project?.i18n && !project.i18n.langs?.length) delete project.i18n;
      createdNow = false;
      onEditLangChange?.();
    });
    return dialog;
  }

  function voiceSelect(tag, current, onPick) {
    const voices = voiceOptions(tag, dynamicVoices);
    const select = el("select", { class: "ml-voice", "aria-label": t("ml.voice") });
    if (!voices.length) select.append(el("option", { value: "", text: t("ml.voiceDefault") }));
    for (const v of voices) select.append(el("option", { value: v.id, text: v.name }));
    select.value = voices.some((v) => v.id === current) ? current : voices[0]?.id || "";
    select.addEventListener("change", () => onPick(select.value));
    return select;
  }

  function render() {
    const project = getProject();
    if (!project) return;
    const cfg = projectI18n(project) || ensureI18n(project);
    const status = translationStatus(project);
    const d = ensureDom();
    d.replaceChildren();
    const body = el("div", { class: "studio-modal-body ml-dialog" });
    d.append(body);
    body.append(
      el("div", { class: "account-dialog-head" },
        el("h3", { id: "ml-title", text: t("ml.title") }),
        el("button", { type: "button", class: "btn btn-icon", "aria-label": t("canvas.close"), onclick: () => d.close(), text: "×" })),
    );

    // origem
    const srcRow = el("div", { class: "ml-row ml-source" },
      el("span", { class: "ml-lang", text: `${t("ml.source")}: ${langLabel(cfg.defaultLang)}` }));
    const srcVoice = project.narration?.voices?.[baseLang(cfg.defaultLang)] || "";
    const srcVoices = voiceOptions(cfg.defaultLang, dynamicVoices);
    const srcName = srcVoices.find((v) => v.id === srcVoice)?.name || srcVoices[0]?.name || "";
    if (srcName) srcRow.append(el("span", { class: "props-meta", text: `${t("ml.voice")}: ${srcName}` }));
    body.append(srcRow);
    if (!cfg.langs.length) {
      const sel = el("select", { id: "ml-source-lang", "aria-label": t("ml.source") });
      for (const c of languageChoices()) sel.append(el("option", { value: c.tag, text: c.label }));
      sel.value = cfg.defaultLang;
      sel.addEventListener("change", () => {
        project.i18n.defaultLang = sel.value;
        onChange();
        render();
      });
      srcRow.append(sel);
    }

    // alvos
    const list = el("div", { class: "ml-list", role: "list" });
    for (const l of cfg.langs) {
      const c = status[l.lang] || {};
      const pending = (c.missing || 0) + (c.stale || 0) + (c.auto || 0);
      const row = el("div", { class: "ml-row", role: "listitem", "data-lang": l.lang },
        el("span", { class: "ml-lang", text: langLabel(l.lang) }),
        voiceSelect(l.locale || l.lang, l.voiceId, (id) => {
          const item = project.i18n.langs.find((x) => x.lang === l.lang);
          if (item) item.voiceId = id;
          onChange();
        }),
        onPreviewVoice ? el("button", { type: "button", class: "btn btn-sm", "aria-label": t("ml.listen"), title: t("ml.listen"), text: "▶",
          onclick: () => onPreviewVoice(l, project.i18n.langs.find((x) => x.lang === l.lang)?.voiceId) }) : null,
        el("label", { class: "checkbox ml-enabled" },
          el("input", { type: "checkbox", checked: l.enabled, onchange: (e) => {
            const item = project.i18n.langs.find((x) => x.lang === l.lang);
            if (item) item.enabled = e.target.checked;
            onChange();
          } }),
          el("span", { text: t("ml.inPlayer") })),
        el("span", { class: `ml-count${pending ? " is-pending" : ""}`, text: pending ? t("ml.pendingN", { n: pending }) : t("ml.allReviewed") }),
        el("button", { type: "button", class: "btn btn-sm btn-danger", text: t("ml.remove"), onclick: () => {
          if (!confirm(t("ml.removeConfirm", { lang: langLabel(l.lang) }))) return;
          removeLang(project, l.lang);
          onChange();
          render();
        } }),
      );
      list.append(row);
    }
    body.append(list);

    // adicionar
    const add = el("select", { id: "ml-add-lang", "aria-label": t("ml.add") },
      el("option", { value: "", text: t("ml.addPick") }));
    const taken = new Set([cfg.defaultLang, ...cfg.langs.map((l) => l.lang)]);
    for (const c of languageChoices()) if (!taken.has(c.tag)) add.append(el("option", { value: c.tag, text: c.label }));
    body.append(el("div", { class: "ml-row ml-add" }, add,
      el("button", { type: "button", class: "btn", text: `+ ${t("ml.add")}`, onclick: async () => {
        if (!add.value) return;
        const tag = add.value;
        const voices = voiceOptions(tag, dynamicVoices);
        try {
          addLang(project, tag, { voiceId: voices[0]?.id || "", locale: REGIONAL.includes(tag) ? tag : tag });
        } catch (err) {
          toast(t(err.message === "max_langs" ? "ml.maxLangs" : "ml.invalid"));
          return;
        }
        onChange();
        if (!voices.length && loadVoices) {
          dynamicVoices = { ...dynamicVoices, ...(await loadVoices(baseLang(tag)).catch(() => ({}))) };
          const item = project.i18n.langs.find((x) => x.lang === tag);
          const first = voiceOptions(tag, dynamicVoices)[0];
          if (item && first && !item.voiceId) { item.voiceId = first.id; onChange(); }
        }
        render();
      } })));

    // glossário e tom (Q11)
    const gloss = el("textarea", { id: "ml-glossary", rows: "2", placeholder: t("ml.glossaryHint") });
    gloss.value = (cfg.glossary || []).join(", ");
    gloss.addEventListener("change", () => {
      project.i18n.glossary = gloss.value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 50);
      onChange();
    });
    const tone = el("select", { id: "ml-tone", "aria-label": t("ml.tone") },
      el("option", { value: "informal", text: t("ml.toneInformal") }),
      el("option", { value: "formal", text: t("ml.toneFormal") }));
    tone.value = cfg.tone;
    tone.addEventListener("change", () => { project.i18n.tone = tone.value; onChange(); });
    const copyFrom = el("select", { id: "ml-copy-from", "aria-label": t("ml.copyFrom") },
      el("option", { value: "", text: t("ml.copyFrom") }));
    listProjects().then((items) => {
      for (const p of items) if (p.id !== project.id && p.i18n && (p.i18n.glossary?.length || p.i18n.tone)) {
        copyFrom.append(el("option", { value: p.id, text: p.name || p.id }));
      }
      copyFrom._items = items;
    }).catch(() => {});
    copyFrom.addEventListener("change", () => {
      const src = (copyFrom._items || []).find((p) => p.id === copyFrom.value);
      if (!src) return;
      project.i18n.glossary = [...(src.i18n.glossary || [])];
      project.i18n.tone = src.i18n.tone || project.i18n.tone;
      onChange();
      toast(t("ml.copied"));
      render();
    });
    body.append(el("details", { class: "settings-fold ml-style" },
      el("summary", { text: t("ml.glossaryTone") }),
      el("div", { class: "settings-fold-body" },
        el("label", {}, el("span", { text: t("ml.glossary") }), gloss),
        el("label", {}, el("span", { text: t("ml.tone") }), tone),
        copyFrom)));

    // ações
    const actions = el("div", { class: "ml-actions" });
    if (onTranslate && cfg.langs.length) {
      actions.append(el("button", { type: "button", class: "btn btn-primary", id: "btn-ml-translate", onclick: () => onTranslate({ render }) },
        el("span", { text: t("ml.translateAll") }), el("span", { class: "pro-crown", "aria-hidden": "true", text: " 👑" })));
    }
    if (onOpenGrid && cfg.langs.length) actions.append(el("button", { type: "button", class: "btn", text: t("ml.openReview"), onclick: () => { d.close(); onOpenGrid(); } }));
    body.append(actions);
    body.append(el("p", { class: "props-meta", text: t("ml.note") }));
  }

  return {
    open() {
      const project = getProject();
      if (!project) return;
      // why: abrir o painel não muda o payload; o bloco só fica se um idioma for adicionado
      createdNow = !project.i18n;
      if (createdNow) {
        ensureI18n(project);
        const lang = narrationLanguage(project.narration?.voiceURI);
        if (CARTESIA_VOICE_CATALOG[lang] && baseLang(project.i18n.defaultLang) !== lang) project.i18n.defaultLang = lang;
      }
      render();
      if (!dialog.open) dialog.showModal();
    },
    render,
    close() { dialog?.close(); },
  };
}
