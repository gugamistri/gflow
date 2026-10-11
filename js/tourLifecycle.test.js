import assert from "node:assert/strict";
import test from "node:test";
import { createTourLifecycle, normalizeExitReason } from "./tourLifecycle.js";

function recorder() {
  const calls = [];
  return {
    calls,
    hooks: {
      onStep: (p) => calls.push(["step", p]),
      onComplete: (p) => calls.push(["complete", p]),
      onExit: (p) => calls.push(["exit", p]),
    },
  };
}

test("onStep a cada passo e onComplete uma vez no fim", () => {
  const { calls, hooks } = recorder();
  const life = createTourLifecycle(hooks);
  life.start();
  life.step({ index: 0, stepId: "a", position: 0, total: 2 });
  life.step({ index: 1, stepId: "b", position: 1, total: 2 });
  assert.equal(life.complete(), true);
  assert.equal(life.complete(), false);
  assert.equal(life.exit("esc"), false, "saída depois da conclusão não conta");
  assert.deepEqual(calls, [
    ["step", { index: 0, stepId: "a", position: 0, total: 2 }],
    ["step", { index: 1, stepId: "b", position: 1, total: 2 }],
    ["complete", { index: 1, total: 2 }],
  ]);
  assert.equal(life.completed, true);
});

test("onExit leva o último passo e o motivo; só uma vez por execução", () => {
  const { calls, hooks } = recorder();
  const life = createTourLifecycle(hooks);
  life.start();
  life.step({ index: 0, total: 3 });
  life.step({ index: 2, total: 3 });
  assert.equal(life.exit("click_outside"), true);
  assert.equal(life.exit("esc"), false);
  life.step({ index: 1, total: 3 });
  assert.deepEqual(calls.at(-1), ["exit", { index: 2, total: 3, reason: "click_outside" }]);
  assert.equal(calls.length, 3);
  assert.equal(life.active, false);
});

test("replay começa uma execução nova", () => {
  const { calls, hooks } = recorder();
  const life = createTourLifecycle(hooks);
  life.start();
  life.step({ index: 0, total: 1 });
  life.complete();
  life.start();
  assert.equal(life.completed, false);
  life.step({ index: 0, total: 1 });
  life.exit("pagehide");
  assert.deepEqual(calls.map((c) => c[0]), ["step", "complete", "step", "exit"]);
  assert.equal(calls.at(-1)[1].reason, "pagehide");
});

test("sem passo exibido não há conclusão nem saída", () => {
  const { calls, hooks } = recorder();
  const life = createTourLifecycle(hooks);
  life.start();
  assert.equal(life.exit("esc"), false);
  assert.equal(life.complete(), false);
  assert.equal(calls.length, 0);
});

test("motivos desconhecidos viram close; ids vazios viram null", () => {
  assert.equal(normalizeExitReason("esc"), "esc");
  assert.equal(normalizeExitReason("click_outside"), "click_outside");
  assert.equal(normalizeExitReason("whatever"), "close");
  assert.equal(normalizeExitReason(), "close");
  const { calls, hooks } = recorder();
  const life = createTourLifecycle(hooks);
  life.start();
  life.step({ index: 0, stepId: "", total: 1 });
  assert.equal(calls[0][1].stepId, null);
});

test("um gancho com erro não quebra o player", () => {
  const life = createTourLifecycle({
    onStep: () => {
      throw new Error("boom");
    },
  });
  const original = console.error;
  console.error = () => {};
  try {
    life.start();
    assert.doesNotThrow(() => life.step({ index: 0, total: 1 }));
    assert.equal(life.complete(), true);
  } finally {
    console.error = original;
  }
});

test("sem ganchos, nada acontece", () => {
  const life = createTourLifecycle();
  life.start();
  life.step({ index: 0, total: 1 });
  assert.equal(life.complete(), true);
});
