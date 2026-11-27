import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ONBOARDING_STORAGE_KEY,
  ONBOARDING_STEPS,
  canAdvanceOnboarding,
  markOnboardingDone,
  nextOnboardingStep,
  onboardingAdvanceLabelKey,
  readOnboardingState,
  shouldShowOnboarding,
  writeOnboardingState,
} from "./onboarding.js";

function memoryStorage(start = {}) {
  const map = new Map(Object.entries(start));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
  };
}

test("três passos com as escolhas propostas", () => {
  assert.equal(ONBOARDING_STEPS.length, 3);
  assert.deepEqual(ONBOARDING_STEPS.map((s) => s.id), ["role", "start", "assistant"]);
  assert.deepEqual(
    ONBOARDING_STEPS[0].choices.map((c) => c.value),
    ["agency", "consulting", "founder", "other"]
  );
  assert.deepEqual(
    ONBOARDING_STEPS[1].choices.map((c) => c.value),
    ["capture", "import", "assistant", "example", "library"]
  );
  assert.deepEqual(
    ONBOARDING_STEPS[2].choices.map((c) => c.value),
    ["key", "pro"]
  );
});

test("só aparece na primeira visita da lista de projetos", () => {
  const base = {
    completed: false,
    skipSavedOpen: false,
    activeProjectId: null,
    joinPending: false,
    hasNewIntent: false,
  };
  assert.equal(shouldShowOnboarding(base), true);
  assert.equal(shouldShowOnboarding({ ...base, completed: true }), false);
  assert.equal(shouldShowOnboarding({ ...base, activeProjectId: "p1" }), false);
  assert.equal(shouldShowOnboarding({ ...base, skipSavedOpen: true }), false);
  assert.equal(shouldShowOnboarding({ ...base, joinPending: true }), false);
  assert.equal(shouldShowOnboarding({ ...base, hasNewIntent: true }), false);
});

test("Seguinte só avança com uma escolha; no último passo o rótulo é Concluir", () => {
  assert.equal(canAdvanceOnboarding({}, 0), false);
  assert.equal(canAdvanceOnboarding({ role: "" }, 0), false);
  assert.equal(canAdvanceOnboarding({ role: "skip" }, 0), false);
  assert.equal(canAdvanceOnboarding({ role: "agency" }, 0), true);
  assert.equal(canAdvanceOnboarding({ start: "example" }, 1), true);
  assert.equal(canAdvanceOnboarding({ start: "example" }, 2), false);
  assert.equal(canAdvanceOnboarding({ assistant: "key" }, 2), true);
  assert.deepEqual(nextOnboardingStep(0), { done: false, stepIndex: 1 });
  assert.deepEqual(nextOnboardingStep(1), { done: false, stepIndex: 2 });
  assert.deepEqual(nextOnboardingStep(2), { done: true, stepIndex: 2 });
  assert.equal(onboardingAdvanceLabelKey(0), "onboarding.next");
  assert.equal(onboardingAdvanceLabelKey(1), "onboarding.next");
  assert.equal(onboardingAdvanceLabelKey(2), "onboarding.done");
});

test("o estado fica só no localStorage, com done", () => {
  const storage = memoryStorage();
  assert.equal(readOnboardingState(storage), null);
  const saved = markOnboardingDone({ role: "agency", start: "example", assistant: "key" }, storage);
  assert.equal(saved.done, true);
  assert.equal(saved.role, "agency");
  assert.equal(readOnboardingState(storage).start, "example");
  assert.equal(storage.getItem(ONBOARDING_STORAGE_KEY).includes("agency"), true);
});

test("writeOnboardingState não quebra se o storage falhar", () => {
  const storage = {
    getItem() {
      return null;
    },
    setItem() {
      throw new Error("quota");
    },
  };
  assert.equal(writeOnboardingState({ done: true }, storage).done, true);
});

test("o rodapé tem Agora não como link e Seguinte/Concluir; a escolha não avança sozinha", () => {
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  assert.match(app, /shouldShowOnboarding/);
  assert.match(app, /createOnboardingDialog/);
  assert.match(app, /showAccountDialog\(\)/);
  assert.match(app, /focus: "llm-key"/);
  assert.equal(/showUpgradeDialog\(\{ feature: "onboarding"/.test(app), false);
  assert.match(app, /data-action="watch-example"|openProject\([^)]*autoPreview: true\)/);

  const html = readFileSync(new URL("../editor.html", import.meta.url), "utf8");
  assert.match(html, /id="modal-onboarding"/);
  assert.match(html, /class="onboarding-skip" id="onboarding-skip"/);
  assert.match(html, /id="onboarding-next"[^>]*disabled/);
  assert.match(html, /class="btn btn-primary" id="onboarding-next"/);
  assert.equal(/id="onboarding-skip"[^>]*class="btn/.test(html), false);

  const js = readFileSync(new URL("./onboarding.js", import.meta.url), "utf8");
  assert.match(js, /function select\(/);
  assert.match(js, /function advance\(/);
  assert.match(js, /next\.disabled = !canAdvanceOnboarding/);
  assert.match(js, /onboardingAdvanceLabelKey/);
  assert.equal(/function choose\(/.test(js), false);

  const i18n = readFileSync(new URL("./i18n.js", import.meta.url), "utf8");
  assert.match(i18n, /"onboarding.next": "Seguinte"/);
  assert.match(i18n, /"onboarding.done": "Concluir"/);
  assert.match(i18n, /"onboarding.next": "Siguiente"/);
  assert.match(i18n, /"onboarding.done": "Terminar"/);
  assert.match(i18n, /"onboarding.next": "Next"/);
  assert.match(i18n, /"onboarding.done": "Done"/);
});
