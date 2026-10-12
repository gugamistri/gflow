/**
 * Cartões dos passos fixos (início e fim) no player do /v e /p e na prévia do editor.
 * why: tudo com textContent e href validado em fixedSteps.js — nunca innerHTML com texto do autor.
 */
import { t, getLocale } from "./i18n.js";
import {
  LEAD_FIELDS,
  checkLeadPhone,
  endStepActions,
  isValidEmail,
  leadPhoneE164,
  normalizeEndStep,
  normalizeStartStep,
  validateLeadForm,
} from "./fixedSteps.js";
import { defaultCountry, parseE164 } from "./phoneCountries.js";
import { createPhoneField, phoneErrorText } from "./phoneField.js";

const WA_ICON =
  "M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.4.8 3.2.7a2.8 2.8 0 0 0 1.8-1.3 2.3 2.3 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3Z";

function el(tag, className, textContent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (textContent != null) node.textContent = textContent;
  return node;
}

function svgIcon(path) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(ns, "path");
  p.setAttribute("d", path);
  p.setAttribute("fill", "currentColor");
  svg.append(p);
  return svg;
}

export function cardShell(kind) {
  const card = el("div", `fixed-card fixed-card-${kind}`);
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "false");
  return card;
}

/**
 * Cartão final. opts: { tour, link, nome, contactForm, preview, onReplay, onContactForm, onAction }
 * Devolve o elemento (o chamador o coloca no palco).
 */
export function renderEndCard(rawStep, opts = {}) {
  const step = normalizeEndStep(rawStep);
  const card = cardShell("end");
  const title = el("h2", "fixed-card-title", step.title || t("fixed.end.defaultTitle"));
  title.id = `fixed-end-title-${opts.preview ? "preview" : "live"}`;
  card.setAttribute("aria-labelledby", title.id);
  card.append(title);
  const bodyText = step.body || t("fixed.end.defaultBody");
  if (bodyText) card.append(el("p", "fixed-card-body", bodyText));

  const actions = el("div", "fixed-card-actions");
  const list = endStepActions(step, {
    tour: opts.tour || "",
    link: opts.link || "",
    nome: opts.nome || "",
    contactForm: Boolean(opts.contactForm),
  });
  for (const action of list) {
    if (action.kind === "contact-form") {
      const btn = el("button", "btn fixed-card-btn fixed-card-contact");
      btn.type = "button";
      btn.textContent = action.label || t("fixed.end.contactLabel");
      btn.addEventListener("click", () => {
        opts.onAction?.(action);
        opts.onContactForm?.();
      });
      actions.append(btn);
      continue;
    }
    const a = el("a", `btn fixed-card-btn ${action.kind === "whatsapp" ? "fixed-card-wa" : "fixed-card-contact"}`);
    a.href = action.href;
    if (!action.href.startsWith("mailto:")) {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
    if (action.kind === "whatsapp") a.append(svgIcon(WA_ICON));
    a.append(
      el(
        "span",
        "",
        action.label || (action.kind === "whatsapp" ? t("fixed.end.waLabel") : t("fixed.end.contactLabel"))
      )
    );
    a.addEventListener("click", (event) => {
      if (opts.preview) {
        event.preventDefault();
        return;
      }
      opts.onAction?.(action);
    });
    actions.append(a);
  }
  if (actions.childElementCount) card.append(actions);

  if (step.showReplay) {
    const replay = el("button", "fixed-card-replay");
    replay.type = "button";
    replay.textContent = `↺ ${t("view.replay")}`;
    replay.addEventListener("click", () => opts.onReplay?.());
    card.append(replay);
  }
  return card;
}

let fieldSeq = 0;

function inputField({ key, label, type = "text", required = false, autocomplete = "", inputmode = "", maxLength = 200 }) {
  const id = `fixed-${key}-${++fieldSeq}`;
  const wrap = el("div", "fixed-field");
  const lab = el("label", "", label + (required ? " *" : ""));
  lab.htmlFor = id;
  const input = el(type === "textarea" ? "textarea" : "input", "fixed-input");
  input.id = id;
  input.name = key;
  if (type !== "textarea") input.type = type;
  else input.rows = 2;
  input.maxLength = maxLength;
  if (required) input.required = true;
  if (autocomplete) input.autocomplete = autocomplete;
  if (inputmode) input.inputMode = inputmode;
  const err = el("p", "fixed-field-error");
  err.id = `${id}-err`;
  err.hidden = true;
  err.setAttribute("aria-live", "polite");
  input.setAttribute("aria-describedby", err.id);
  input.addEventListener("input", () => {
    err.hidden = true;
    input.removeAttribute("aria-invalid");
  });
  wrap.append(lab, input, err);
  return { wrap, input, err };
}

function browserLanguages() {
  const nav = globalThis.navigator;
  return nav?.languages?.length ? nav.languages : [nav?.language].filter(Boolean);
}

const CHEVRON = "M3 4.5 6 7.5 9 4.5";

/**
 * Telefone internacional (mesmo componente do WhatsApp do editor): bandeira + DDI com busca,
 * número nacional formatado pelo país. defaultIso: país inicial (do WhatsApp do tour ou do idioma).
 */
function phoneInputField({ key, label, required = false, defaultIso = "" }) {
  const base = inputField({ key, label, type: "tel", required, autocomplete: "tel-national", inputmode: "tel", maxLength: 24 });
  const { wrap, input, err } = base;
  wrap.classList.add("fixed-field-phone");
  const id = input.id;
  const row = el("div", "wa-phone fixed-phone");
  const button = el("button", "wa-cc fixed-cc");
  button.type = "button";
  button.setAttribute("aria-haspopup", "listbox");
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-controls", `${id}-cc-pop`);
  const flag = el("span", "wa-cc-flag");
  flag.setAttribute("aria-hidden", "true");
  const dial = el("span", "wa-cc-dial");
  const ns = "http://www.w3.org/2000/svg";
  const chevron = document.createElementNS(ns, "svg");
  chevron.setAttribute("class", "wa-cc-chevron");
  chevron.setAttribute("viewBox", "0 0 12 12");
  chevron.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", CHEVRON);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.6");
  path.setAttribute("stroke-linecap", "round");
  chevron.append(path);
  button.append(flag, dial, chevron);
  input.replaceWith(row);
  row.append(button, input);

  const pop = el("div", "wa-cc-pop fixed-cc-pop");
  pop.id = `${id}-cc-pop`;
  pop.hidden = true;
  const search = el("input", "wa-cc-search fixed-cc-search");
  search.type = "search";
  search.autocomplete = "off";
  search.setAttribute("role", "combobox");
  search.setAttribute("aria-expanded", "true");
  search.setAttribute("aria-controls", `${id}-cc-list`);
  search.setAttribute("aria-autocomplete", "list");
  search.placeholder = t("fixed.end.waCountrySearch");
  search.setAttribute("aria-label", t("fixed.end.waCountrySearch"));
  const list = el("ul", "wa-cc-list");
  list.id = `${id}-cc-list`;
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", t("fixed.end.waCountry"));
  const empty = el("p", "wa-cc-empty", t("fixed.end.waNoCountry"));
  empty.hidden = true;
  pop.append(search, list, empty);
  row.after(pop);

  const field = createPhoneField(
    { button, flag, dial, input, pop, search, list, empty },
    {
      locale: () => getLocale(),
      defaultIso: () => defaultIso || defaultCountry(getLocale(), browserLanguages()),
      onChange: () => {
        err.hidden = true;
        input.removeAttribute("aria-invalid");
      },
      // why: no card a lista abre para cima quando não cabe embaixo (embed baixo, celular)
      onOpen: () => placeCountryList(wrap, row, pop),
      t,
    }
  );
  field.fill(null);
  return { ...base, field };
}

/**
 * Lista de países flutuando sobre o cartão: abre para baixo ou para cima (onde houver mais espaço
 * visível no palco) e encolhe a lista para caber — nunca estica o cartão nem cria rolagem.
 */
function placeCountryList(wrap, row, pop) {
  const r = row.getBoundingClientRect();
  const area = wrap.closest(".view-share-fixed, .fixed-preview, dialog")?.getBoundingClientRect();
  const top = Math.max(area?.top ?? 0, 0);
  const bottom = Math.min(area?.bottom ?? Infinity, globalThis.innerHeight || Infinity);
  const below = bottom - r.bottom - 8;
  const above = r.top - top - 8;
  const up = below < 220 && above > below;
  const room = Math.max(96, (up ? above : below) - 52);
  pop.style.setProperty("--cc-list-max", `${Math.min(196, Math.round(room))}px`);
  pop.style.top = up ? "auto" : `${row.offsetTop + row.offsetHeight + 4}px`;
  pop.style.bottom = up ? `${wrap.offsetHeight - row.offsetTop + 4}px` : "auto";
  pop.classList.toggle("is-up", up);
}

/** Valida o telefone no país escolhido; devolve "" ou a mensagem de erro. */
function phoneFieldError(phone, { required = false } = {}) {
  const raw = phone.input.value.trim();
  if (!raw) return required ? t("fixed.lead.errRequired") : "";
  const res = checkLeadPhone(raw, phone.field.country().dial);
  if (res.ok) return "";
  return phoneErrorText(res, phone.field.countryName(), t, { emptyKey: "fixed.lead.errRequired", fallbackKey: "fixed.lead.errInvalid" });
}

function consentField(textValue) {
  const id = `fixed-consent-${++fieldSeq}`;
  const wrap = el("div", "fixed-consent");
  const input = el("input");
  input.type = "checkbox";
  input.id = id;
  input.name = "consent";
  const lab = el("label", "", `${textValue} *`);
  lab.htmlFor = id;
  const err = el("p", "fixed-field-error", t("fixed.lead.errConsent"));
  err.id = `${id}-err`;
  err.hidden = true;
  err.setAttribute("aria-live", "polite");
  // why: WCAG 3.3.1/4.1.2 — o erro do consentimento precisa estar ligado à caixa
  input.required = true;
  input.setAttribute("aria-describedby", err.id);
  input.addEventListener("change", () => {
    if (input.checked) {
      err.hidden = true;
      input.removeAttribute("aria-invalid");
    }
  });
  wrap.append(input, lab, err);
  return { wrap, input, err };
}

/** why: WCAG 3.3.2 — explica o asterisco dos campos obrigatórios */
function requiredLegend() {
  return el("p", "fixed-required-legend", t("fixed.lead.requiredLegend"));
}

/** Campo-isca: invisível para pessoas; robôs que preenchem levam um "ok" falso no servidor. */
function honeypot() {
  const wrap = el("div", "fixed-hp");
  wrap.setAttribute("aria-hidden", "true");
  const input = el("input");
  input.type = "text";
  input.name = "website";
  input.tabIndex = -1;
  input.autocomplete = "off";
  wrap.append(input);
  return { wrap, input };
}

function errorText(code) {
  if (code === "required") return t("fixed.lead.errRequired");
  return t("fixed.lead.errInvalid");
}

/** Mensagem de falha do envio (429 = muitas tentativas; rede; resto). */
export function submitErrorText(result) {
  if (result?.status === 429) return t("fixed.lead.errRate");
  if (result?.status === 403) return t("fixed.lead.errOff");
  if (result?.error === "network") return t("fixed.lead.errNetwork");
  return t("fixed.lead.errGeneric");
}

/**
 * Cartão inicial (captura de lead). opts: { preview, consentText, phoneCountry, onSubmit(value) → Promise<{ok,…}>, onSkip }
 * phoneCountry: ISO do país inicial do telefone (leadPhoneDefaultIso); vazio → idioma do navegador.
 * onSubmit recebe { name, email, phone, consent: true, website } já validado.
 */
export function renderStartCard(rawStep, opts = {}) {
  const step = normalizeStartStep(rawStep);
  const card = cardShell("start");
  // why: a prévia mora dentro do <form> do diálogo do editor — form aninhado roubaria o "Salvar"
  const form = el(opts.preview ? "div" : "form", "fixed-form");
  form.noValidate = true;
  const title = el("h2", "fixed-card-title", step.title || t("fixed.start.defaultTitle"));
  title.id = `fixed-start-title-${++fieldSeq}`;
  card.setAttribute("aria-labelledby", title.id);
  form.append(title);
  const bodyText = step.body || t("fixed.start.defaultBody");
  if (bodyText) form.append(el("p", "fixed-card-body", bodyText));

  const inputs = {};
  // why: campos lado a lado quando cabem — o gate precisa caber num embed de 420px sem rolagem
  const fieldsBox = el("div", "fixed-form-fields");
  const specs = {
    name: { label: t("fixed.lead.name"), type: "text", autocomplete: "name", maxLength: 120 },
    email: { label: t("fixed.lead.email"), type: "email", autocomplete: "email", inputmode: "email", maxLength: 254 },
  };
  for (const key of LEAD_FIELDS) {
    if (!step.fields[key].show) continue;
    const field =
      key === "phone"
        ? phoneInputField({ key, label: t("fixed.lead.phone"), required: step.fields[key].required, defaultIso: opts.phoneCountry })
        : inputField({ key, required: step.fields[key].required, ...specs[key] });
    inputs[key] = field;
    fieldsBox.append(field.wrap);
  }
  form.append(requiredLegend());
  if (fieldsBox.childElementCount) form.append(fieldsBox);
  const consent = consentField(opts.consentText || step.consentText || t("fixed.consentDefault"));
  form.append(consent.wrap);
  const hp = honeypot();
  form.append(hp.wrap);

  const status = el("p", "fixed-form-status");
  status.setAttribute("role", "status");
  status.hidden = true;
  form.append(status);

  const actions = el("div", "fixed-card-actions");
  const submit = el("button", "btn fixed-card-btn", step.submitLabel || t("fixed.start.submit"));
  submit.type = opts.preview ? "button" : "submit";
  actions.classList.add("fixed-form-actions");
  actions.append(submit);
  if (step.allowSkip) {
    const skip = el("button", "fixed-card-replay fixed-card-skip", step.skipLabel || t("fixed.start.skip"));
    skip.type = "button";
    skip.addEventListener("click", () => {
      if (!opts.preview) opts.onSkip?.();
    });
    actions.append(skip);
  }
  form.append(actions);
  form.append(el("p", "fixed-privacy", t("fixed.lead.privacyNote")));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (opts.preview) return;
    const values = { consent: consent.input.checked };
    for (const [key, field] of Object.entries(inputs)) values[key] = field.input.value;
    if (inputs.phone) values.phoneDial = inputs.phone.field.country().dial;
    const result = validateLeadForm(values, step);
    let first = null;
    for (const [key, field] of Object.entries(inputs)) {
      const code = result.errors[key];
      field.err.hidden = !code;
      field.err.textContent =
        code === "invalid" && key === "phone" ? phoneFieldError(field) || errorText(code) : code ? errorText(code) : "";
      field.input.setAttribute("aria-invalid", code ? "true" : "false");
      if (code && !first) first = field.input;
    }
    consent.err.hidden = !result.errors.consent;
    if (result.errors.consent) consent.input.setAttribute("aria-invalid", "true");
    else consent.input.removeAttribute("aria-invalid");
    if (result.errors.consent && !first) first = consent.input;
    if (!result.ok) {
      first?.focus();
      return;
    }
    submit.disabled = true;
    status.hidden = false;
    status.textContent = t("fixed.lead.sending");
    const res = await opts.onSubmit?.({ ...result.value, consent: true, website: hp.input.value });
    if (res?.ok) return;
    submit.disabled = false;
    status.textContent = submitErrorText(res);
  });
  card.append(form);
  return card;
}

/**
 * Formulário de contato do cartão final (vai para o e-mail da conta do autor, nunca para outro destino).
 * opts: { consentText, onSubmit(value) → Promise<{ok}>, onDone, onCancel, prefill: {name,email,phone} }
 */
export function renderContactForm(opts = {}) {
  const form = el("form", "fixed-form fixed-contact-form");
  form.noValidate = true;
  form.append(el("h3", "fixed-form-title", t("fixed.contact.title")));
  const name = inputField({ key: "name", label: t("fixed.lead.name"), required: true, autocomplete: "name", maxLength: 120 });
  const email = inputField({ key: "email", label: t("fixed.lead.email"), type: "email", required: true, autocomplete: "email", inputmode: "email", maxLength: 254 });
  const phone = phoneInputField({ key: "phone", label: t("fixed.lead.phoneOptional"), defaultIso: opts.phoneCountry });
  const message = inputField({ key: "message", label: t("fixed.contact.message"), type: "textarea", required: true, maxLength: 2000 });
  if (opts.prefill?.name) name.input.value = opts.prefill.name;
  if (opts.prefill?.email) email.input.value = opts.prefill.email;
  if (opts.prefill?.phone) {
    const parsed = parseE164(leadPhoneE164(opts.prefill.phone));
    if (parsed) phone.field.fill(parsed);
  }
  const consent = consentField(opts.consentText || t("fixed.consentDefault"));
  const hp = honeypot();
  const status = el("p", "fixed-form-status");
  status.setAttribute("role", "status");
  status.hidden = true;
  const actions = el("div", "fixed-card-actions");
  const submit = el("button", "btn fixed-card-btn", t("fixed.contact.send"));
  submit.type = "submit";
  const cancel = el("button", "fixed-card-replay", t("fixed.contact.back"));
  cancel.type = "button";
  cancel.addEventListener("click", () => opts.onCancel?.());
  actions.classList.add("fixed-form-actions");
  actions.append(submit, cancel);
  const fieldsBox = el("div", "fixed-form-fields");
  fieldsBox.append(name.wrap, email.wrap, phone.wrap);
  form.append(requiredLegend(), fieldsBox, message.wrap, consent.wrap, hp.wrap, status, actions);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const checks = [
      [name, name.input.value.trim() ? "" : "required"],
      [email, !email.input.value.trim() ? "required" : isValidEmail(email.input.value) ? "" : "invalid"],
      [phone, phoneFieldError(phone) ? "phone" : ""],
      [message, message.input.value.trim() ? "" : "required"],
    ];
    let first = null;
    for (const [field, code] of checks) {
      field.err.hidden = !code;
      field.err.textContent = code === "phone" ? phoneFieldError(field) : code ? errorText(code) : "";
      field.input.setAttribute("aria-invalid", code ? "true" : "false");
      if (code && !first) first = field.input;
    }
    consent.err.hidden = consent.input.checked;
    if (!consent.input.checked) consent.input.setAttribute("aria-invalid", "true");
    else consent.input.removeAttribute("aria-invalid");
    if (!consent.input.checked && !first) first = consent.input;
    if (first) {
      first.focus();
      return;
    }
    submit.disabled = true;
    status.hidden = false;
    status.textContent = t("fixed.lead.sending");
    const res = await opts.onSubmit?.({
      name: name.input.value.trim(),
      email: email.input.value.trim(),
      // why: E.164 ("+5511…") no país escolhido — o mesmo formato do passo inicial e do servidor
      phone: phone.input.value.trim() ? checkLeadPhone(phone.input.value, phone.field.country().dial).e164 : "",
      message: message.input.value.trim(),
      consent: true,
      website: hp.input.value,
    });
    if (res?.ok) {
      const done = el("div", "fixed-form-done");
      done.setAttribute("role", "status");
      done.append(el("strong", "", t("fixed.contact.sentTitle")), el("p", "", t("fixed.contact.sentBody")));
      const back = el("button", "fixed-card-replay", t("fixed.contact.back"));
      back.type = "button";
      back.addEventListener("click", () => opts.onCancel?.());
      done.append(back);
      form.replaceChildren(done);
      back.focus({ preventScroll: true });
      opts.onDone?.();
      return;
    }
    submit.disabled = false;
    status.textContent = submitErrorText(res);
  });
  return form;
}
