import assert from "node:assert/strict";
import test from "node:test";
import {
  COUNTRIES,
  browserRegion,
  countryByIso,
  countryOptions,
  defaultCountry,
  filterCountries,
  flagEmoji,
  formatNational,
  isValidE164Digits,
  nationalDigits,
  parseE164,
  validatePhone,
} from "./phoneCountries.js";

test("lista de países: todos com ISO único, DDI e bandeira", () => {
  assert.ok(COUNTRIES.length > 200);
  assert.equal(new Set(COUNTRIES.map((c) => c.iso)).size, COUNTRIES.length);
  for (const c of COUNTRIES) {
    assert.match(c.iso, /^[A-Z]{2}$/);
    assert.match(c.dial, /^[1-9]\d{0,2}$/);
  }
  assert.equal(flagEmoji("BR"), "🇧🇷");
  assert.equal(flagEmoji("pt"), "🇵🇹");
  assert.equal(countryByIso("ar").dial, "54");
});

test("país padrão: pt → Brasil, es pela região do navegador, en → +1", () => {
  assert.equal(defaultCountry("pt", ["pt-BR"]), "BR");
  assert.equal(defaultCountry("pt", ["pt-PT"]), "PT");
  assert.equal(defaultCountry("pt", []), "BR");
  assert.equal(defaultCountry("es", ["es-AR", "es"]), "AR");
  assert.equal(defaultCountry("es", ["es-MX"]), "MX");
  assert.equal(defaultCountry("es", ["es"]), "ES");
  assert.equal(defaultCountry("en", ["en-US"]), "US");
  assert.equal(defaultCountry("en", ["en-GB"]), "GB");
  assert.equal(defaultCountry("en", ["en"]), "US");
  assert.equal(browserRegion(["es-419", "es-AR"]), "AR");
});

test("busca de país: nome sem acento, ISO e DDI; quem começa com o termo vem antes", () => {
  const options = countryOptions("pt");
  assert.equal(options[0].iso, "BR");
  assert.equal(filterCountries(options, "bra")[0].iso, "BR");
  assert.ok(filterCountries(options, "mexico").some((c) => c.iso === "MX"));
  assert.ok(filterCountries(options, "+351").some((c) => c.iso === "PT"));
  assert.equal(filterCountries(options, "54")[0].iso, "AR");
  assert.deepEqual(filterCountries(options, "zzzz"), []);
  assert.equal(filterCountries(options, "").length, options.length);
});

test("validação: Brasil exige DDD + 8/9 dígitos; outros países pelo tamanho; total 8–15", () => {
  assert.deepEqual(validatePhone("55", "11999998888"), { ok: true, error: "", digits: "5511999998888" });
  assert.equal(validatePhone("55", "1133334444").ok, true);
  assert.equal(validatePhone("55", "").error, "empty");
  assert.equal(validatePhone("55", "119999").error, "length");
  assert.equal(validatePhone("55", "10999998888").error, "ddd");
  assert.equal(validatePhone("55", "11899998888").error, "length");
  assert.equal(validatePhone("1", "4155550100").ok, true);
  assert.equal(validatePhone("1", "1155550100").ok, false);
  assert.equal(validatePhone("351", "912345678").ok, true);
  assert.equal(validatePhone("351", "91234567").error, "length");
  assert.equal(validatePhone("34", "612345678").ok, true);
  assert.equal(validatePhone("54", "91123456789").ok, true);
  assert.equal(validatePhone("44", "7911123456").ok, true);
  assert.equal(validatePhone("999", "12345678").error, "country");
  assert.equal(validatePhone("49", "1".repeat(14)).error, "length");
  assert.equal(isValidE164Digits("5511999998888"), true);
  assert.equal(isValidE164Digits("+5511999998888"), true);
  assert.equal(isValidE164Digits("551199999888"), false);
});

test("parse E.164 e número nacional", () => {
  assert.deepEqual(parseE164("+5511999998888"), { iso: "BR", dial: "55", national: "11999998888" });
  assert.deepEqual(parseE164("14155550100"), { iso: "US", dial: "1", national: "4155550100" });
  assert.equal(parseE164("351912345678").iso, "PT");
  assert.equal(parseE164("447911123456").iso, "GB");
  assert.equal(parseE164(""), null);
  assert.equal(nationalDigits("(011) 99999-8888", "55"), "11999998888");
  assert.equal(nationalDigits("07911 123456", "44"), "7911123456");
});

test("formatação leve do número nacional", () => {
  assert.equal(formatNational("55", "11999998888"), "(11) 99999-8888");
  assert.equal(formatNational("55", "1133334444"), "(11) 3333-4444");
  assert.equal(formatNational("1", "4155550100"), "(415) 555-0100");
  assert.equal(formatNational("55", ""), "");
});
