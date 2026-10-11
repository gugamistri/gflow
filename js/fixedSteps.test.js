import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWhatsAppUrl,
  csvCell,
  endStepActions,
  endStepActive,
  fixedStepsForPayload,
  formatBrPhone,
  interpolate,
  isValidWhatsAppNumber,
  leadsToCsv,
  normalizeEndStep,
  normalizeStartStep,
  normalizeWhatsAppNumber,
  safeContactHref,
  safeHttpUrl,
  startStepActive,
  validateLeadForm,
} from "./fixedSteps.js";

test("normalizeWhatsAppNumber: números BR com e sem 9, com 0 e com +55", () => {
  assert.equal(normalizeWhatsAppNumber("(11) 99999-8888"), "5511999998888");
  assert.equal(normalizeWhatsAppNumber("11 3333-4444"), "551133334444");
  assert.equal(normalizeWhatsAppNumber("011 99999-8888"), "5511999998888");
  assert.equal(normalizeWhatsAppNumber("+55 11 99999-8888"), "5511999998888");
  assert.equal(normalizeWhatsAppNumber("5511999998888"), "5511999998888");
  assert.equal(normalizeWhatsAppNumber("0055 11 99999 8888"), "5511999998888");
  assert.equal(normalizeWhatsAppNumber("+1 (415) 555-0100"), "14155550100");
  assert.equal(normalizeWhatsAppNumber(""), "");
  assert.equal(normalizeWhatsAppNumber("abc"), "");
  assert.equal(isValidWhatsAppNumber("5511999998888"), true);
  assert.equal(isValidWhatsAppNumber("55119999"), false);
  assert.equal(isValidWhatsAppNumber("14155550100"), true);
});

test("buildWhatsAppUrl: critério de aceite do PRD", () => {
  const url = buildWhatsAppUrl({
    phone: "(11) 99999-8888",
    message: 'Oi! Vi o tour "{tour}" e quero saber mais.',
    vars: { tour: "Como emitir nota" },
  });
  assert.ok(url.startsWith("https://wa.me/5511999998888?text=Oi!%20Vi%20o%20tour%20"));
  assert.ok(decodeURIComponent(url).includes('"Como emitir nota"'));
  assert.equal(buildWhatsAppUrl({ phone: "", message: "Oi" }), "https://wa.me/?text=Oi");
  assert.equal(buildWhatsAppUrl({ phone: "123", message: "" }), "https://wa.me/");
  const long = buildWhatsAppUrl({ phone: "", message: "a".repeat(900) });
  assert.equal(decodeURIComponent(long.split("text=")[1]).length, 500);
});

test("interpolate: {tour} {link} {nome}; vazio some", () => {
  assert.equal(interpolate("Oi, sou {nome}. Vi {tour} em {link}", { tour: "T", link: "https://x", nome: "Ana" }), "Oi, sou Ana. Vi T em https://x");
  assert.equal(interpolate("Oi {nome}, tudo bem?", {}), "Oi, tudo bem?");
  assert.equal(interpolate("{TOUR}", { tour: "X" }), "X");
});

test("safeHttpUrl / safeContactHref rejeitam javascript: e data:", () => {
  assert.equal(safeHttpUrl("javascript:alert(1)"), "");
  assert.equal(safeHttpUrl("data:text/html,x"), "");
  assert.equal(safeHttpUrl("https://cal.com/empresa"), "https://cal.com/empresa");
  assert.equal(safeHttpUrl("https://user:pw@x.com"), "");
  assert.equal(safeContactHref("JavaScript:alert(1)"), "");
  assert.equal(safeContactHref("contato@empresa.com"), "mailto:contato@empresa.com");
  assert.equal(safeContactHref("mailto:a@b.co?subject=Oi tour&cc=x@y.z"), "mailto:a@b.co?subject=Oi%20tour");
  assert.equal(safeContactHref("https://empresa.com/contato"), "https://empresa.com/contato");
  assert.equal(safeContactHref("mailto:not-an-email"), "");
});

test("normalizeEndStep/StartStep: limpa, limita e preserva padrões", () => {
  const end = normalizeEndStep({
    enabled: true,
    title: "x".repeat(200),
    whatsapp: { phone: "(21) 98888-7777", message: "Oi" },
    contact: { enabled: true, mode: "form", url: "javascript:1" },
  });
  assert.equal(end.title.length, 80);
  assert.equal(end.whatsapp.phone, "5521988887777");
  assert.equal(end.contact.mode, "form");
  assert.equal(end.contact.url, "");
  assert.equal(end.showReplay, true);
  const start = normalizeStartStep({ enabled: true, fields: { phone: { show: true, required: true }, name: { show: false, required: true } } });
  assert.deepEqual(start.fields.name, { show: false, required: false });
  assert.deepEqual(start.fields.phone, { show: true, required: true });
  assert.equal(start.fields.email.show, true);
  assert.equal(startStepActive({ enabled: true, fields: { name: { show: false }, email: { show: false }, phone: { show: false } } }), false);
  assert.equal(startStepActive({ enabled: true }), true);
  assert.equal(endStepActive({ enabled: false }), false);
});

test("fixedStepsForPayload: só entra quando ligado (hash de links antigos estável)", () => {
  assert.deepEqual(fixedStepsForPayload({}), {});
  assert.deepEqual(fixedStepsForPayload({ endStep: { enabled: false } }), {});
  const out = fixedStepsForPayload({ endStep: { enabled: true }, startStep: { enabled: true } });
  assert.equal(out.endStep.enabled, true);
  assert.equal(out.startStep.enabled, true);
});

test("endStepActions: WhatsApp, link e formulário só com o recurso ativo no servidor", () => {
  const raw = {
    enabled: true,
    whatsapp: { enabled: true, phone: "11999998888", message: "Oi {nome}, vi {tour}" },
    contact: { enabled: true, mode: "link", url: "https://cal.com/x" },
  };
  const acts = endStepActions(raw, { tour: "T", nome: "Bia" });
  assert.equal(acts[0].kind, "whatsapp");
  assert.equal(acts[0].href, "https://wa.me/5511999998888?text=Oi%20Bia%2C%20vi%20T");
  assert.equal(acts[1].kind, "contact-link");
  const form = { ...raw, contact: { enabled: true, mode: "form" } };
  assert.equal(endStepActions(form, {}).length, 1);
  assert.equal(endStepActions(form, { contactForm: true })[1].kind, "contact-form");
  const bad = { enabled: true, whatsapp: { enabled: false }, contact: { enabled: true, mode: "link", url: "javascript:x" } };
  assert.deepEqual(endStepActions(bad), []);
});

test("formatBrPhone: máscara BR", () => {
  assert.equal(formatBrPhone("11999998888"), "(11) 99999-8888");
  assert.equal(formatBrPhone("1133334444"), "(11) 3333-4444");
  assert.equal(formatBrPhone("119"), "(11) 9");
  assert.equal(formatBrPhone("1"), "(1");
  assert.equal(formatBrPhone("+1 415 555"), "+1415555");
  assert.equal(formatBrPhone(""), "");
});

test("validateLeadForm: obrigatórios, formato e consentimento", () => {
  const cfg = { enabled: true, fields: { name: { show: true, required: true }, email: { show: true, required: true }, phone: { show: true, required: false } } };
  let r = validateLeadForm({ name: "", email: "x", consent: false }, cfg);
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, { name: "required", email: "invalid", consent: "consent" });
  r = validateLeadForm({ name: "Ana", email: "ana@x.com", phone: "(11) 99999-8888", consent: true }, cfg);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { name: "Ana", email: "ana@x.com", phone: "11999998888" });
  r = validateLeadForm({ name: "Ana", email: "ana@x.com", phone: "123", consent: true }, cfg);
  assert.equal(r.errors.phone, "invalid");
});

test("leadsToCsv: BOM, ; e proteção contra fórmula", () => {
  assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(csvCell("+5511"), "'+5511");
  assert.equal(csvCell('a;"b"'), '"a;""b"""');
  const csv = leadsToCsv([{ createdAt: "2026-10-11T10:00:00Z", source: "start", name: "@Ana", email: "a@b.co", phone: "11999998888", consent: true, consentAt: "x", consentText: "Aceito" }], { source_start: "Início" });
  assert.ok(csv.startsWith("\uFEFFData;Origem;Nome"));
  assert.ok(csv.includes(";Início;'@Ana;a@b.co;11999998888;;sim;x;Aceito"));
});
