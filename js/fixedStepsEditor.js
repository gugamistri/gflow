/**
 * Diálogo Captura (ENTRADA): abas Formulário inicial, Campos, Passo final e Consentimento.
 * O rascunho só vai para o projeto em "Salvar" — um passo de histórico por edição.
 * Os cartões 📌 da filmstrip abrem a aba correspondente.
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

const SHORTCUT_TAB = {
  start: "form",
  form: "form",
  fields: "fields",
  end: "end",
  consent: "consent",
};

/** Atalho da filmstrip (start/end) ou nome da aba → aba do diálogo. */
export function captureTabForShortcut(kind) {
  return SHORTCUT_TAB[kind] || "form";
}

/** Próxima aba com setas, Home e End. A lista vem dos botões visíveis. */
export function nextCaptureTab(current, key, tabs = CAPTURE_TABS) {
  const list = tabs?.length ? tabs : CAPTURE_TABS;
  let i = list.indexOf(current);
  if (i < 0) i = 0;
  if (key === "ArrowRight" || key === "ArrowDown") return list[(i + 1) % list.length];
  if (key === "ArrowLeft" || key === "ArrowUp") return list[(i - 1 + list.length) % list.length];
  if (key === "Home") return list[0];
  if (key === "End") return list[list.length - 1];
  return list[i];
}

/** Um save, um tipo: start, end ou both. Vazio = nada mudou. */
export function captureSaveKind(startChanged, endChanged) {
  if (startChanged && endChanged) return "both";
  if (startChanged) return "start";
  if (endChanged) return "end";
  return "";
}

function phoneErrorText(result, countryName) {
  return sharedPhoneErrorText(result, countryName, t);
}

function tabName(tab) {
  return tab?.dataset?.captureTab || "";
}

export function createFixedStepsEditor(ctx) {
  const { getProject, onSaved, viewerIsPro, openFeatureGate, openLeads, permanentShare, onNeedsCloud } = ctx;
  const canPermanent = permanentShare || (() => true);
  let bound = false;
  let phoneField = null;
  let baseline = { start: "", end: "" };

  function els() {
    return {
      dialog: $("modal-capture"),
      form: $("capture-form"),
      tablist: $("capture-tabs"),
      startEnabled: $("fixed-start-enabled"),
      startConfig: $("fixed-start-config"),
      fieldsConfig: $("fixed-fields-config"),
      startTitle: $("fixed-start-title"),
      startBody: $("fixed-start-body"),
      fields: $("fixed-start-fields"),
      fieldsError: $("fixed-start-fields-error"),
      startConsent: $("fixed-start-consent"),
      submitLabel: $("fixed-start-submit"),
      skip: $("fixed-start-skip"),
      skipLabelWrap: $("fixed-start-skip-label-wrap"),
      skipLabel: $("fixed-start-skip-label"),
      leads: $("btn-fixed-start-leads"),
      previewStart: $("fixed-start-preview"),
      previewFields: $("fixed-fields-preview"),
      previewConsent: $("fixed-consent-preview"),
      endEnabled: $("fixed-end-enabled"),
      endConfig: $("fixed-end-config"),
      endTitle: $("fixed-end-title"),
      endBody: $("fixed-end-body"),
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
      endConsent: $("fixed-end-consent"),
      contactLabel: $("fixed-end-contact-label"),
      replay: $("fixed-end-replay"),
      previewEnd: $("fixed-end-preview"),
    };
  }

  function tabsOf(ui) {
    return [...(ui.tablist?.querySelectorAll("[data-capture-tab]") || [])];
  }

  function selectTab(name, { focus = false } = {}) {
    const ui = els();
    const tabs = tabsOf(ui);
    const target = tabs.find((tab) => tabName(tab) === name) || tabs[0];
    if (!target) return "";
    for (const tab of tabs) {
      const on = tab === target;
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.tabIndex = on ? 0 : -1;
      const pane = document.getElementById(tab.getAttribute("aria-controls"));
      if (pane) pane.hidden = !on;
    }
    if (focus) target.focus();
    return tabName(target);
  }

  function selectedMode(ui) {
    const checked = ui.form.querySelector('input[name="fixed-end-mode"]:checked');
    return checked?.value === "form" && !ui.mode.hidden ? "form" : "link";
  }

  function fieldBox(ui, key, prop) {
    return ui.fields.querySelector(`input[data-field="${key}"][data-prop="${prop}"]`);
  }

  function readStart(ui) {
    const fields = {};
    for (const key of LEAD_FIELDS) {
      const show = fieldBox(ui, key, "show").checked;
      fields[key] = { show, required: show && fieldBox(ui, key, "required").checked };
    }
    const step = normalizeStartStep({
      enabled: ui.startEnabled.checked,
      title: ui.startTitle.value,
      body: ui.startBody.value,
      fields,
      consentText: ui.startConsent.value.trim(),
      allowSkip: ui.skip.checked,
      submitLabel: ui.submitLabel.value,
      skipLabel: ui.skipLabel.value,
      i18n: getProject()?.startStep?.i18n,
    });
    return { step, errors: { fields: !LEAD_FIELDS.some((key) => step.fields[key].show) } };
  }

  function readEnd(ui) {
    const phoneResult = phoneField.read();
    const phone = phoneResult.ok ? phoneResult.digits : "";
    const rawUrl = ui.url.value.trim();
    const mode = selectedMode(ui);
    const step = normalizeEndStep({
      enabled: ui.endEnabled.checked,
      title: ui.endTitle.value,
      body: ui.endBody.value,
      whatsapp: {
        enabled: ui.wa.checked,
        phone,
        message: ui.waMessage.value,
        label: ui.waLabel.value,
      },
      contact: {
        enabled: ui.contact.checked,
        mode,
        url: rawUrl,
        label: ui.contactLabel.value,
        consentText: ui.endConsent?.value || "",
      },
      showReplay: ui.replay.checked,
      i18n: getProject()?.endStep?.i18n,
    });
    const errors = {
      phone: ui.wa.checked && !phoneResult.ok ? phoneErrorText(phoneResult, phoneField.countryName()) : "",
      url: ui.contact.checked && mode === "link" && !safeContactHref(rawUrl),
    };
    return { step, errors };
  }

  function paintStart(ui, { showErrors = false } = {}) {
    const { step, errors } = readStart(ui);
    ui.startConfig.classList.toggle("is-off", !ui.startEnabled.checked);
    ui.fieldsConfig?.classList.toggle("is-off", !ui.startEnabled.checked);
    for (const key of LEAD_FIELDS) {
      const req = fieldBox(ui, key, "required");
      req.disabled = !fieldBox(ui, key, "show").checked;
      if (req.disabled) req.checked = false;
    }
    ui.fieldsError.hidden = !(showErrors && step.enabled && errors.fields);
    ui.skipLabelWrap.hidden = !ui.skip.checked;
    const nav = globalThis.navigator;
    const cardOpts = {
      preview: true,
      consentText: step.consentText || t("fixed.consentDefault"),
      phoneCountry: leadPhoneDefaultIso(getProject()?.endStep, getLocale(), nav?.languages || [nav?.language]),
    };
    for (const preview of [ui.previewStart, ui.previewFields, ui.previewConsent]) {
      if (!preview) continue;
      preview.replaceChildren(renderStartCard(step, cardOpts));
      preview.classList.toggle("is-off", !step.enabled);
    }
    return { step, errors };
  }

  function paintEnd(ui, { showErrors = false } = {}) {
    const { step, errors } = readEnd(ui);
    ui.endConfig.classList.toggle("is-off", !ui.endEnabled.checked);
    ui.waFields.hidden = !ui.wa.checked;
    ui.contactFields.hidden = !ui.contact.checked;
    const mode = selectedMode(ui);
    ui.linkFields.hidden = mode !== "link";
    ui.formFields.hidden = mode !== "form";
    const showPhone = Boolean(errors.phone) && Boolean(showErrors || ui.waPhone.dataset.touched);
    ui.waError.hidden = !showPhone;
    if (errors.phone) ui.waError.textContent = errors.phone;
    ui.waPhone.setAttribute("aria-invalid", String(showPhone));
    ui.urlError.hidden = !(showErrors || ui.url.dataset.touched) || !errors.url;
    const project = getProject();
    const card = renderEndCard(step, {
      preview: true,
      tour: project?.name || "",
      link: "https://guiaflow.pro/p/…",
      contactForm: mode === "form",
    });
    ui.previewEnd.replaceChildren(card);
    ui.previewEnd.classList.toggle("is-off", !step.enabled);
    return { step, errors };
  }

  function paint(ui, opts) {
    return { start: paintStart(ui, opts), end: paintEnd(ui, opts) };
  }

  function fillEnd(ui, raw) {
    const base = raw ? normalizeEndStep(raw) : defaultEndStep();
    ui.endEnabled.checked = Boolean(raw) && base.enabled;
    ui.endTitle.value = base.title;
    ui.endBody.value = base.body;
    const parsed = splitWhatsAppNumber(base.whatsapp.phone);
    const savedRaw = String(raw?.whatsapp?.phone ?? "").trim();
    ui.wa.checked = base.whatsapp.enabled && Boolean(parsed || savedRaw);
    phoneField.fill(parsed);
    if (!parsed && savedRaw) ui.waPhone.value = savedRaw;
    ui.waMessage.value = base.whatsapp.message || t("fixed.end.waDefaultMessage");
    ui.waLabel.value = base.whatsapp.label;
    ui.contact.checked = base.contact.enabled;
    const mode = base.contact.mode === "form" && !ui.mode.hidden ? "form" : "link";
    for (const radio of ui.form.querySelectorAll('input[name="fixed-end-mode"]')) radio.checked = radio.value === mode;
    ui.url.value = base.contact.url.replace(/^mailto:/, "");
    if (ui.endConsent) ui.endConsent.value = base.contact.consentText || t("fixed.consentDefault");
    ui.contactLabel.value = base.contact.label;
    ui.replay.checked = base.showReplay;
    if (parsed || !savedRaw) delete ui.waPhone.dataset.touched;
    else ui.waPhone.dataset.touched = "1";
    delete ui.url.dataset.touched;
  }

  function fillStart(ui, raw) {
    const base = raw ? normalizeStartStep(raw) : defaultStartStep();
    ui.startEnabled.checked = Boolean(raw) && base.enabled;
    ui.startTitle.value = base.title;
    ui.startBody.value = base.body;
    for (const key of LEAD_FIELDS) {
      fieldBox(ui, key, "show").checked = base.fields[key].show;
      fieldBox(ui, key, "required").checked = base.fields[key].required;
    }
    ui.startConsent.value = base.consentText || t("fixed.consentDefault");
    ui.submitLabel.value = base.submitLabel;
    ui.skip.checked = base.allowSkip;
    ui.skipLabel.value = base.skipLabel;
  }

  function bind() {
    if (bound) return;
    bound = true;
    const ui = els();
    if (!ui.dialog || !ui.form) return;
    phoneField = createPhoneField(
      {
        button: ui.waCc,
        flag: ui.waCcFlag,
        dial: ui.waCcDial,
        input: ui.waPhone,
        pop: ui.waCcPop,
        search: ui.waCcSearch,
        list: ui.waCcList,
        empty: ui.waCcEmpty,
      },
      {
        locale: getLocale,
        defaultIso: () => defaultCountry(getLocale(), globalThis.navigator?.languages || [globalThis.navigator?.language]),
        onChange: () => paintEnd(ui),
        t,
      }
    );
    ui.form.addEventListener("input", (e) => {
      if (e.target === ui.waPhone || e.target === ui.waCcSearch) return;
      paint(ui);
    });
    ui.form.addEventListener("change", (e) => {
      if (e.target?.name === "fixed-end-mode" && e.target.value === "form" && !viewerIsPro()) {
        for (const radio of ui.form.querySelectorAll('input[name="fixed-end-mode"]')) radio.checked = radio.value === "link";
        paint(ui);
        openFeatureGate("contactForm");
        return;
      }
      if (e.target === ui.startEnabled && ui.startEnabled.checked && !viewerIsPro()) {
        ui.startEnabled.checked = false;
        paint(ui);
        openFeatureGate("leads");
        return;
      }
      if (e.target === ui.startEnabled && ui.startEnabled.checked && !canPermanent()) {
        ui.startEnabled.checked = false;
        paint(ui);
        onNeedsCloud?.();
        return;
      }
      paint(ui);
    });
    for (const input of [ui.waPhone, ui.url]) {
      input.addEventListener("blur", () => {
        input.dataset.touched = "1";
        paintEnd(ui);
      });
    }
    ui.tablist?.addEventListener("click", (e) => {
      const tab = e.target.closest?.("[data-capture-tab]");
      if (!tab || tab.hidden) return;
      selectTab(tabName(tab));
    });
    ui.tablist?.addEventListener("keydown", (e) => {
      if (!["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
      const tabs = tabsOf(ui).filter((tab) => !tab.hidden);
      const names = tabs.map(tabName);
      const current = tabs.find((tab) => tab.getAttribute("aria-selected") === "true");
      const name = nextCaptureTab(tabName(current), e.key, names);
      e.preventDefault();
      selectTab(name, { focus: true });
    });
    ui.dialog.querySelectorAll("[data-fixed-close]").forEach((btn) =>
      btn.addEventListener("click", () => ui.dialog.close())
    );
    ui.leads?.addEventListener("click", () => {
      ui.dialog.close();
      openLeads?.();
    });
    ui.form.addEventListener("submit", (e) => {
      e.preventDefault();
      const project = getProject();
      if (!project) return;
      const painted = paint(ui, { showErrors: true });
      const startChanged = JSON.stringify(painted.start.step) !== baseline.start;
      const endChanged = JSON.stringify(painted.end.step) !== baseline.end;
      if (!startChanged && !endChanged) {
        ui.dialog.close();
        return;
      }
      const current = tabName(tabsOf(ui).find((tab) => tab.getAttribute("aria-selected") === "true"));
      const startBad = startChanged && painted.start.step.enabled && painted.start.errors.fields;
      const endBad = endChanged && painted.end.step.enabled && (painted.end.errors.phone || painted.end.errors.url);
      if (startBad || endBad) {
        const tab = current === "end" && endBad ? "end" : startBad ? "fields" : "end";
        selectTab(tab, { focus: true });
        if (tab === "end") {
          if (painted.end.errors.phone) ui.waPhone.dataset.touched = "1";
          (painted.end.errors.phone ? ui.waPhone : ui.url).focus();
        }
        paint(ui, { showErrors: true });
        return;
      }
      if (startChanged && painted.start.step.enabled && !viewerIsPro() && project.startStep?.enabled !== true) {
        ui.startEnabled.checked = false;
        paint(ui);
        selectTab("form", { focus: true });
        openFeatureGate("leads");
        return;
      }
      if (startChanged && painted.start.step.enabled && !canPermanent() && project.startStep?.enabled !== true) {
        ui.startEnabled.checked = false;
        paint(ui);
        selectTab("form", { focus: true });
        onNeedsCloud?.();
        return;
      }
      if (startChanged) {
        if (painted.start.step.enabled && !painted.start.step.consentText) {
          painted.start.step.consentText = t("fixed.consentDefault");
        }
        project.startStep = painted.start.step;
      }
      if (endChanged) {
        if (painted.end.step.contact.mode === "form" && !painted.end.step.contact.consentText) {
          painted.end.step.contact.consentText = t("fixed.consentDefault");
        }
        project.endStep = painted.end.step;
      }
      ui.dialog.close();
      onSaved(captureSaveKind(startChanged, endChanged));
    });
  }

  function open(kind) {
    bind();
    const ui = els();
    if (!ui.dialog) return false;
    const project = getProject();
    if (!project) return false;
    fillStart(ui, project.startStep || null);
    fillEnd(ui, project.endStep || null);
    baseline = {
      start: JSON.stringify(readStart(ui).step),
      end: JSON.stringify(readEnd(ui).step),
    };
    // why: o cartão 📌 abre o diálogo já com o passo ligado, como o diálogo antigo fazia ao criar
    if (kind === "start" && !project.startStep && viewerIsPro() && canPermanent()) ui.startEnabled.checked = true;
    if (kind === "end" && !project.endStep) ui.endEnabled.checked = true;
    paint(ui);
    const tab = selectTab(captureTabForShortcut(kind), { focus: true });
    ui.dialog.showModal();
    tabsOf(ui).find((item) => tabName(item) === tab)?.focus();
    return true;
  }

  return { open, selectTab };
}
