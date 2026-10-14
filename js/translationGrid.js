/**
 * Grade “Revisar traduções” — passos × idiomas (PRD multi-idioma §5.3, §6.2; RF11–RF14).
 * OSS: edição manual e aprovação; IA/TTS hospedados entram por hooks.
 */
import { t } from "./i18n.js";
import {
  approveTranslation,
  langAudioPlan,
  audioStatus,
  fieldStatus,
  getTranslation,
  isConsentField,
  langLabel,
  projectI18n,
  setTranslation,
  translatableFields,
  translationStatus,
} from "./tour-schema/i18n.js";

const STATUS_CLASS = { auto: "is-auto", reviewed: "is-reviewed", stale: "is-stale", missing: "is-missing" };
const MULTI = new Set(["description", "caption", "body", "consentText", "contact.consentText", "whatsapp.message"]);

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

/** Linhas da grade: passo inicial e final fixados nas pontas (RF11). */
export function gridRows(project) {
  const fields = translatableFields(project).filter((f) => f.kind !== "project");
  const rows = [];
  const byOwner = new Map();
  for (const f of fields) {
    const key = `${f.kind}:${f.id}`;
    if (!byOwner.has(key)) {
      const row = { key, kind: f.kind, id: f.id, fields: [] };
      byOwner.set(key, row);
      rows.push(row);
    }
    byOwner.get(key).fields.push(f);
  }
  const order = (r) => (r.kind === "start" ? 0 : r.kind === "end" ? 2 : 1);
  return rows.sort((a, b) => order(a) - order(b));
}

export function rowPending(project, row, lang) {
  return row.fields.some((f) => fieldStatus(project, f, lang) !== "reviewed");
}

export function createTranslationGrid({ getProject, onChange, toast, onTranslate, onGenerateAudio, onRetranslate }) {
  let dialog = null;
  let onlyPending = false;
  let onlyLang = "";
  let query = "";

  function ensureDom() {
    if (dialog) return dialog;
    dialog = el("dialog", { class: "studio-modal tg-modal", id: "modal-translations", "aria-labelledby": "tg-title" });
    document.body.append(dialog);
    return dialog;
  }

  function statusChip(status, f) {
    const chip = el("span", { class: `tg-status ${STATUS_CLASS[status]}`, text: t(`tg.status.${status}`) });
    if (status === "stale") chip.title = t("tg.staleHint");
    if (f && isConsentField(f) && status === "auto") chip.title = t("tg.consentWarn");
    return chip;
  }

  function rowTitle(project, row, index) {
    if (row.kind === "start") return t("tg.rowStart");
    if (row.kind === "end") return t("tg.rowEnd");
    const step = project.steps.find((s) => s.id === row.id);
    return `${index}. ${step?.label || step?.popover?.title || ""}`.trim();
  }

  function fieldLabel(f) {
    return t(`tg.field.${f.field}`);
  }

  function editor(project, f, lang, status) {
    const value = getTranslation(project, f.kind, f.id, f.field, lang);
    const multi = MULTI.has(f.field);
    const input = multi
      ? el("textarea", { rows: f.field === "caption" ? "3" : "2", class: "tg-input" })
      : el("input", { type: "text", class: "tg-input" });
    input.value = value;
    input.placeholder = f.text;
    input.setAttribute("aria-label", `${fieldLabel(f)} · ${langLabel(lang)}`);
    input.addEventListener("change", () => {
      setTranslation(project, { kind: f.kind, id: f.id, field: f.field, lang, text: input.value, status: "reviewed" });
      onChange();
      render({ keepFocus: input.dataset.key });
    });
    input.dataset.key = `${f.kind}:${f.id}:${f.field}:${lang}`;
    return el("label", { class: "tg-field" },
      el("span", { class: "tg-field-head" }, el("span", { text: fieldLabel(f) }), statusChip(status, f)),
      input,
      isConsentField(f) && status === "auto" ? el("span", { class: "tg-consent-warn", role: "note", text: t("tg.consentWarn") }) : null);
  }

  function render({ keepFocus } = {}) {
    const project = getProject();
    const d = ensureDom();
    if (!project) return;
    const cfg = projectI18n(project);
    const langs = (cfg?.langs || []).map((l) => l.lang).filter((l) => !onlyLang || l === onlyLang);
    const totals = translationStatus(project);
    let pending = 0;
    let stale = 0;
    let audioN = 0;
    for (const l of langs) {
      const c = totals[l] || {};
      pending += (c.missing || 0) + (c.auto || 0);
      stale += c.stale || 0;
    }
    // why: o botão mostra o que será cobrado (RF16): só itens com tradução da legenda
    const audioPlan = langAudioPlan(project, { langs });
    audioN = audioPlan.length;
    const audioMin = Math.max(1, Math.round(audioPlan.reduce((a, x) => a + x.seconds, 0) / 60));
    const scroll = d.querySelector(".tg-scroll")?.scrollTop || 0;
    d.replaceChildren();
    const body = el("div", { class: "studio-modal-body tg-dialog" });
    d.append(body);
    body.append(el("div", { class: "account-dialog-head" },
      el("div", {},
        el("h3", { id: "tg-title", text: t("tg.title") }),
        el("p", { class: "props-meta", text: t("tg.subtitle", { n: pending, m: stale }) })),
      el("button", { type: "button", class: "btn btn-icon", "aria-label": t("canvas.close"), text: "×", onclick: () => d.close() })));

    const langSel = el("select", { "aria-label": t("tg.onlyLang") }, el("option", { value: "", text: t("tg.allLangs") }),
      ...(cfg?.langs || []).map((l) => el("option", { value: l.lang, text: langLabel(l.lang) })));
    langSel.value = onlyLang;
    langSel.addEventListener("change", () => { onlyLang = langSel.value; render(); });
    const search = el("input", { type: "search", placeholder: t("tg.search"), "aria-label": t("tg.search") });
    search.value = query;
    search.addEventListener("input", () => { query = search.value; renderSoon(); });
    const pend = el("label", { class: "checkbox" }, el("input", { type: "checkbox", checked: onlyPending, onchange: (e) => { onlyPending = e.target.checked; render(); } }), el("span", { text: t("tg.onlyPending") }));
    const bar = el("div", { class: "tg-bar", role: "toolbar", "aria-label": t("tg.title") });
    if (onTranslate) bar.append(el("button", { type: "button", class: "btn btn-primary", id: "btn-tg-translate", onclick: () => onTranslate({ langs, render }) }, el("span", { text: t("ml.translateAll") }), el("span", { "aria-hidden": "true", text: " 👑" })));
    if (onGenerateAudio) bar.append(el("button", { type: "button", class: "btn", id: "btn-tg-audio", disabled: !audioN, onclick: () => onGenerateAudio({ langs, render }) }, el("span", { text: t("tg.genAudio", { n: audioN, m: audioMin }) }), el("span", { "aria-hidden": "true", text: " 👑" })));
    bar.append(el("button", { type: "button", class: "btn", id: "btn-tg-approve", onclick: () => {
      let n = 0;
      for (const l of langs) n += approveTranslation(project, l);
      if (n) onChange();
      toast(t("tg.approvedN", { n }));
      render();
    }, text: onlyLang ? t("tg.approveLang") : t("tg.approveAll") }));
    bar.append(pend, langSel, search);
    body.append(bar);

    if (!langs.length) {
      body.append(el("p", { class: "props-meta", text: t("tg.noLangs") }));
      return;
    }

    const table = el("table", { class: "tg-table" });
    const head = el("tr", {}, el("th", { scope: "col", text: `${langLabel(cfg.defaultLang)} · ${t("ml.sourceShort")}` }),
      ...langs.map((l) => el("th", { scope: "col", text: langLabel(l) })));
    table.append(el("thead", {}, head));
    const tbody = el("tbody");
    const q = query.trim().toLowerCase();
    let stepIndex = 0;
    for (const row of gridRows(project)) {
      if (row.kind === "step") stepIndex = project.steps.findIndex((s) => s.id === row.id) + 1;
      if (onlyPending && !langs.some((l) => rowPending(project, row, l))) continue;
      if (q && !row.fields.some((f) => f.text.toLowerCase().includes(q) || langs.some((l) => getTranslation(project, f.kind, f.id, f.field, l).toLowerCase().includes(q)))) continue;
      const tr = el("tr", { "data-row": row.key });
      const src = el("th", { scope: "row", class: "tg-src" }, el("div", { class: "tg-row-title", text: rowTitle(project, row, stepIndex) }),
        ...row.fields.map((f) => el("div", { class: "tg-src-field" }, el("span", { class: "tg-field-label", text: fieldLabel(f) }), el("span", { text: f.text }))));
      tr.append(src);
      for (const lang of langs) {
        const cell = el("td", { class: "tg-cell", "data-lang": lang });
        for (const f of row.fields) cell.append(editor(project, f, lang, fieldStatus(project, f, lang)));
        const actions = el("div", { class: "tg-cell-actions" });
        if (row.fields.some((f) => fieldStatus(project, f, lang) === "auto")) {
          actions.append(el("button", { type: "button", class: "btn btn-sm", text: t("tg.approve"), onclick: () => {
            approveTranslation(project, lang, { kind: row.kind, id: row.id });
            onChange();
            render();
          } }));
        }
        if (onRetranslate) actions.append(el("button", { type: "button", class: "btn btn-sm", text: t("tg.retranslate"), onclick: () => onRetranslate({ lang, row, render }) }));
        if (row.kind === "step") {
          const step = project.steps.find((s) => s.id === row.id);
          const voiceId = cfg.langs.find((l) => l.lang === lang)?.voiceId || "";
          const a = audioStatus(step, lang, { voiceId });
          if (a !== "none") {
            actions.append(el("span", { class: `tg-audio tg-audio-${a}`, text: t(`tg.audio.${a}`) }));
            if (onGenerateAudio && a !== "ok") actions.append(el("button", { type: "button", class: "btn btn-sm", "aria-label": t("tg.genAudioCell"), title: t("tg.genAudioCell"), text: "⟳", onclick: () => onGenerateAudio({ langs: [lang], stepIds: [row.id], render }) }));
          }
        }
        if (actions.childNodes.length) cell.append(actions);
        tr.append(cell);
      }
      tbody.append(tr);
    }
    table.append(tbody);
    const wrap = el("div", { class: "tg-scroll" }, table);
    body.append(wrap);
    wrap.scrollTop = scroll;
    if (keepFocus) d.querySelector(`[data-key="${CSS.escape(keepFocus)}"]`)?.focus();
  }

  let soon = 0;
  function renderSoon() {
    clearTimeout(soon);
    soon = setTimeout(() => {
      render();
      dialog?.querySelector('input[type="search"]')?.focus();
    }, 200);
  }

  return {
    open(opts = {}) {
      if (opts.lang != null) onlyLang = opts.lang;
      render();
      if (!dialog.open) dialog.showModal();
    },
    render: () => dialog?.open && render(),
    close: () => dialog?.close(),
  };
}
