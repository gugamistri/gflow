/**
 * Diálogo Captura (ENTRADA): abas Formulário inicial, Campos, Passo final e Consentimento.
 * Os cartões 📌 da filmstrip abrem a aba certa. O rascunho só vai para o projeto em "Salvar"
 * — um passo de histórico por edição, no mesmo formato de `fixedSteps` (sem migração).
 */
import { getLocale, t } from "./i18n.js";
import {
  LEAD_FIELDS,
  defaultEndStep,
  defaultStartStep,
  normalizeStartStep,
  normalizeEndStep,
  safeContactHref,
  leadPhoneDefaultIso,
  splitWhatsAppNumber,
} from "./fixedSteps.js";
import { renderEndCard, renderStartCard } from "./fixedStepsView.js";
import { defaultCountry } from "./phoneCountries.js";
import { createPhoneField, phoneErrorText as sharedPhoneErrorText } from "./phoneField.js";

const $ = (id) => document.getElementById(id);

export const CAPTURE_TABS = ["form", "fields", "end", "consent"];

/** Atalho da filmstrip (start/end) ou nome da aba → aba do diálogo. */
export function captureTabForShortcut(kind) {
  if (kind === "end") return "end";
  if (kind === "fields" || kind === "consent" || kind === "form") return kind;
  return "form";
}

/** Próxima aba pelas setas, Home e End. `tabs` é a ordem visível. */
export function nextCaptureTab(current, key, tabs = CAPTURE_TABS) {
  const list = tabs.length ? tabs : CAPTURE_TABS;
  const i = Math.max(0, list.indexOf(current));
  if (key === "ArrowRight") return list[(i + 1) % list.length];
  if (key === "ArrowLeft") return list[(i + list.length - 1) % list.length];
  if (key === "Home") return list[0];
  if (key === "End") return list[list.length - 1];
  return list[i];
}

/** Quais lados mudaram desde que o diálogo abriu — um salvamento grava os dois no mesmo passo. */
export function captureChanges(before, after) {
  return {
    start: JSON.stringify(before?.start) !== JSON.stringify(after?.start),
    end: JSON.stringify(before?.end) !== JSON.stringify(after?.end),
  };
}

function phoneErrorText(result, countryName) {
  return sharedPhoneErrorText(result, countryName, t);
}

function withI18n(raw, prev) {
  if (prev?.i18n && typeof prev.i18n === "object" && !Array.isArray(prev.i18n)) raw.i18n = prev.i18n;
  return raw;
}

export function createFixedStepsEditor(ctx) {
  const { getProject, onSaved, viewerIsPro, openFeatureGate, openLeads, cloudShareEnabled, notify } = ctx;
  let bound = false;
  let phoneField = null;
  let currentTab = "form";
  let baseline = null;

  function endEls() {
    return {
      dialog: $("modal-capture"),
      form: $("capture-form"),
      enabled: $("fixed-end-enabled"),
      config: $("fixed-end-config"),
      title: $("fixed-end-title"),
      body: $("fixed-end-body"),
      wa: $("fixed-end-wa"),
      waFields: $("fixed-end-wa-fields"),
      waPhone: $("fixed-end-wa-phone"),
      waCc: $("fixed-end-wa-cc"),
      waCcFlag: $("fixed-end-wa-cc-flag"),
      waCcDial: $("fixed-end-wa-cc-dial"),
      waCcPop: $("fixed-end-wa-cc-pop"),
      waCcSearch: $("fixed-end-wa-cc-search"),
      waCcList: $("fixed-end-wa-cc-list"),
      waCcEmpty: $("fixed-end-wa-cc-empty"),
      waError: $("fixed-end-wa-error"),
      waMessage: $("fixed-end-wa-message"),
      waLabel: $("fixed-end-wa-label"),
      contact: $("fixed-end-contact"),
      contactFields: $("fixed-end-contact-fields"),
      mode: $("fixed-end-mode"),
      linkFields: $("fixed-end-link-fields"),
      formFields: $("fixed-end-form-fields"),
      url: $("fixed-end-url"),
      urlError: $("fixed-end-url-error"),
      consent: $("fixed-end-consent"),
      contactLabel: $("fixed-end-contact-label"),
      replay: $("fixed-end-replay"),
      preview: $("fixed-end-preview"),
    };
  }

  function startEls() {
    return {
      dialog: $("modal-capture"),
      form: $("capture-form"),
      enabled: $("fixed-start-enabled"),
      config: $("fixed-start-config"),
      fieldsConfig: $("fixed-start-fields-config"),
      fieldsOff: $("capture-fields-off"),
      title: $("fixed-start-title"),
      body: $("fixed-start-body"),
      fields: $("fixed-start-fields"),
      fieldsError: $("fixed-start-fields-error"),
      consent: $("fixed-start-consent"),
      submit: $("fixed-start-submit"),
      skip: $("fixed-start-skip"),
      skipLabelWrap: $("fixed-start-skip-label-wrap"),
      skipLabel: $("fixed-start-skip-label"),
      leads: $("btn-fixed-start-leads"),
      preview: $("fixed-start-preview"),
    };
  }

  function selectedMode(els) {
    const checked = els.form.querySelector('input[name="fixed-end-mode"]:checked');
    return checked?.value === "form" && !els.mode.hidden ? "form" : "link";
  }

  function readEnd(els) {
    const phoneResult = phoneField.read();
    const phone = phoneResult.ok ? phoneResult.digits : "";
    const rawUrl = els.url.value.trim();
    const mode = selectedMode(els);
    const step = normalizeEndStep(withI18n({
      enabled: els.enabled.checked,
      title: els.title.value,
      body: els.body.value,
      whatsapp: {
        enabled: els.wa.checked,
        phone,
        message: els.waMessage.value,
        label: els.waLabel.value,
      },
      contact: {
        enabled: els.contact.checked,
        mode,
        url: rawUrl,
        label: els.contactLabel.value,
        consentText: els.consent?.value || "",
      },
      showReplay: els.replay.checked,
    }, getProject()?.endStep));
    const errors = {
      phone: els.wa.checked && !phoneResult.ok ? phoneErrorText(phoneResult, phoneField.countryName()) : "",
      url: els.contact.checked && mode === "link" && !safeContactHref(rawUrl),
    };
    return { step, errors };
  }

  function readStart(els) {
    const fields = {};
    for (const key of LEAD_FIELDS) {
      const show = fieldBox(els, key, "show").checked;
      fields[key] = { show, required: show && fieldBox(els, key, "required").checked };
    }
    const step = normalizeStartStep(withI18n({
      enabled: els.enabled.checked,
      title: els.title.value,
      body: els.body.value,
      fields,
      consentText: els.consent.value.trim(),
      allowSkip: els.skip.checked,
      submitLabel: els.submit.value,
      skipLabel: els.skipLabel.value,
    }, getProject()?.startStep));
    const errors = { fields: !LEAD_FIELDS.some((key) => step.fields[key].show) };
    return { step, errors };
  }

  function fieldBox(els, key, prop) {
    return els.fields.querySelector(`input[data-field="${key}"][data-prop="${prop}"]`);
  }

  function paintEnd(els, { showErrors = false } = {}) {
    const { step, errors } = readEnd(els);
    els.config.classList.toggle("is-off", !els.enabled.checked);
    els.waFields.hidden = !els.wa.checked;
    els.contactFields.hidden = !els.contact.checked;
    const mode = selectedMode(els);
    els.linkFields.hidden = mode !== "link";
    els.formFields.hidden = mode !== "form";
    const showPhone = Boolean(errors.phone) && Boolean(showErrors || els.waPhone.dataset.touched);
    els.waError.hidden = !showPhone;
    if (errors.phone) els.waError.textContent = errors.phone;
    els.waPhone.setAttribute("aria-invalid", String(showPhone));
    els.urlError.hidden = !(showErrors || els.url.dataset.touched) || !errors.url;
    const project = getProject();
    const card = renderEndCard(step, {
      preview: true,
      tour: project?.name || "",
      link: "https://guiaflow.pro/p/…",
      contactForm: mode === "form",
    });
    els.preview.replaceChildren(card);
    els.preview.classList.toggle("is-off", !step.enabled);
    return { step, errors };
  }

  function paintStart(els, { showErrors = false } = {}) {
    const { step, errors } = readStart(els);
    els.config.classList.toggle("is-off", !els.enabled.checked);
    els.fieldsConfig?.classList.toggle("is-off", !els.enabled.checked);
    if (els.fieldsOff) els.fieldsOff.hidden = els.enabled.checked;
    for (const key of LEAD_FIELDS) {
      const req = fieldBox(els, key, "required");
      req.disabled = !fieldBox(els, key, "show").checked;
      if (req.disabled) req.checked = false;
    }
    els.fieldsError.hidden = !(showErrors && step.enabled && errors.fields);
    els.skipLabelWrap.hidden = !els.skip.checked;
    const nav = globalThis.navigator;
    const card = renderStartCard(step, {
      preview: true,
      consentText: step.consentText || t("fixed.consentDefault"),
      phoneCountry: leadPhoneDefaultIso(getProject()?.endStep, getLocale(), nav?.languages || [nav?.language]),
    });
    els.preview.replaceChildren(card);
    els.preview.classList.toggle("is-off", !step.enabled);
    return { step, errors };
  }

  function syncPreview() {
    const showEnd = currentTab === "end";
    const startPreview = $("fixed-start-preview");
    const endPreview = $("fixed-end-preview");
    if (startPreview) startPreview.hidden = showEnd;
    if (endPreview) endPreview.hidden = !showEnd;
  }

  function paint({ showErrors = false } = {}) {
    const start = paintStart(startEls(), { showErrors });
    const end = paintEnd(endEls(), { showErrors });
    syncPreview();
    return { start, end };
  }

  function snapshot() {
    return {
      start: readStart(startEls()).step,
      end: readEnd(endEls()).step,
    };
  }

  function selectTab(name, { focus = false } = {}) {
    const dialog = $("modal-capture");
    if (!dialog) return;
    const tabs = [...dialog.querySelectorAll("[data-capture-tab]")].filter((tab) => !tab.hidden);
    const target = tabs.find((tab) => tab.dataset.captureTab === name) || tabs[0];
    if (!target) return;
    currentTab = target.dataset.captureTab;
    for (const tab of tabs) {
      const on = tab === target;
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.tabIndex = on ? 0 : -1;
      const pane = document.getElementById(tab.getAttribute("aria-controls"));
      if (pane) pane.hidden = !on;
    }
    syncPreview();
    if (focus) target.focus();
  }

  function fillEnd(els, raw) {
    const base = raw ? normalizeEndStep(raw) : defaultEndStep();
    els.enabled.checked = base.enabled;
    els.title.value = base.title;
    els.body.value = base.body;
    const parsed = splitWhatsAppNumber(base.whatsapp.phone);
    const savedRaw = String(raw?.whatsapp?.phone ?? "").trim();
    els.wa.checked = base.whatsapp.enabled && Boolean(parsed || savedRaw);
    phoneField.fill(parsed);
    if (!parsed && savedRaw) els.waPhone.value = savedRaw;
    els.waMessage.value = base.whatsapp.message || t("fixed.end.waDefaultMessage");
    els.waLabel.value = base.whatsapp.label;
    els.contact.checked = base.contact.enabled;
    const mode = base.contact.mode === "form" && !els.mode.hidden ? "form" : "link";
    for (const radio of els.form.querySelectorAll('input[name="fixed-end-mode"]')) radio.checked = radio.value === mode;
    els.url.value = base.contact.url.replace(/^mailto:/, "");
    if (els.consent) els.consent.value = base.contact.consentText;
    els.contactLabel.value = base.contact.label;
    els.replay.checked = base.showReplay;
    if (parsed || !savedRaw) delete els.waPhone.dataset.touched;
    else els.waPhone.dataset.touched = "1";
    delete els.url.dataset.touched;
  }

  function fillStart(els, raw) {
    const base = raw ? normalizeStartStep(raw) : defaultStartStep();
    els.enabled.checked = base.enabled;
    els.title.value = base.title;
    els.body.value = base.body;
    for (const key of LEAD_FIELDS) {
      fieldBox(els, key, "show").checked = base.fields[key].show;
      fieldBox(els, key, "required").checked = base.fields[key].required;
    }
    els.consent.value = base.consentText;
    els.submit.value = base.submitLabel;
    els.skip.checked = base.allowSkip;
    els.skipLabel.value = base.skipLabel;
  }

  /** Liga o formulário inicial só no Pro com link permanente. Quem já tinha ligado continua podendo salvar. */
  function blockNewStartEnable() {
    const wasOn = Boolean(baseline?.start?.enabled);
    const box = startEls().enabled;
    if (!box?.checked || wasOn) return false;
    if (!viewerIsPro()) {
      box.checked = false;
      openFeatureGate("leads");
      return true;
    }
    if (typeof cloudShareEnabled === "function" && !cloudShareEnabled()) {
      box.checked = false;
      notify?.("fixed.start.needsCloud");
      return true;
    }
    return false;
  }

  function bind() {
    if (bound) return;
    bound = true;
    const end = endEls();
    const start = startEls();
    if (!end.dialog || !end.form) return;
    phoneField = createPhoneField(
      {
        button: end.waCc,
        flag: end.waCcFlag,
        dial: end.waCcDial,
        input: end.waPhone,
        pop: end.waCcPop,
        search: end.waCcSearch,
        list: end.waCcList,
        empty: end.waCcEmpty,
      },
      {
        locale: getLocale,
        defaultIso: () => defaultCountry(getLocale(), globalThis.navigator?.languages || [globalThis.navigator?.language]),
        onChange: () => paint(),
        t,
      }
    );
    end.form.addEventListener("input", (e) => {
      if (e.target === end.waPhone || e.target === end.waCcSearch) return;
      paint();
    });
    end.form.addEventListener("change", (e) => {
      if (e.target === start.enabled && blockNewStartEnable()) {
        paint();
        return;
      }
      if (e.target?.name === "fixed-end-mode" && e.target.value === "form" && !viewerIsPro()) {
        for (const radio of end.form.querySelectorAll('input[name="fixed-end-mode"]')) radio.checked = radio.value === "link";
        paint();
        openFeatureGate("contactForm");
        return;
      }
      paint();
    });
    for (const input of [end.waPhone, end.url]) {
      input.addEventListener("blur", () => {
        input.dataset.touched = "1";
        paint();
      });
    }
    end.dialog.querySelectorAll("[data-fixed-close]").forEach((btn) =>
      btn.addEventListener("click", () => end.dialog.close())
    );
    start.leads?.addEventListener("click", () => {
      end.dialog.close();
      openLeads?.();
    });
    const tablist = end.dialog.querySelector("[data-capture-tabs]");
    tablist?.addEventListener("click", (e) => {
      const tab = e.target.closest?.("[data-capture-tab]");
      if (!tab || tab.hidden) return;
      selectTab(tab.dataset.captureTab);
    });
    tablist?.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
      const tabs = [...tablist.querySelectorAll("[data-capture-tab]")].filter((tab) => !tab.hidden);
      const names = tabs.map((tab) => tab.dataset.captureTab);
      const selected = tabs.find((tab) => tab.getAttribute("aria-selected") === "true")?.dataset.captureTab || names[0];
      e.preventDefault();
      selectTab(nextCaptureTab(selected, e.key, names), { focus: true });
    });
    end.form.addEventListener("submit", (e) => {
      e.preventDefault();
      const { start: startRead, end: endRead } = paint({ showErrors: true });
      if (startRead.step.enabled && startRead.errors.fields) {
        selectTab("fields");
        return;
      }
      if (endRead.step.enabled && (endRead.errors.phone || endRead.errors.url)) {
        selectTab("end");
        if (endRead.errors.phone) end.waPhone.dataset.touched = "1";
        (endRead.errors.phone ? end.waPhone : end.url).focus();
        return;
      }
      if (blockNewStartEnable()) {
        paint();
        return;
      }
      if (endRead.step.contact.enabled && endRead.step.contact.mode === "form" && !viewerIsPro()) {
        for (const radio of end.form.querySelectorAll('input[name="fixed-end-mode"]')) radio.checked = radio.value === "link";
        paint();
        openFeatureGate("contactForm");
        return;
      }
      const project = getProject();
      if (!project) return;
      const nextStart = startRead.step;
      const nextEnd = endRead.step;
      const changed = captureChanges(baseline, { start: nextStart, end: nextEnd });
      if (changed.start && nextStart.enabled && !nextStart.consentText) nextStart.consentText = t("fixed.consentDefault");
      if (changed.end && nextEnd.contact.mode === "form" && nextEnd.contact.enabled && !nextEnd.contact.consentText) {
        nextEnd.contact.consentText = t("fixed.consentDefault");
      }
      if (changed.start) project.startStep = nextStart;
      if (changed.end) project.endStep = nextEnd;
      end.dialog.close();
      const kind = changed.start && changed.end ? "capture" : changed.start ? "start" : changed.end ? "end" : "capture";
      onSaved(kind);
    });
  }

  function open(kind) {
    bind();
    const dialog = $("modal-capture");
    if (!dialog) return false;
    const project = getProject();
    fillStart(startEls(), project?.startStep || null);
    fillEnd(endEls(), project?.endStep || null);
    paint();
    baseline = snapshot();
    selectTab(captureTabForShortcut(kind));
    dialog.showModal();
    return true;
  }

  return { open, selectTab };
}
