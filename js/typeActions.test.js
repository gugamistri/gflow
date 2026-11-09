import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { applyAgentStepInput, stepForAgent } from "./tour-schema/agent.js";
import { normalizeStepActions, typeReplayPlan } from "./tour-schema/typeActions.js";
import { isGalleryMode } from "./tour-schema/playbackMode.js";

test("tour sem actions não reencena, com reduced-motion também não", () => {
  assert.equal(typeReplayPlan({ type: "screen" }, { reducedMotion: false }), null);
  assert.equal(typeReplayPlan({ type: "screen" }, { reducedMotion: true }), null);
  assert.equal(normalizeStepActions(undefined).actions, null);
  assert.equal(normalizeStepActions(null).actions, null);
  const created = applyAgentStepInput({ title: "A" });
  assert.equal(created.step.actions, undefined);
  assert.equal(stepForAgent(created.step, 0).actions, undefined);
  assert.equal(isGalleryMode({ playback: { mode: "gallery" }, steps: [{ actions: [{ kind: "type", text: "a", x: 1, y: 1 }] }] }), true);
});

test("actions são opcionais, truncadas e preservadas no update", () => {
  const bad = applyAgentStepInput({ actions: { text: "x" } });
  assert.equal(bad.ok, false);
  const on = applyAgentStepInput({
    title: "Busca",
    actions: [{ t: 12, kind: "type", text: "n".repeat(240), x: 30, y: 40 }, { kind: "nope", text: "x", x: 1, y: 1 }],
  });
  assert.equal(on.ok, true);
  assert.equal(on.step.actions[0].text.length, 200);
  assert.equal(on.step.actions.length, 1);
  const kept = applyAgentStepInput({ text: "ok" }, on.step);
  assert.equal(kept.step.actions[0].text.length, 200);
  assert.equal(stepForAgent(kept.step, 0).actions[0].kind, "type");
  const off = applyAgentStepInput({ actions: null }, kept.step);
  assert.equal(off.step.actions, undefined);
  const plan = typeReplayPlan(on.step, { reducedMotion: true });
  assert.equal(plan.reducedMotion, true);
  assert.equal(plan.actions[0].text.length, 200);
});

test("a página da extensão filtra senha antes de enviar e a opção nasce desligada", () => {
  const content = readFileSync(new URL("../extension/content.js", import.meta.url), "utf8");
  const background = readFileSync(new URL("../extension/background.js", import.meta.url), "utf8");
  assert.match(content, /type === "password"/);
  assert.match(content, /current-password/);
  assert.match(content, /one-time-code/);
  assert.match(content, /startsWith\("cc-"\)/);
  assert.match(content, /recordTyping/);
  assert.match(background, /recordTyping: raw\.recordTyping === true/);
  assert.match(background, /settings\?\.recordTyping === true/);
  const player = readFileSync(new URL("./player.js", import.meta.url), "utf8");
  const replay = player.indexOf("playTypeReplay");
  const click = player.indexOf("await animateClick(current)");
  assert.ok(replay > 0 && replay < click);
});
