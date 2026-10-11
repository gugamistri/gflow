import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  checkLeadPhone,
  formatLeadPhone,
  isValidPhone,
  leadPhoneDefaultIso,
  leadPhoneE164,
  leadsToCsv,
  validateLeadForm,
} from "./fixedSteps.js";

const cfg = { enabled: true, fields: { name: { show: true, required: true }, email: { show: false }, phone: { show: true, required: true } } };

test("número dos EUA sem + no país EUA vira +1…, não máscara BR", () => {
  const r = validateLeadForm({ name: "Bob", phone: "415 555 0100", phoneDial: "1", consent: true }, cfg);
  assert.equal(r.ok, true);
  assert.equal(r.value.phone, "+14155550100");
  // why: no Brasil os mesmos dígitos são um fixo de Curitiba — por isso o país vem do tour/idioma e é visível
  assert.equal(checkLeadPhone("415 555 0100", "55").e164, "+554155550100");
  // com o país certo por padrão (WhatsApp do tour nos EUA) o visitante não precisa digitar +1
  const dial = leadPhoneDefaultIso({ whatsapp: { phone: "14155550199" } }, "pt", ["pt-BR"]) === "US" ? "1" : "55";
  assert.equal(checkLeadPhone("415 555 0100", dial).e164, "+14155550100");
});

test("validação por país (mesmas regras do WhatsApp do editor)", () => {
  assert.deepEqual(checkLeadPhone("(11) 99999-8888", "55"), { ok: true, error: "", e164: "+5511999998888" });
  assert.equal(checkLeadPhone("912 345 678", "351").e164, "+351912345678");
  assert.equal(checkLeadPhone("91234567", "351").ok, false);
  assert.equal(checkLeadPhone("91234567", "351").error, "length");
  assert.equal(checkLeadPhone("(01) 99999-8888", "55").ok, false);
  // DDI digitado manda sobre o país escolhido
  assert.equal(checkLeadPhone("+44 20 7946 0958", "55").e164, "+442079460958");
  assert.equal(checkLeadPhone("0044 20 7946 0958", "55").e164, "+442079460958");
  assert.equal(checkLeadPhone("", "55").error, "empty");
});

test("cliente e servidor: E.164 com 8–15 dígitos", () => {
  for (const ok of ["+12345678", "+5511999998888", "+123456789012345"]) assert.equal(isValidPhone(ok), true, ok);
  for (const bad of ["+1234567", "+1234567890123456", "+0123456789", "abc"]) assert.equal(isValidPhone(bad), false, bad);
  // tudo que o formulário aceita cabe na regra do servidor
  for (const [raw, dial] of [["(11) 99999-8888", "55"], ["415 555 0100", "1"], ["912345678", "351"], ["2079460958", "44"]]) {
    const r = checkLeadPhone(raw, dial);
    assert.equal(r.ok, true, raw);
    assert.match(r.e164, /^\+[1-9]\d{7,14}$/);
  }
});

test("país padrão: WhatsApp do passo final, depois tel:, depois idioma do navegador", () => {
  assert.equal(leadPhoneDefaultIso({ whatsapp: { phone: "14155550100" } }, "pt", ["pt-BR"]), "US");
  assert.equal(leadPhoneDefaultIso({ whatsapp: { phone: "351912345678" } }, "pt", ["pt-BR"]), "PT");
  assert.equal(leadPhoneDefaultIso({ whatsapp: { phone: "" }, contact: { url: "tel:+34612345678" } }, "pt", ["pt-BR"]), "ES");
  assert.equal(leadPhoneDefaultIso({ whatsapp: { phone: "123" } }, "pt", ["pt-BR"]), "BR", "número inválido não manda");
  assert.equal(leadPhoneDefaultIso(null, "pt", ["pt-BR"]), "BR");
  assert.equal(leadPhoneDefaultIso(undefined, "es", ["es-AR"]), "AR");
  assert.equal(leadPhoneDefaultIso(undefined, "en", ["en-GB"]), "GB");
  assert.equal(leadPhoneDefaultIso(undefined, "en", ["en-US"]), "US");
});

test("leads antigos (só dígitos) e novos (E.164) na lista e no CSV", () => {
  assert.equal(leadPhoneE164("11999998888"), "+5511999998888");
  assert.equal(leadPhoneE164("14155550100"), "+5514155550100");
  assert.equal(leadPhoneE164("351912345678"), "+351912345678");
  assert.equal(leadPhoneE164("+14155550100"), "+14155550100");
  assert.equal(leadPhoneE164(""), "");
  assert.equal(formatLeadPhone("+14155550100"), "+1 (415) 555-0100");
  assert.equal(formatLeadPhone("+5511999998888"), "+55 (11) 99999-8888");
  const csv = leadsToCsv([{ source: "start", name: "Bob", phone: "+14155550100", consent: true }], {});
  assert.ok(csv.includes("Telefone;Telefone (formatado)"));
  assert.ok(csv.includes(";'+14155550100;US +1 (415) 555-0100;"), csv);
});

test("cartões usam o campo internacional (sem máscara só BR) e o tema do balão", () => {
  const view = readFileSync(new URL("./fixedStepsView.js", import.meta.url), "utf8");
  assert.doesNotMatch(view, /formatBrPhone|attachPhoneMask/);
  assert.match(view, /createPhoneField\(/);
  assert.match(view, /phoneInputField\(\{ key, label: t\("fixed\.lead\.phone"\)/);
  assert.match(view, /phoneInputField\(\{ key: "phone", label: t\("fixed\.lead\.phoneOptional"\)/);
  const css = readFileSync(new URL("../css/app.css", import.meta.url), "utf8");
  const cc = css.match(/\.fixed-card \.fixed-cc \{[^}]*\}/)?.[0] || "";
  assert.match(cc, /var\(--demo-field-bg/);
  assert.match(cc, /var\(--demo-field-border/);
  const pop = css.match(/\.fixed-card \.fixed-cc-pop \{[^}]*\}/)?.[0] || "";
  assert.match(pop, /position: absolute/, "lista flutua: não estica o cartão nem cria rolagem");
  assert.match(pop, /var\(--demo-popover-bg/);
  const app = readFileSync(new URL("./viewApp.js", import.meta.url), "utf8");
  assert.match(app, /phoneCountry: leadPhoneCountry\(\)/);
});
