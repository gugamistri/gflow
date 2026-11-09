import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { normalizeSteps } from "./store.js";
import {
  CLICK_TRANSITION_DEFAULT_MS,
  CLICK_TRANSITION_MAX_MS,
  clickRevealCircle,
  clickRevealPlan,
  previewClickTransitionRequested,
  readStepTransition,
} from "./tour-schema/clickTransition.js";

const point = { x: 32, y: 71 };

test("sem transition o plano é nulo (troca instantânea)", () => {
  const step = { type: "screen", image: "custom:a", clickPoint: point, simulateClick: true };
  assert.equal(Object.hasOwn(step, "transition"), false);
  assert.equal(clickRevealPlan(step, { nextIsImage: true }), null);
  assert.equal(clickRevealPlan(step, { preview: false, nextIsImage: true }), null);
  assert.equal(clickRevealPlan({ ...step, type: "slide" }, { preview: true, nextIsImage: true }), null);
  assert.equal(clickRevealPlan({ type: "screen", image: "custom:a", transition: { fromClick: true } }, { nextIsImage: true }), null);
  assert.equal(previewClickTransitionRequested(""), false);
  assert.equal(previewClickTransitionRequested("?foo=1"), false);
  assert.equal(previewClickTransitionRequested("?transition=zoom"), false);
});

test("fromClick revela a partir do clickPoint, no máximo 600 ms", () => {
  const step = { type: "screen", clickPoint: point, transition: { fromClick: true } };
  assert.deepEqual(clickRevealPlan(step, { nextIsImage: true }), {
    xPct: 32,
    yPct: 71,
    ms: CLICK_TRANSITION_DEFAULT_MS,
  });
  assert.equal(CLICK_TRANSITION_DEFAULT_MS, 400);
  assert.equal(CLICK_TRANSITION_MAX_MS, 600);
  const custom = { ...step, transition: { fromClick: true, ms: 250 } };
  assert.equal(clickRevealPlan(custom, { nextIsImage: true }).ms, 250);
  assert.equal(clickRevealPlan({ ...step, transition: { fromClick: true, ms: 900 } }, { nextIsImage: true }).ms, 600);
  assert.equal(clickRevealPlan({ ...step, transition: { fromClick: true, ms: 0 } }, { nextIsImage: true }), null);
  assert.equal(clickRevealPlan(step, { nextIsImage: false }), null);
  assert.equal(clickRevealPlan(step, { reducedMotion: true, nextIsImage: true }), null);
  assert.deepEqual(clickRevealPlan({ type: "screen", clickPoint: point }, { preview: true, nextIsImage: true }), {
    xPct: 32,
    yPct: 71,
    ms: 400,
  });
  assert.equal(previewClickTransitionRequested("?transition=click"), true);
  assert.equal(previewClickTransitionRequested("transition=click&x=1"), true);
});

test("o círculo cobre o canto mais distante e não usa blur", () => {
  const circle = clickRevealCircle(0, 0, 100, 100);
  assert.equal(circle.from, "circle(0px at 0px 0px)");
  assert.equal(circle.r, Math.ceil(Math.hypot(100, 100)));
  assert.equal(circle.to, `circle(${circle.r}px at 0px 0px)`);
  const mid = clickRevealCircle(50, 50, 200, 100);
  assert.equal(mid.x, 100);
  assert.equal(mid.y, 50);
  assert.ok(mid.r >= Math.hypot(100, 50));
});

test("readStepTransition só grava fromClick true", () => {
  assert.equal(readStepTransition(undefined).transition, null);
  assert.equal(readStepTransition(null).transition, null);
  assert.equal(readStepTransition({}).transition, null);
  assert.equal(readStepTransition({ fromClick: false }).transition, null);
  assert.equal(readStepTransition("click").ok, false);
  assert.equal(readStepTransition({ fromClick: true, ms: -5 }).ok, false);
  const high = readStepTransition({ fromClick: true, ms: 800 });
  assert.deepEqual(high.transition, { fromClick: true, ms: 600 });
  assert.match(high.warnings.join(" "), /600/);
  assert.deepEqual(readStepTransition({ fromClick: true }).transition, { fromClick: true });
});

test("normalizeSteps não cria nem apaga transition", () => {
  const plain = { hotspot: { x: 10, y: 10, w: 20, h: 10 } };
  normalizeSteps([plain]);
  assert.equal(Object.hasOwn(plain, "transition"), false);
  assert.ok(plain.clickPoint);
  const kept = {
    hotspot: { x: 10, y: 10, w: 20, h: 10 },
    clickPoint: { x: 12, y: 14 },
    transition: { fromClick: true, ms: 400 },
  };
  normalizeSteps([kept]);
  assert.deepEqual(kept.transition, { fromClick: true, ms: 400 });
  assert.deepEqual(kept.clickPoint, { x: 12, y: 14 });
});

test("o player autônomo usa a mesma decisão", () => {
  const src = readFileSync(new URL("./standalonePlayer.js", import.meta.url), "utf8");
  const pick = (name) => {
    const start = src.indexOf(`  function ${name}(`);
    assert.ok(start >= 0, name);
    const end = src.indexOf("\n  }\n", start);
    assert.ok(end > start, name);
    return src.slice(start, end + 4);
  };
  const offline = new Function(`
    const CLICK_TRANSITION_DEFAULT_MS = 400;
    const CLICK_TRANSITION_MAX_MS = 600;
    ${pick("readStepTransition")}
    ${pick("previewClickTransitionRequested")}
    ${pick("clickRevealPlan")}
    ${pick("clickRevealCircle")}
    return { readStepTransition, previewClickTransitionRequested, clickRevealPlan, clickRevealCircle };
  `)();
  const samples = [
    undefined,
    null,
    {},
    { fromClick: false },
    { fromClick: true },
    { fromClick: true, ms: 250 },
    { fromClick: true, ms: 900 },
    { fromClick: true, ms: -1 },
    [],
  ];
  for (const raw of samples) {
    assert.deepEqual(offline.readStepTransition(raw), readStepTransition(raw));
  }
  const steps = [
    { type: "screen", clickPoint: point },
    { type: "screen", clickPoint: point, transition: { fromClick: true } },
    { type: "screen", clickPoint: point, transition: { fromClick: true, ms: 0 } },
    { type: "slide", clickPoint: point, transition: { fromClick: true } },
  ];
  const optsList = [
    undefined,
    { nextIsImage: true },
    { preview: true, nextIsImage: true },
    { reducedMotion: true, nextIsImage: true },
    { nextIsImage: false },
  ];
  for (const step of steps) {
    for (const opts of optsList) {
      assert.deepEqual(offline.clickRevealPlan(step, opts), clickRevealPlan(step, opts), JSON.stringify({ step, opts }));
    }
  }
  assert.deepEqual(offline.clickRevealCircle(0, 0, 100, 100), clickRevealCircle(0, 0, 100, 100));
  assert.equal(offline.previewClickTransitionRequested("?transition=click"), true);
  assert.equal(offline.previewClickTransitionRequested(""), false);
  assert.match(src, /gf-click-reveal/);
  assert.match(src, /cubic-bezier\(0\.2, 0, 0\.2, 1\)/);
  assert.match(src, /prefers-reduced-motion: reduce/);
});
