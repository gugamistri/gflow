import assert from "node:assert/strict";
import test from "node:test";
import {
  STICKY_WHATSAPP_MAX_STEP,
  endStepActions,
  fixedStepsForPayload,
  normalizeEndStep,
  setStickyWhatsAppFromStep,
  stickyWhatsAppAction,
  stickyWhatsAppFromStep,
} from "./tour-schema/fixedSteps.js";
import { projectToDemoPayload, demoPayloadToProject } from "./projects.js";
import { hashSharePayload } from "./shareLink.js";
import { publicTourTitle } from "./viewShare.js";

const endStep = {
  enabled: true,
  title: "Quer a planta?",
  body: "",
  whatsapp: { enabled: true, phone: "5511987654321", message: 'Oi! Vi o tour "{tour}" ({link}). Sou {nome}.', label: "Falar com o corretor" },
  contact: { enabled: false },
  showReplay: true,
};

function tourWith(playback, extra = {}) {
  return {
    name: "Meu tour",
    steps: Array.from({ length: 12 }, (_, i) => ({ id: `s${i + 1}`, type: "screen", popover: { title: `Passo ${i + 1}` } })),
    playback,
    endStep,
    ...extra,
  };
}

test("stickyWhatsAppFromStep: ausente, 0 e lixo = desligado; número vira passo inteiro", () => {
  for (const v of [undefined, null, "", 0, -3, "abc", NaN, true, false, {}, []]) {
    assert.equal(stickyWhatsAppFromStep({ stickyWhatsAppFromStep: v }), 0, String(v));
  }
  assert.equal(stickyWhatsAppFromStep(undefined), 0);
  assert.equal(stickyWhatsAppFromStep({}), 0);
  assert.equal(stickyWhatsAppFromStep({ stickyWhatsAppFromStep: 6 }), 6);
  assert.equal(stickyWhatsAppFromStep({ stickyWhatsAppFromStep: "6" }), 6);
  assert.equal(stickyWhatsAppFromStep({ stickyWhatsAppFromStep: 6.9 }), 6);
  assert.equal(stickyWhatsAppFromStep({ stickyWhatsAppFromStep: 1e9 }), STICKY_WHATSAPP_MAX_STEP);
});

test("setStickyWhatsAppFromStep grava sem mexer no resto do playback e apaga com 0", () => {
  const pb = { defaultHoldSeconds: 7 };
  const on = setStickyWhatsAppFromStep(pb, 6);
  assert.deepEqual(on, { defaultHoldSeconds: 7, stickyWhatsAppFromStep: 6 });
  assert.deepEqual(pb, { defaultHoldSeconds: 7 }, "não muda o objeto de entrada");
  assert.deepEqual(setStickyWhatsAppFromStep(on, 0), { defaultHoldSeconds: 7 });
  assert.deepEqual(setStickyWhatsAppFromStep(undefined, "x"), {});
});

test("botão fixo aparece só do passo N em diante (N = 6, plantas)", () => {
  const demo = tourWith({ defaultHoldSeconds: 6, stickyWhatsAppFromStep: 6 });
  const visible = demo.steps.map((_, i) => Boolean(stickyWhatsAppAction(demo, i)));
  assert.deepEqual(visible, [false, false, false, false, false, true, true, true, true, true, true, true]);
});

test("sem o campo (tours antigos) o botão nunca aparece", () => {
  const demo = tourWith({ defaultHoldSeconds: 6 });
  assert.ok(demo.steps.every((_, i) => stickyWhatsAppAction(demo, i) === null));
});

test("o botão fixo usa o número, a mensagem e o texto do passo final (mesmo href do cartão)", () => {
  const demo = tourWith({ stickyWhatsAppFromStep: 1 });
  const vars = { tour: "Meu Plano&Interlagos", link: "https://guiaflow.pro/p/x", nome: "Ana" };
  const sticky = stickyWhatsAppAction(demo, 0, vars);
  const card = endStepActions(demo.endStep, vars).find((a) => a.kind === "whatsapp");
  assert.equal(sticky.href, card.href);
  assert.equal(sticky.label, "Falar com o corretor");
  assert.ok(sticky.href.startsWith("https://wa.me/5511987654321?text="));
  assert.match(decodeURIComponent(sticky.href), /Meu Plano&Interlagos/);
});

test("sem passo final ligado, sem WhatsApp ou com número inválido: nada de botão", () => {
  const pb = { stickyWhatsAppFromStep: 1 };
  assert.equal(stickyWhatsAppAction(tourWith(pb, { endStep: { ...endStep, enabled: false } }), 3), null);
  assert.equal(stickyWhatsAppAction(tourWith(pb, { endStep: undefined }), 3), null);
  assert.equal(stickyWhatsAppAction(tourWith(pb, { endStep: { ...endStep, whatsapp: { ...endStep.whatsapp, enabled: false } } }), 3), null);
  assert.equal(stickyWhatsAppAction(tourWith(pb, { endStep: { ...endStep, whatsapp: { ...endStep.whatsapp, phone: "55119" } } }), 3), null);
  assert.equal(stickyWhatsAppAction(tourWith(pb), -1), null);
  assert.equal(stickyWhatsAppAction(tourWith(pb), 1.5), null);
});

test("passo N maior que o tour: não aparece (e não quebra)", () => {
  const demo = tourWith({ stickyWhatsAppFromStep: 40 });
  assert.ok(demo.steps.every((_, i) => stickyWhatsAppAction(demo, i) === null));
});

// ---- compatibilidade do formato ----

test("schema: o campo mora no playback e o passo final não ganha chave nova", () => {
  assert.deepEqual(Object.keys(normalizeEndStep(endStep)).sort(), ["body", "contact", "enabled", "showReplay", "title", "whatsapp"]);
  assert.deepEqual(Object.keys(normalizeEndStep(endStep).whatsapp).sort(), ["enabled", "label", "message", "phone"]);
  assert.deepEqual(fixedStepsForPayload({ endStep }), { endStep: normalizeEndStep(endStep) });
});

test("schema: projectToDemoPayload/demoPayloadToProject levam o campo e tours antigos não mudam", () => {
  const base = { id: "p1", name: "Tour", theme: {}, steps: [], sceneLabels: {}, narration: { enabled: true, voiceURI: "", rate: 1, background: null }, endStep };
  const old = projectToDemoPayload({ ...base, playback: { defaultHoldSeconds: 6 } });
  assert.equal("stickyWhatsAppFromStep" in old.playback, false);
  const on = projectToDemoPayload({ ...base, playback: { defaultHoldSeconds: 6, stickyWhatsAppFromStep: 6 } });
  assert.equal(on.playback.stickyWhatsAppFromStep, 6);
  const back = demoPayloadToProject(on);
  assert.equal(stickyWhatsAppFromStep(back.playback), 6);
  assert.equal(back.playback.defaultHoldSeconds, 6);
});

test("schema: o hash do link não muda para quem não usa o botão (e muda ao ligar — o link fica desatualizado)", () => {
  const base = { id: "p1", name: "Tour", theme: {}, steps: [], sceneLabels: {}, narration: { enabled: true, voiceURI: "", rate: 1, background: null }, endStep };
  const before = hashSharePayload({ ...base, playback: { defaultHoldSeconds: 6 } });
  const offAgain = hashSharePayload({ ...base, playback: setStickyWhatsAppFromStep(setStickyWhatsAppFromStep({ defaultHoldSeconds: 6 }, 6), 0) });
  assert.equal(offAgain, before);
  const on = hashSharePayload({ ...base, playback: setStickyWhatsAppFromStep({ defaultHoldSeconds: 6 }, 6) });
  assert.notEqual(on, before);
});

test("schema: o snapshot do Cloud (cópia do playback) mantém o campo", () => {
  // espelho de guiaflow-cloud apps/api/src/lib/tour-service.js buildSnapshot (publicar pelo agente/MCP):
  // playback: p.playback && typeof p.playback === 'object' ? { ...p.playback } : { defaultHoldSeconds: 6 }
  const p = { playback: { defaultHoldSeconds: 6, stickyWhatsAppFromStep: 6 }, endStep };
  const snapshot = {
    playback: p.playback && typeof p.playback === "object" ? { ...p.playback } : { defaultHoldSeconds: 6 },
    ...fixedStepsForPayload(p),
  };
  assert.equal(stickyWhatsAppAction({ ...snapshot, steps: new Array(12).fill({}) }, 5) !== null, true);
});

test("publicTourTitle: no /p vale o título do link; com texto traduzido, o nome traduzido", () => {
  assert.equal(publicTourTitle({ shareTitle: "Meu Plano&Interlagos", name: "[TESTE] Interno", sourceName: "[TESTE] Interno" }), "Meu Plano&Interlagos");
  assert.equal(publicTourTitle({ shareTitle: "Meu Plano&Interlagos", name: "My Plano tour", sourceName: "[TESTE] Interno" }), "My Plano tour");
  assert.equal(publicTourTitle({ shareTitle: "", name: "Tour", sourceName: "Tour" }), "Tour");
  assert.equal(publicTourTitle({ shareTitle: "  ", name: " Tour ", sourceName: "Tour" }), "Tour");
  assert.equal(publicTourTitle({}), "");
});
