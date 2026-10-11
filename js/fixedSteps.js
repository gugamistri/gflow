/**
 * Passos fixos do tour: início (captura de lead, Pro) e fim (CTAs).
 * Puro e testável — usado pelo editor, pelo player do /v e /p e pelos testes.
 * Os passos fixos não entram em `steps`, por isso ficam fora do vídeo e do drop-off.
 */

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

/** Número com DDI completo o bastante para o wa.me (DDI + DDD + número). */
export function isValidWhatsAppNumber(digits) {
  const value = String(digits ?? "");
  if (!/^\d{10,15}$/.test(value)) return false;
  if (value.startsWith("55")) return value.length === 12 || value.length === 13;
  return true;
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
  const digits = normalizeWhatsAppNumber(phone);
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
    whatsapp: { enabled: true, phone: "", message: "", label: "" },
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
      phone: normalizeWhatsAppNumber(wa.phone),
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
  if (step.whatsapp.enabled) {
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

/** Mesma regra do servidor: 8–15 dígitos. */
export function isValidPhone(input) {
  const d = phoneDigits(input);
  return d.length >= 10 && d.length <= 15;
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
    else if (key === "phone" && !isValidPhone(v)) errors[key] = "invalid";
    else if (key === "name" && v.length > 120) errors[key] = "invalid";
    value[key] = key === "phone" ? phoneDigits(v) : v;
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

/** CSV dos leads (UTF-8 com BOM, separador ;) — abre direto no Excel em pt-BR. */
export function leadsToCsv(leads = [], headers = {}) {
  const cols = [
    ["createdAt", headers.createdAt || "Data"],
    ["source", headers.source || "Origem"],
    ["name", headers.name || "Nome"],
    ["email", headers.email || "E-mail"],
    ["phone", headers.phone || "Telefone"],
    ["message", headers.message || "Mensagem"],
    ["consent", headers.consent || "Consentimento"],
    ["consentAt", headers.consentAt || "Consentimento em"],
    ["consentText", headers.consentText || "Texto do consentimento"],
  ];
  const rows = [cols.map(([, label]) => csvCell(label)).join(";")];
  for (const lead of leads) {
    rows.push(
      cols
        .map(([key]) => {
          if (key === "consent") return csvCell(lead.consent ? headers.yes || "sim" : headers.no || "não");
          if (key === "source") return csvCell(headers[`source_${lead.source}`] || lead.source);
          return csvCell(lead[key]);
        })
        .join(";")
    );
  }
  return `\uFEFF${rows.join("\r\n")}\r\n`;
}
