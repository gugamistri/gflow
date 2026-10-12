import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAgentStepInput,
  checkTourForPublish,
  endStepFromAgentInput,
  rectToUnit,
  startStepFromAgentInput,
  stepForAgent,
  themeFromAgentInput,
} from "./index.js";

test("coordenadas 0..1 viram % e o clique fica dentro do destaque", () => {
  const r = applyAgentStepInput({ title: "Clique em Salvar", text: "Salva o pedido.", highlight: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 }, click: { x: 0.95, y: 0.9 } });
  assert.equal(r.ok, true);
  assert.deepEqual(r.step.hotspot, { x: 10, y: 20, w: 30, h: 10 });
  assert.deepEqual(r.step.clickPoint, { x: 39, y: 29 });
  assert.equal(r.step.popover.title, "Clique em Salvar");
  assert.equal(r.step.label, "Clique em Salvar");
  assert.match(r.warnings.join(" "), /movido para dentro/);
});

test("só clique: destaque automático em volta, sem passar da borda", () => {
  const r = applyAgentStepInput({ click: { x: 0.99, y: 0.01 } });
  assert.deepEqual(r.step.hotspot, { x: 86, y: 0, w: 14, h: 8 });
  assert.ok(r.step.clickPoint.x <= 99 && r.step.clickPoint.y >= 1);
});

test("erros legíveis para coordenadas em pixels e tipos errados", () => {
  const r = applyAgentStepInput({ highlight: { x: 120, y: 30, width: 200, height: 40 }, type: "video" });
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors.map((e) => e.field).sort(), ["highlight", "type"]);
  assert.match(r.errors.find((e) => e.field === "highlight").message, /entre 0 e 1/);
});

test("update mantém campos não enviados e stepForAgent devolve 0..1", () => {
  const base = applyAgentStepInput({ title: "A", highlight: { x: 0.5, y: 0.5, width: 0.2, height: 0.2 } }).step;
  base.id = "s1";
  const r = applyAgentStepInput({ text: "novo" }, base);
  assert.equal(r.step.popover.title, "A");
  assert.equal(r.step.popover.description, "novo");
  const view = stepForAgent(r.step, 0);
  assert.deepEqual(view.highlight, { x: 0.5, y: 0.5, width: 0.2, height: 0.2 });
  assert.deepEqual(rectToUnit(r.step.hotspot), view.highlight);
});

test("tema por preset, cores inválidas explicam o formato", () => {
  assert.equal(themeFromAgentInput({ preset: "documento" }).theme.presetId, "documento");
  const bad = themeFromAgentInput({ colors: { accent: "red", nope: "#000000" } });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors.length, 2);
  assert.equal(themeFromAgentInput({ colors: { accent: "#112233" } }).theme.accent, "#112233");
});

test("passo inicial e final (WhatsApp E.164)", () => {
  const start = startStepFromAgentInput({ title: "Antes de ver", fields: { phone: "optional" } });
  assert.equal(start.step.enabled, true);
  assert.deepEqual(start.step.fields.phone, { show: true, required: false });
  const end = endStepFromAgentInput({ title: "Fale com a gente", whatsapp: { phone: "+55 11 99999-8888", message: "Oi" } });
  assert.equal(end.ok, true);
  assert.equal(end.step.whatsapp.phone, "5511999998888");
  assert.equal(endStepFromAgentInput({ whatsapp: { phone: "123" } }).ok, false);
});

test("publicar exige passos com imagem", () => {
  const step = applyAgentStepInput({ title: "x" }).step;
  const res = checkTourForPublish({ steps: [step] });
  assert.equal(res.ok, false);
  assert.match(res.errors[0].message, /sem imagem/);
  assert.equal(checkTourForPublish({ steps: [{ ...step, image: "custom:a" }] }).ok, true);
  assert.equal(checkTourForPublish({ steps: [] }).ok, false);
});
