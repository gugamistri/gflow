/**
 * Passos fixos do tour: início (captura de lead, Pro) e fim (CTAs).
 * Puro e testável — usado pelo editor, pelo player do /v e /p e pelos testes.
 * Os passos fixos não entram em `steps`, por isso ficam fora do vídeo e do drop-off.
 */

import {
  countryByIso,
  defaultCountry,
  formatNational,
  isValidE164Digits,
  nationalDigits,
  parseE164,
  validatePhone,
} from "./phoneCountries.js";

export const LEAD_FIELDS = ["name", "email", "phone"];

export const LIMITS = {
  title: 80,
  body: 280,
  label: 40,
  message: 500,
  consent: 600,
  url: 2000,
};

function text(value, max) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .slice(0, max);
}

function line(value, max) {
  return text(value, max).replace(/[\r\n]+/g, " ");
}

// why: traduções do passo fixo (PRD multi-idioma §7); i18n.js normaliza o conteúdo
function keepI18n(raw) {
  return raw.i18n && typeof raw.i18n === "object" && !Array.isArray(raw.i18n) && Object.keys(raw.i18n).length
    ? { i18n: raw.i18n }
    : {};
}

function bool(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

/** Só dígitos; tira zeros à esquerda (0xx do DDD) e aplica o DDI padrão a números BR. */
export function normalizeWhatsAppNumber(input, defaultDdi = "55") {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  const international = raw.startsWith("+") || raw.startsWith("00");
  let digits = raw.replace(/\D/g, "");
  if (raw.startsWith("00")) digits = digits.replace(/^00/, "");
  digits = digits.replace(/^0+/, "");
  if (!digits) return "";
  if (!international) {
    const ddi = String(defaultDdi || "").replace(/\D/g, "");
    // why: 10–11 dígitos = DDD + número no Brasil; com o DDI já digitado fica como está
    if (ddi && (digits.length === 10 || digits.length === 11)) digits = ddi + digits;
  }
  return digits.slice(0, 15);
}

/**
 * Número E.164 (só dígitos: DDI + número) válido para o wa.me — DDI conhecido e tamanho do país
 * (Brasil: DDD + 8 ou 9 dígitos; EUA/Canadá: 10; demais: 6–13, até 15 no total).
 */
export function isValidWhatsAppNumber(digits) {
  const value = String(digits ?? "");
  if (!/^\d{8,15}$/.test(value)) return false;
  return isValidE164Digits(value);
}

/**
 * Número salvo → E.164 só com dígitos. Com "+"/"00" ou já um E.164 válido, fica como está;
 * senão, a regra antiga (DDD + número do Brasil ganha o 55). Inválido → "".
 */
export function whatsAppE164(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  const international = /^(\+|00)/.test(raw);
  const digits = raw.replace(/\D/g, "").replace(international ? /^00/ : /^$/, "");
  if (!international) {
    // why: 10–11 dígitos sem DDI = DDD + número do Brasil (como o campo antigo gravava)
    const legacy = normalizeWhatsAppNumber(raw);
    if (legacy !== digits && isValidWhatsAppNumber(legacy)) return legacy;
  }
  return isValidWhatsAppNumber(digits) ? digits : "";
}

/** País + número nacional de um número salvo (para o editor). */
export function splitWhatsAppNumber(input) {
  const digits = whatsAppE164(input);
  const parsed = digits ? parseE164(digits) : null;
  return parsed && validatePhone(parsed.dial, parsed.national).ok ? parsed : null;
}

/** Troca {tour}, {link} e {nome}; variável vazia some sem deixar o marcador. */
export function interpolate(template, vars = {}) {
  const map = {
    tour: vars.tour,
    link: vars.link,
    nome: vars.nome ?? vars.name,
    name: vars.nome ?? vars.name,
    nombre: vars.nome ?? vars.name,
  };
  return String(template ?? "")
    .replace(/\{(tour|link|nome|name|nombre)\}/gi, (_m, key) => String(map[key.toLowerCase()] ?? "").trim())
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([,.!?;:])/g, "$1")
    .trim();
}

/** https://wa.me/<digitos>?text=… — sem número, o visitante escolhe o contato. */
export function buildWhatsAppUrl({ phone = "", message = "", vars = {} } = {}) {
  const digits = whatsAppE164(phone);
  const body = interpolate(message, vars).slice(0, LIMITS.message);
  const base = isValidWhatsAppNumber(digits) ? `https://wa.me/${digits}` : "https://wa.me/";
  return body ? `${base}?text=${encodeURIComponent(body)}` : base;
}

/** Só http(s) com host; javascript:, data: e afins viram "". */
export function safeHttpUrl(input) {
  const raw = String(input ?? "").trim();
  if (!raw || raw.length > LIMITS.url || /\s/.test(raw)) return "";
  let url;
  try {
    url = new URL(raw);
  } catch {
    return "";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "";
  if (!url.hostname || url.username || url.password) return "";
  return url.href;
}

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

export function isValidEmail(value) {
  const email = String(value ?? "").trim();
  return email.length <= 254 && EMAIL_RE.test(email);
}

/** Link do botão de contato: http(s) ou mailto:endereço (aceita só o e-mail). */
export function safeContactHref(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  const mail = raw.replace(/^mailto:/i, "");
  if (!/^https?:/i.test(raw) && isValidEmail(mail.split("?")[0])) {
    const [address, query = ""] = mail.split("?");
    const params = new URLSearchParams(query);
    const keep = new URLSearchParams();
    for (const key of ["subject", "body"]) {
      const value = params.get(key);
      if (value) keep.set(key, value.slice(0, LIMITS.message));
    }
    const qs = keep.toString().replace(/\+/g, "%20");
    return `mailto:${address.trim()}${qs ? `?${qs}` : ""}`;
  }
  return safeHttpUrl(raw);
}

export function defaultStartStep() {
  return {
    enabled: false,
    title: "",
    body: "",
    fields: {
      name: { show: true, required: true },
      email: { show: true, required: true },
      phone: { show: false, required: false },
    },
    consentText: "",
    allowSkip: true,
    submitLabel: "",
    skipLabel: "",
  };
}

export function defaultEndStep() {
  return {
    enabled: false,
    title: "",
    body: "",
    // why: o botão só existe com um número válido — começa desligado até o autor informar o número
    whatsapp: { enabled: false, phone: "", message: "", label: "" },
    contact: { enabled: false, mode: "link", url: "", label: "", consentText: "" },
    showReplay: true,
  };
}

export function normalizeStartStep(raw) {
  const base = defaultStartStep();
  if (!raw || typeof raw !== "object") return base;
  const fields = {};
  for (const key of LEAD_FIELDS) {
    const src = raw.fields?.[key] || {};
    const show = bool(src.show, base.fields[key].show);
    fields[key] = { show, required: show && bool(src.required, base.fields[key].required) };
  }
  return {
    enabled: raw.enabled === true,
    title: line(raw.title, LIMITS.title),
    body: text(raw.body, LIMITS.body),
    fields,
    consentText: text(raw.consentText, LIMITS.consent),
    allowSkip: bool(raw.allowSkip, true),
    submitLabel: line(raw.submitLabel, LIMITS.label),
    skipLabel: line(raw.skipLabel, LIMITS.label),
    ...keepI18n(raw),
  };
}

export function normalizeEndStep(raw) {
  const base = defaultEndStep();
  if (!raw || typeof raw !== "object") return base;
  const wa = raw.whatsapp || {};
  const contact = raw.contact || {};
  return {
    enabled: raw.enabled === true,
    title: line(raw.title, LIMITS.title),
    body: text(raw.body, LIMITS.body),
    whatsapp: {
      enabled: bool(wa.enabled, true),
      phone: whatsAppE164(wa.phone),
      message: text(wa.message, LIMITS.message),
      label: line(wa.label, LIMITS.label),
    },
    contact: {
      enabled: contact.enabled === true,
      mode: contact.mode === "form" ? "form" : "link",
      url: safeContactHref(contact.url),
      label: line(contact.label, LIMITS.label),
      consentText: text(contact.consentText, LIMITS.consent),
    },
    showReplay: bool(raw.showReplay, true),
    ...keepI18n(raw),
  };
}

/** Passo inicial que de fato pede algo (ligado e com ao menos um campo visível). */
export function startStepActive(raw) {
  if (!raw || raw.enabled !== true) return false;
  const step = normalizeStartStep(raw);
  return LEAD_FIELDS.some((key) => step.fields[key].show);
}

/** Passo final ligado — mesmo sem botões mostra título/texto e "Ver novamente". */
export function endStepActive(raw) {
  return Boolean(raw && raw.enabled === true);
}

/** Recorte para o payload: só entra quando ligado, para não mudar o hash de links antigos. */
export function fixedStepsForPayload(project) {
  const out = {};
  if (project?.startStep?.enabled === true) out.startStep = normalizeStartStep(project.startStep);
  if (project?.endStep?.enabled === true) out.endStep = normalizeEndStep(project.endStep);
  return out;
}

/** Ações do cartão final, já validadas (o render só cria <a>/<button> com isto). */
export function endStepActions(raw, { tour = "", link = "", nome = "", contactForm = false } = {}) {
  const step = normalizeEndStep(raw);
  const actions = [];
  // why: sem número válido não há botão (tours antigos publicados sem número ou com número incompleto)
  if (step.whatsapp.enabled && isValidWhatsAppNumber(step.whatsapp.phone)) {
    actions.push({
      kind: "whatsapp",
      label: step.whatsapp.label,
      href: buildWhatsAppUrl({ phone: step.whatsapp.phone, message: step.whatsapp.message, vars: { tour, link, nome } }),
    });
  }
  if (step.contact.enabled) {
    if (step.contact.mode === "form") {
      if (contactForm) actions.push({ kind: "contact-form", label: step.contact.label });
    } else if (step.contact.url) {
      actions.push({ kind: "contact-link", label: step.contact.label, href: step.contact.url });
    }
  }
  return actions;
}

/** Maior passo aceito no "botão do WhatsApp a partir do passo N" (o tour tem bem menos que isso). */
export const STICKY_WHATSAPP_MAX_STEP = 999;

/**
 * Passo (1 = primeiro passo do tour) a partir do qual o player mostra o botão fixo do WhatsApp.
 * Fica em `playback.stickyWhatsAppFromStep`; ausente, 0 ou inválido = desligado (comportamento antigo).
 * why: playback viaja inteiro no payload (editor, sync, colaboração e snapshot do Cloud copiam o objeto),
 * então o campo novo não some ao publicar — e tours sem ele mantêm o mesmo hash.
 */
export function stickyWhatsAppFromStep(playback) {
  const raw = playback && typeof playback === "object" ? playback.stickyWhatsAppFromStep : undefined;
  if (typeof raw === "boolean" || raw === null || raw === "") return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 0;
  return Math.min(STICKY_WHATSAPP_MAX_STEP, Math.floor(n));
}

/** Grava (ou apaga, com 0) o passo do botão fixo, sem tocar no resto do playback. */
export function setStickyWhatsAppFromStep(playback, fromStep) {
  const out = playback && typeof playback === "object" ? { ...playback } : {};
  const n = stickyWhatsAppFromStep({ stickyWhatsAppFromStep: fromStep });
  if (n) out.stickyWhatsAppFromStep = n;
  else delete out.stickyWhatsAppFromStep;
  return out;
}

/**
 * Botão fixo do WhatsApp no passo `stepIndex` (0 = primeiro) do tour, ou null.
 * Usa o número, a mensagem e o texto do botão do passo final — e só existe com o passo final ligado
 * e um número válido (a mesma regra do botão do cartão final).
 */
export function stickyWhatsAppAction(demo, stepIndex, vars = {}) {
  const from = stickyWhatsAppFromStep(demo?.playback);
  if (!from) return null;
  const i = Number(stepIndex);
  if (!Number.isInteger(i) || i < 0) return null;
  if (i + 1 < from) return null;
  if (!endStepActive(demo?.endStep)) return null;
  const wa = endStepActions(demo.endStep, { tour: vars.tour, link: vars.link, nome: vars.nome }).find((a) => a.kind === "whatsapp");
  return wa ? { kind: "whatsapp", label: wa.label, href: wa.href, sticky: true } : null;
}

/** Máscara BR: (11) 99999-8888 / (11) 3333-4444; com +, deixa os dígitos livres. */
export function formatBrPhone(input) {
  const raw = String(input ?? "");
  if (raw.trim().startsWith("+")) return `+${raw.replace(/\D/g, "").slice(0, 15)}`;
  const d = raw.replace(/\D/g, "").slice(0, 11);
  if (!d) return "";
  if (d.length <= 2) return `(${d}`;
  const ddd = d.slice(0, 2);
  const rest = d.slice(2);
  if (rest.length <= 4) return `(${ddd}) ${rest}`;
  if (d.length <= 10) return `(${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
  return `(${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
}

export function phoneDigits(input) {
  return String(input ?? "").replace(/\D/g, "");
}

/** Mesma regra do servidor: E.164 com 8–15 dígitos (DDI incluso). */
export function isValidPhone(input) {
  return /^\+?[1-9]\d{7,14}$/.test(String(input ?? "").replace(/[\s().-]/g, ""));
}

/**
 * País padrão do telefone do lead: o do WhatsApp (ou tel:) do passo final; senão o do idioma
 * do navegador (mesmo mapeamento do campo do WhatsApp no editor).
 */
export function leadPhoneDefaultIso(endStep, locale = "pt", languages = []) {
  const wa = endStep && typeof endStep === "object" ? endStep.whatsapp : null;
  const fromWa = wa?.phone ? splitWhatsAppNumber(wa.phone) : null;
  if (fromWa) return fromWa.iso;
  const url = String(endStep?.contact?.url || "").trim();
  if (/^tel:/i.test(url)) {
    const tel = decodeURIComponent(url.slice(4));
    const parsed = /^(\+|00)/.test(tel.trim()) ? parseE164(tel.trim().replace(/^00/, "")) : null;
    if (parsed && validatePhone(parsed.dial, parsed.national).ok) return parsed.iso;
  }
  return defaultCountry(locale, languages);
}

/**
 * Telefone do visitante → { ok, e164: "+5511…", error, min, max }.
 * Com "+"/"00" o DDI digitado manda; senão vale o país escolhido (dial).
 */
export function checkLeadPhone(raw, dial) {
  const value = String(raw ?? "").trim();
  if (!value) return { ok: false, error: "empty", e164: "" };
  const typed = /^(\+|00)/.test(value) ? parseE164(value.replace(/^00/, "")) : null;
  const code = typed ? typed.dial : String(dial ?? "");
  const national = typed ? typed.national : nationalDigits(value, code);
  const res = validatePhone(code, national);
  return res.ok ? { ok: true, error: "", e164: `+${res.digits}` } : { ...res, e164: "" };
}

/**
 * Telefone salvo de um lead → E.164 com "+". Leads antigos vieram só com dígitos:
 * 10–11 dígitos eram DDD + número do Brasil (a máscara era só BR); o resto já trazia o DDI.
 */
export function leadPhoneE164(stored) {
  const raw = String(stored ?? "").trim();
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (raw.startsWith("+")) return `+${digits}`;
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  return `+${digits}`;
}

/** "+5511999998888" → "+55 (11) 99999-8888" (para a lista de contatos). */
export function formatLeadPhone(stored) {
  const e164 = leadPhoneE164(stored);
  const parsed = e164 ? parseE164(e164) : null;
  if (!parsed) return e164;
  return `+${parsed.dial} ${formatNational(parsed.dial, parsed.national)}`.trim();
}

/** Coluna "formatado" do CSV: começa pelo país ("BR +55 (11) 99999-8888") — texto no Excel, sem fórmula. */
function csvPhoneFormatted(stored) {
  const e164 = leadPhoneE164(stored);
  const parsed = e164 ? parseE164(e164) : null;
  if (!parsed || !countryByIso(parsed.iso)) return "";
  return `${parsed.iso} ${formatLeadPhone(e164)}`;
}

/**
 * Valida o formulário do passo inicial antes de enviar.
 * Devolve { ok, errors: {campo: "required"|"invalid"|"consent"}, value }.
 */
export function validateLeadForm(values = {}, raw) {
  const step = normalizeStartStep(raw);
  const errors = {};
  const value = {};
  for (const key of LEAD_FIELDS) {
    const cfg = step.fields[key];
    if (!cfg.show) continue;
    const v = String(values[key] ?? "").trim();
    if (!v) {
      if (cfg.required) errors[key] = "required";
      continue;
    }
    if (key === "email" && !isValidEmail(v)) errors[key] = "invalid";
    else if (key === "name" && v.length > 120) errors[key] = "invalid";
    if (key === "phone") {
      // why: valida pelo país escolhido (values.phoneDial) e grava E.164 ("+5511…"), como o servidor
      const phone = checkLeadPhone(v, values.phoneDial || "55");
      if (!phone.ok) errors.phone = "invalid";
      value.phone = phone.e164 || v;
      continue;
    }
    value[key] = v;
  }
  if (values.consent !== true) errors.consent = "consent";
  return { ok: Object.keys(errors).length === 0, errors, value };
}

/** Célula CSV segura: aspas, e prefixo ' contra fórmula no Excel/Sheets. */
export function csvCell(value) {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[";\n\r,]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

const CONTEXT_COLS = new Set(["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "referrer", "embed", "device"]);

// why: lead antigo (sem contexto) sai com as colunas vazias, sem "não" inventado
function contextCell(key, context, headers) {
  if (!context || typeof context !== "object") return "";
  if (key === "embed") return context.embed ? headers.yes || "sim" : headers.no || "não";
  if (key === "referrer") return context.referrer || context.referrerHost || "";
  if (key === "device") return context.device ? headers[`device_${context.device}`] || context.device : "";
  return context[key] || "";
}

/** CSV dos leads (UTF-8 com BOM, separador ;) — abre direto no Excel em pt-BR. Inclui o contexto de captura (UTM, referrer, embed, dispositivo). */
export function leadsToCsv(leads = [], headers = {}) {
  const cols = [
    ["createdAt", headers.createdAt || "Data"],
    ["source", headers.source || "Origem"],
    ["name", headers.name || "Nome"],
    ["email", headers.email || "E-mail"],
    ["phone", headers.phone || "Telefone"],
    ["phoneFormatted", headers.phoneFormatted || "Telefone (formatado)"],
    ["message", headers.message || "Mensagem"],
    ["consent", headers.consent || "Consentimento"],
    ["consentAt", headers.consentAt || "Consentimento em"],
    ["consentText", headers.consentText || "Texto do consentimento"],
    ["lang", headers.lang || "Idioma"],
    ["utm_source", "utm_source"],
    ["utm_medium", "utm_medium"],
    ["utm_campaign", "utm_campaign"],
    ["utm_term", "utm_term"],
    ["utm_content", "utm_content"],
    ["referrer", "referrer"],
    ["embed", "embed"],
    ["device", headers.device || "dispositivo"],
  ];
  const rows = [cols.map(([, label]) => csvCell(label)).join(";")];
  for (const lead of leads) {
    rows.push(
      cols
        .map(([key]) => {
          if (key === "consent") return csvCell(lead.consent ? headers.yes || "sim" : headers.no || "não");
          if (key === "source") return csvCell(headers[`source_${lead.source}`] || lead.source);
          if (key === "phone") return csvCell(leadPhoneE164(lead.phone));
          if (key === "phoneFormatted") return csvCell(csvPhoneFormatted(lead.phone));
          if (CONTEXT_COLS.has(key)) return csvCell(contextCell(key, lead.context, headers));
          return csvCell(lead[key]);
        })
        .join(";")
    );
  }
  return `\uFEFF${rows.join("\r\n")}\r\n`;
}
