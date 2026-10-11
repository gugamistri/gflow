/**
 * Diálogos dos passos fixos no editor (cartões 📌 Início/Fim da filmstrip).
 * O rascunho só vai para o projeto em "Salvar" — um passo de histórico por edição.
 */
import { t } from "./i18n.js";
import {
  defaultEndStep,
  formatBrPhone,
  isValidWhatsAppNumber,
  normalizeEndStep,
  normalizeWhatsAppNumber,
  safeContactHref,
} from "./fixedSteps.js";
import { renderEndCard } from "./fixedStepsView.js";

const $ = (id) => document.getElementById(id);

function displayPhone(digits) {
  const d = String(digits || "");
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) return formatBrPhone(d.slice(2));
  return d ? `+${d}` : "";
}

export function createFixedStepsEditor(ctx) {
  const { getProject, onSaved, viewerIsPro, openFeatureGate } = ctx;
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
    const phone = normalizeWhatsAppNumber(els.waPhone.value);
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
    const errors = {
      phone: els.wa.checked && Boolean(els.waPhone.value.trim()) && !isValidWhatsAppNumber(phone),
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
    els.waError.hidden = !(showErrors || els.waPhone.dataset.touched) || !errors.phone;
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
    els.wa.checked = base.whatsapp.enabled;
    els.waPhone.value = displayPhone(base.whatsapp.phone);
    els.waMessage.value = base.whatsapp.message || t("fixed.end.waDefaultMessage");
    els.waLabel.value = base.whatsapp.label;
    els.contact.checked = base.contact.enabled;
    const mode = base.contact.mode === "form" && !els.mode.hidden ? "form" : "link";
    for (const radio of els.form.querySelectorAll('input[name="fixed-end-mode"]')) radio.checked = radio.value === mode;
    els.url.value = base.contact.url.replace(/^mailto:/, "");
    if (els.consent) els.consent.value = base.contact.consentText || t("fixed.consentDefault");
    els.contactLabel.value = base.contact.label;
    els.replay.checked = base.showReplay;
    delete els.waPhone.dataset.touched;
    delete els.url.dataset.touched;
  }

  function bind() {
    if (bound) return;
    bound = true;
    const els = endEls();
    if (!els.dialog) return;
    els.form.addEventListener("input", (e) => {
      if (e.target === els.waPhone && !els.waPhone.value.trim().startsWith("+")) {
        const atEnd = els.waPhone.selectionStart === els.waPhone.value.length;
        const masked = formatBrPhone(els.waPhone.value);
        if (atEnd && masked !== els.waPhone.value) els.waPhone.value = masked;
      }
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
        (errors.phone ? els.waPhone : els.url).focus();
        return;
      }
      const project = getProject();
      if (!project) return;
      project.endStep = step;
      els.dialog.close();
      onSaved("end");
    });
  }

  function open(kind) {
    bind();
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
