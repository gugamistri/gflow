import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ONBOARDING_STORAGE_KEY,
  ONBOARDING_STEPS,
  markOnboardingDone,
  nextOnboardingStep,
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

test("uma escolha ou Agora não avança; no último passo encerra", () => {
  assert.deepEqual(nextOnboardingStep(0), { done: false, stepIndex: 1 });
  assert.deepEqual(nextOnboardingStep(1), { done: false, stepIndex: 2 });
  assert.deepEqual(nextOnboardingStep(2), { done: true, stepIndex: 2 });
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

test("o editor abre o onboarding só depois do boot da lista, e Conhecer o Pro vai para Entrar", () => {
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  assert.match(app, /shouldShowOnboarding/);
  assert.match(app, /createOnboardingDialog/);
  assert.match(app, /showAccountDialog\(\)/);
  assert.match(app, /focus: "llm-key"/);
  assert.equal(/showUpgradeDialog\(\{ feature: "onboarding"/.test(app), false);
  assert.match(app, /data-action="watch-example"|openProject\([^)]*autoPreview: true\)/);
  const html = readFileSync(new URL("../editor.html", import.meta.url), "utf8");
  assert.match(html, /id="modal-onboarding"/);
});
