import test from "node:test";
import assert from "node:assert/strict";
import { addLang, fieldStatus, setTranslation, translatableFields } from "./i18n.js";
import { applyTranslations, batchItems, buildTranslateMessages, hostedTranslateRequest, parseTranslateResult, translationItems } from "./translate.js";

const tour = () => {
  const p = { name: "Demo", steps: [{ id: "s1", popover: { title: "Olá {nome}", description: "Veja https://x.com" }, caption: "Fala" }], endStep: { enabled: true, title: "Fim", whatsapp: { message: "Oi {nome}" } } };
  addLang(p, "en");
  return p;
};

test("items skip reviewed unless overwrite (RF7)", () => {
  const p = tour();
  setTranslation(p, { id: "s1", field: "title", lang: "en", text: "Hello {nome}" });
  const ids = translationItems(p, "en").map((i) => i.id);
  assert.ok(!ids.includes("step:s1:title"));
  assert.ok(ids.includes("end:end:whatsapp.message"));
  assert.ok(translationItems(p, "en", { overwriteReviewed: true }).some((i) => i.id === "step:s1:title"));
});

test("prompt carries glossary, tone and ids", () => {
  const msgs = buildTranslateMessages({ items: [{ id: "a", text: "x", max: 80 }], source: "pt-BR", target: "es", glossary: ["GuiaFlow"], tone: "formal" });
  assert.match(msgs[0].content, /GuiaFlow/);
  assert.match(msgs[0].content, /usted/);
  assert.equal(JSON.parse(msgs[1].content).items[0].id, "a");
});

test("parse validates vars and limits; apply marks auto", () => {
  const p = tour();
  const items = translationItems(p, "en");
  const raw = "```json\n" + JSON.stringify({ "step:s1:title": "Hello {name}", "step:s1:description": "See https://x.com", "step:s1:caption": "Speech", "end:end:title": "End", bogus: "x" }) + "\n```";
  const r = parseTranslateResult(raw, items);
  assert.ok(r.rejected.includes("step:s1:title"));
  assert.ok(r.rejected.includes("end:end:whatsapp.message"));
  assert.equal(r.reasons["step:s1:title"], "vars");
  assert.equal(r.reasons["end:end:whatsapp.message"], "missing");
  assert.equal(parseTranslateResult("nope", items).reasons["step:s1:title"], "invalid_json");
  assert.equal(r.translations["step:s1:description"], "See https://x.com");
  assert.equal(applyTranslations(p, "en", r.translations), 3);
  const f = translatableFields(p).find((x) => x.key === "end:end:title");
  assert.equal(fieldStatus(p, f, "en"), "auto");
  assert.deepEqual(hostedTranslateRequest(p, "en").items.map((i) => i.id), ["step:s1:title", "end:end:whatsapp.message", "project:project:name"]);
});

test("batches by size", () => {
  const items = Array.from({ length: 5 }, (_, i) => ({ id: String(i), text: "x".repeat(100), max: 280 }));
  assert.equal(batchItems(items, 250).length, 3);
});

test("parseTranslateResult: aceita o pedido ecoado ({ tour, items: [{ id, text }] }) e listas", () => {
  const items = [{ id: "step:s1:title", text: "Olá", max: 80 }, { id: "project:project:name", text: "Tour", max: 120 }];
  const echo = JSON.stringify({ tour: "Tour", items: [{ id: "step:s1:title", max: 80, text: "Hello" }, { id: "project:project:name", text: "Tour EN" }] });
  const r = parseTranslateResult(echo, items);
  assert.equal(r.translations["step:s1:title"], "Hello");
  assert.equal(r.translations["project:project:name"], "Tour EN");
  assert.deepEqual(r.rejected, []);
  const list = parseTranslateResult({ translations: [{ id: "step:s1:title", translation: "Hi" }] }, items);
  assert.equal(list.translations["step:s1:title"], "Hi");
  assert.deepEqual(list.rejected, ["project:project:name"]);
  const arr = parseTranslateResult([{ id: "step:s1:title", text: "Hey" }], items);
  assert.equal(arr.translations["step:s1:title"], "Hey");
});
