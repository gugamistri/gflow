import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { applyField, snapshotProject } from "./collabModel.js";
import { projectToSyncPayload } from "./cloudSync.js";
import { prepareSharePayload } from "./shareSnapshot.js";
import { isGalleryMode } from "./tour-schema/playbackMode.js";
import { clickRevealPlan } from "./tour-schema/clickTransition.js";
import { popoverIsHidden, popoverWithBalloon } from "./tour-schema/popoverVisibility.js";
import { applyAgentStepInput, stepForAgent } from "./tour-schema/agent.js";

const step = {
  id: "step-a",
  pos: "a",
  scene: 1,
  type: "screen",
  label: "Busca",
  image: "custom:a",
  hotspot: { x: 10, y: 10, w: 20, h: 8 },
  clickPoint: { x: 20, y: 14 },
  popover: { title: "Busca", description: "Digite o nome", side: "bottom", align: "center", hidden: true },
  transition: { fromClick: true, ms: 400 },
  actions: [{ t: 0, kind: "type", text: "norte", x: 22, y: 18 }],
  simulateClick: true,
  onNext: "advance",
};

test("sem os campos o passo segue como hoje", () => {
  const plain = { type: "screen", popover: { title: "A" }, clickPoint: { x: 10, y: 10 } };
  assert.equal(popoverIsHidden(plain), false);
  assert.equal(Object.hasOwn(popoverWithBalloon(plain.popover, true), "hidden"), false);
  assert.equal(clickRevealPlan(plain, { nextIsImage: true, reducedMotion: false }), null);
  assert.equal(clickRevealPlan({ ...plain, transition: { fromClick: true } }, { nextIsImage: true, reducedMotion: true }), null);
  const created = applyAgentStepInput({ title: "A", text: "B" });
  assert.equal(created.step.popover.hidden, undefined);
  assert.equal(stepForAgent(created.step, 0).showPopover, undefined);
  assert.equal(isGalleryMode({ playback: { mode: "gallery" }, steps: [step] }), true);
  assert.equal(isGalleryMode({ playback: { mode: "guided" }, steps: [step] }), false);
});

test("showPopover grava popover.hidden e o update preserva", () => {
  const off = applyAgentStepInput({ title: "A", showPopover: false });
  assert.equal(off.ok, true);
  assert.equal(off.step.popover.hidden, true);
  assert.equal(stepForAgent(off.step, 0).showPopover, false);
  const kept = applyAgentStepInput({ text: "novo" }, off.step);
  assert.equal(kept.step.popover.hidden, true);
  assert.equal(kept.step.popover.title, "A");
  const on = applyAgentStepInput({ showPopover: true }, kept.step);
  assert.equal(Object.hasOwn(on.step.popover, "hidden"), false);
  assert.equal(applyAgentStepInput({ showPopover: "no" }).ok, false);
  assert.equal(popoverIsHidden({ type: "slide", popover: { hidden: true } }), false);
});

test("sync, share e colaboração não apagam transition, balão oculto nem actions", () => {
  const project = {
    id: "local",
    name: "Tarefas",
    theme: { accent: "#112233" },
    customImages: {},
    steps: [structuredClone(step)],
    playback: { defaultHoldSeconds: 4 },
    narration: {},
  };
  const synced = projectToSyncPayload(project);
  assert.equal(synced.steps[0].popover.hidden, true);
  assert.deepEqual(synced.steps[0].transition, { fromClick: true, ms: 400 });
  assert.equal(synced.steps[0].actions[0].text, "norte");
  assert.equal(synced.id, undefined);

  const shared = prepareSharePayload(project);
  assert.equal(shared.steps[0].popover.hidden, true);
  assert.deepEqual(shared.steps[0].transition, step.transition);
  assert.equal(shared.steps[0].actions[0].kind, "type");
  assert.equal(shared.share, undefined);

  const collab = { name: "Tarefas", theme: {}, customImages: {}, steps: [structuredClone(step)] };
  assert.doesNotThrow(() => snapshotProject(collab));
  applyField(collab, "s:step-a:label", "Outro");
  assert.equal(collab.steps[0].label, "Outro");
  assert.equal(collab.steps[0].popover.hidden, true);
  assert.deepEqual(collab.steps[0].transition, step.transition);
  assert.equal(collab.steps[0].actions[0].text, "norte");
});

test("o player esconde o balão anterior durante a transição", () => {
  const player = readFileSync(new URL("./player.js", import.meta.url), "utf8");
  const standalone = readFileSync(new URL("./standalonePlayer.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../css/theme.css", import.meta.url), "utf8");
  for (const src of [player, standalone]) {
    const slice = src.slice(src.indexOf("onNextClick:"));
    const hide = slice.indexOf("setRevealPopoverHidden(true)");
    const show = slice.indexOf("await showStepVisual");
    const move = slice.indexOf("drv.moveNext()");
    const clear = slice.indexOf("setRevealPopoverHidden(false)");
    assert.ok(hide >= 0 && hide < show && show < move && move < clear, "ordem: esconder, trocar imagem, mover, mostrar");
  }
  assert.match(css, /\.is-reveal-hidden \{[^}]*visibility: hidden !important;/);
  assert.match(css, /\.is-nav-only \.driver-popover-title/);
});
