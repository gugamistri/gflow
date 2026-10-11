/**
 * Diálogos dos passos fixos no editor (cartões 📌 Início/Fim da filmstrip).
 * O rascunho só vai para o projeto em "Salvar" — um passo de histórico por edição.
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

function phoneErrorText(result, countryName) {
  return sharedPhoneErrorText(result, countryName, t);
}

export function createFixedStepsEditor(ctx) {
  const { getProject, onSaved, viewerIsPro, openFeatureGate, openLeads } = ctx;
  let bound = false;

  function endEls() {
    return {
      dialog: $("modal-fixed-end"),
      form: $("fixed-end-form"),
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

  function selectedMode(els) {
    const checked = els.form.querySelector('input[name="fixed-end-mode"]:checked');
    return checked?.value === "form" && !els.mode.hidden ? "form" : "link";
  }

  /** Lê o formulário; errors marca campos inválidos (não salva com erro). */
  function readEnd(els) {
    const phoneResult = phoneField.read();
    const phone = phoneResult.ok ? phoneResult.digits : "";
    const rawUrl = els.url.value.trim();
    const mode = selectedMode(els);
    const step = normalizeEndStep({
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
    });
    // why: o botão de WhatsApp só pode ser ligado/salvo com um número válido do país escolhido
    const errors = {
      phone: els.wa.checked && !phoneResult.ok ? phoneErrorText(phoneResult, phoneField.countryName()) : "",
      url: els.contact.checked && mode === "link" && !safeContactHref(rawUrl),
    };
    return { step, errors };
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

  function fillEnd(els, raw) {
    const base = raw ? normalizeEndStep(raw) : defaultEndStep();
    els.enabled.checked = raw ? base.enabled : true;
    els.title.value = base.title;
    els.body.value = base.body;
    const parsed = splitWhatsAppNumber(base.whatsapp.phone);
    const savedRaw = String(raw?.whatsapp?.phone ?? "").trim();
    // why: ligado sem número (padrão antigo) vira desligado; número salvo inválido aparece com o erro
    els.wa.checked = base.whatsapp.enabled && Boolean(parsed || savedRaw);
    phoneField.fill(parsed);
    if (!parsed && savedRaw) els.waPhone.value = savedRaw;
    els.waMessage.value = base.whatsapp.message || t("fixed.end.waDefaultMessage");
    els.waLabel.value = base.whatsapp.label;
    els.contact.checked = base.contact.enabled;
    const mode = base.contact.mode === "form" && !els.mode.hidden ? "form" : "link";
    for (const radio of els.form.querySelectorAll('input[name="fixed-end-mode"]')) radio.checked = radio.value === mode;
    els.url.value = base.contact.url.replace(/^mailto:/, "");
    if (els.consent) els.consent.value = base.contact.consentText || t("fixed.consentDefault");
    els.contactLabel.value = base.contact.label;
    els.replay.checked = base.showReplay;
    if (parsed || !savedRaw) delete els.waPhone.dataset.touched;
    else els.waPhone.dataset.touched = "1";
    delete els.url.dataset.touched;
  }

  let phoneField = null;

  function bind() {
    if (bound) return;
    bound = true;
    const els = endEls();
    if (!els.dialog) return;
    phoneField = createPhoneField(
      {
        button: els.waCc,
        flag: els.waCcFlag,
        dial: els.waCcDial,
        input: els.waPhone,
        pop: els.waCcPop,
        search: els.waCcSearch,
        list: els.waCcList,
        empty: els.waCcEmpty,
      },
      {
        locale: getLocale,
        defaultIso: () => defaultCountry(getLocale(), globalThis.navigator?.languages || [globalThis.navigator?.language]),
        onChange: () => paintEnd(els),
        t,
      }
    );
    els.form.addEventListener("input", (e) => {
      if (e.target === els.waPhone || e.target === els.waCcSearch) return; // o campo repinta sozinho
      paintEnd(els);
    });
    els.form.addEventListener("change", (e) => {
      if (e.target?.name === "fixed-end-mode" && e.target.value === "form" && !viewerIsPro()) {
        for (const radio of els.form.querySelectorAll('input[name="fixed-end-mode"]')) radio.checked = radio.value === "link";
        paintEnd(els);
        els.dialog.close();
        openFeatureGate("contactForm");
        return;
      }
      paintEnd(els);
    });
    for (const input of [els.waPhone, els.url]) {
      input.addEventListener("blur", () => {
        input.dataset.touched = "1";
        paintEnd(els);
      });
    }
    els.dialog.querySelectorAll("[data-fixed-close]").forEach((btn) =>
      btn.addEventListener("click", () => els.dialog.close())
    );
    els.form.addEventListener("submit", (e) => {
      e.preventDefault();
      const { step, errors } = paintEnd(els, { showErrors: true });
      if (step.enabled && (errors.phone || errors.url)) {
        if (errors.phone) els.waPhone.dataset.touched = "1";
        (errors.phone ? els.waPhone : els.url).focus();
        return;
      }
      const project = getProject();
      if (!project) return;
      if (step.contact.mode === "form" && !step.contact.consentText) step.contact.consentText = t("fixed.consentDefault");
      project.endStep = step;
      els.dialog.close();
      onSaved("end");
    });
  }

  function startEls() {
    return {
      dialog: $("modal-fixed-start"),
      form: $("fixed-start-form"),
      enabled: $("fixed-start-enabled"),
      config: $("fixed-start-config"),
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

  function fieldBox(els, key, prop) {
    return els.fields.querySelector(`input[data-field="${key}"][data-prop="${prop}"]`);
  }

  function readStart(els) {
    const fields = {};
    for (const key of LEAD_FIELDS) {
      const show = fieldBox(els, key, "show").checked;
      fields[key] = { show, required: show && fieldBox(els, key, "required").checked };
    }
    const step = normalizeStartStep({
      enabled: els.enabled.checked,
      title: els.title.value,
      body: els.body.value,
      fields,
      consentText: els.consent.value.trim(),
      allowSkip: els.skip.checked,
      submitLabel: els.submit.value,
      skipLabel: els.skipLabel.value,
    });
    const errors = { fields: !LEAD_FIELDS.some((key) => step.fields[key].show) };
    return { step, errors };
  }

  function paintStart(els, { showErrors = false } = {}) {
    const { step, errors } = readStart(els);
    els.config.classList.toggle("is-off", !els.enabled.checked);
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

  function fillStart(els, raw) {
    const base = raw ? normalizeStartStep(raw) : defaultStartStep();
    els.enabled.checked = raw ? base.enabled : true;
    els.title.value = base.title;
    els.body.value = base.body;
    for (const key of LEAD_FIELDS) {
      fieldBox(els, key, "show").checked = base.fields[key].show;
      fieldBox(els, key, "required").checked = base.fields[key].required;
    }
    els.consent.value = base.consentText || t("fixed.consentDefault");
    els.submit.value = base.submitLabel;
    els.skip.checked = base.allowSkip;
    els.skipLabel.value = base.skipLabel;
  }

  let startBound = false;
  function bindStart() {
    if (startBound) return;
    startBound = true;
    const els = startEls();
    if (!els.dialog) return;
    els.form.addEventListener("input", () => paintStart(els));
    els.form.addEventListener("change", () => paintStart(els));
    els.dialog.querySelectorAll("[data-fixed-close]").forEach((btn) =>
      btn.addEventListener("click", () => els.dialog.close())
    );
    els.leads?.addEventListener("click", () => {
      els.dialog.close();
      openLeads?.();
    });
    els.form.addEventListener("submit", (e) => {
      e.preventDefault();
      const { step, errors } = paintStart(els, { showErrors: true });
      if (step.enabled && errors.fields) return;
      const project = getProject();
      if (!project) return;
      // why: o servidor grava o texto publicado como prova do aceite — nunca deixar vazio
      if (!step.consentText) step.consentText = t("fixed.consentDefault");
      project.startStep = step;
      els.dialog.close();
      onSaved("start");
    });
  }

  function open(kind) {
    bind();
    if (kind === "start") {
      if (!viewerIsPro()) {
        openFeatureGate("leads");
        return false;
      }
      bindStart();
      const els = startEls();
      if (!els.dialog) return false;
      fillStart(els, getProject()?.startStep || null);
      paintStart(els);
      els.dialog.showModal();
      return true;
    }
    if (kind !== "end") return false;
    const els = endEls();
    if (!els.dialog) return false;
    fillEnd(els, getProject()?.endStep || null);
    paintEnd(els);
    els.dialog.showModal();
    return true;
  }

  return { open };
}
