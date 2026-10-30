import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PLAYBACK_MODE,
  PLAYBACK_MODES,
  defaultModeForTemplate,
  displayForAgent,
  displayFromAgentInput,
  isGalleryMode,
  parsePlaybackMode,
  playbackMode,
  setPlaybackMode,
} from "./playbackMode.js";
import * as schema from "./index.js";

test("playback.mode: ausente/desconhecido = guiado (tours antigos não mudam)", () => {
  assert.deepEqual([...PLAYBACK_MODES], ["guided", "gallery"]);
  assert.equal(DEFAULT_PLAYBACK_MODE, "guided");
  for (const pb of [undefined, null, {}, { mode: "" }, { mode: "Gallery " }, { mode: 1 }, { mode: "slideshow" }, "gallery"]) {
    assert.equal(playbackMode(pb), "guided", JSON.stringify(pb));
  }
  assert.equal(playbackMode({ mode: "gallery" }), "gallery");
  assert.equal(isGalleryMode({ playback: { mode: "gallery" } }), true);
  assert.equal(isGalleryMode({}), false);
  assert.equal(isGalleryMode(null), false);
});

test("setPlaybackMode grava só o modo; guiado apaga o campo (mesmo hash do tour antigo)", () => {
  const pb = { defaultHoldSeconds: 6, stickyWhatsAppFromStep: 3 };
  const g = setPlaybackMode(pb, "gallery");
  assert.deepEqual(g, { defaultHoldSeconds: 6, stickyWhatsAppFromStep: 3, mode: "gallery" });
  assert.deepEqual(pb, { defaultHoldSeconds: 6, stickyWhatsAppFromStep: 3 }, "não muda o original");
  assert.deepEqual(setPlaybackMode(g, "guided"), pb);
  assert.deepEqual(setPlaybackMode(g, "qualquer"), pb);
  assert.deepEqual(setPlaybackMode(null, "gallery"), { mode: "gallery" });
  assert.equal(JSON.stringify(setPlaybackMode(pb, "guided")), JSON.stringify(pb));
});

test("parsePlaybackMode aceita pt/es/en e devolve null para lixo", () => {
  assert.equal(parsePlaybackMode("gallery"), "gallery");
  assert.equal(parsePlaybackMode(" Galeria "), "gallery");
  assert.equal(parsePlaybackMode("galería"), "gallery");
  assert.equal(parsePlaybackMode("guided"), "guided");
  assert.equal(parsePlaybackMode("Tour guiado"), "guided");
  assert.equal(parsePlaybackMode("<script>"), null);
  assert.equal(parsePlaybackMode(undefined), null);
});

test("template de empreendimento/imóvel começa em Galeria; o resto, guiado", () => {
  for (const k of ["empreendimento", "Imóvel", "imoveis", "real-estate", "property"]) assert.equal(defaultModeForTemplate(k), "gallery", k);
  for (const k of ["", "software", "onboarding", null]) assert.equal(defaultModeForTemplate(k), "guided", String(k));
});

test("index do tour-schema exporta o modo (a API usa a cópia sincronizada)", () => {
  assert.equal(typeof schema.playbackMode, "function");
  assert.equal(typeof schema.setPlaybackMode, "function");
  assert.equal(typeof schema.parsePlaybackMode, "function");
});

test("displayFromAgentInput: muda só o que veio, valida e limpa nomes de cena", () => {
  const current = { playback: { defaultHoldSeconds: 6 }, sceneLabels: { 1: "Antigo", 3: "Fica" } };
  const r = displayFromAgentInput({ mode: "gallery", stickyWhatsAppFromStep: 2, sceneNames: { 1: "<b>Fachada</b>", 2: "**Lazer**", 3: null } }, current);
  assert.equal(r.ok, true);
  assert.deepEqual(r.playback, { defaultHoldSeconds: 6, mode: "gallery", stickyWhatsAppFromStep: 2 });
  assert.deepEqual(r.sceneLabels, { 1: "Fachada", 2: "Lazer" });
  assert.deepEqual(current.playback, { defaultHoldSeconds: 6 }, "não muta a entrada");

  const back = displayFromAgentInput({ mode: "guided", stickyWhatsAppFromStep: 0 }, { playback: r.playback });
  assert.deepEqual(back.playback, { defaultHoldSeconds: 6 }, "guiado e 0 apagam os campos (hash igual ao antigo)");

  const bad = displayFromAgentInput({ mode: "slideshow", stickyWhatsAppFromStep: -1, sceneNames: { 0: "x", abc: "y" } }, {});
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.errors.map((e) => e.field), ["mode", "stickyWhatsAppFromStep", "sceneNames.0", "sceneNames.abc"]);
  assert.equal(displayFromAgentInput({ sceneNames: ["a"] }, {}).ok, false);
});

test("displayForAgent: padrão guiado, sem botão, só nomes válidos", () => {
  assert.deepEqual(displayForAgent({}), { mode: "guided", stickyWhatsAppFromStep: 0, sceneNames: {} });
  assert.deepEqual(displayForAgent({ playback: { mode: "gallery", stickyWhatsAppFromStep: 3 }, sceneLabels: { 1: "Fachada", 200: "x", 2: "  " } }), {
    mode: "gallery",
    stickyWhatsAppFromStep: 3,
    sceneNames: { 1: "Fachada" },
  });
});
