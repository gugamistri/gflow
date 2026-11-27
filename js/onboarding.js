/**
 * Onboarding de 3 passos na primeira visita do editor.
 * As respostas ficam só neste navegador (localStorage), não na conta.
 */

export const ONBOARDING_STORAGE_KEY = "guiaflow-onboarding-v1";

export const ONBOARDING_STEPS = Object.freeze([
  Object.freeze({
    id: "role",
    title: "onboarding.step1.title",
    lead: "onboarding.step1.lead",
    choices: Object.freeze([
      Object.freeze({ value: "agency", label: "onboarding.step1.agency" }),
      Object.freeze({ value: "consulting", label: "onboarding.step1.consulting" }),
      Object.freeze({ value: "founder", label: "onboarding.step1.founder" }),
      Object.freeze({ value: "other", label: "onboarding.step1.other" }),
    ]),
  }),
  Object.freeze({
    id: "start",
    title: "onboarding.step2.title",
    lead: "onboarding.step2.lead",
    choices: Object.freeze([
      Object.freeze({ value: "capture", label: "onboarding.step2.capture" }),
      Object.freeze({ value: "import", label: "onboarding.step2.import" }),
      Object.freeze({ value: "assistant", label: "onboarding.step2.assistant" }),
      Object.freeze({ value: "example", label: "onboarding.step2.example" }),
      Object.freeze({ value: "library", label: "onboarding.step2.library" }),
    ]),
  }),
  Object.freeze({
    id: "assistant",
    title: "onboarding.step3.title",
    lead: "onboarding.step3.lead",
    choices: Object.freeze([
      Object.freeze({ value: "key", label: "onboarding.step3.key" }),
      Object.freeze({ value: "pro", label: "onboarding.step3.pro" }),
    ]),
  }),
]);

export function readOnboardingState(storage) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(ONBOARDING_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function writeOnboardingState(state, storage) {
  if (!storage) return state;
  try {
    storage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage cheio ou bloqueado: o onboarding some só nesta visita */
  }
  return state;
}

export function markOnboardingDone(partial = {}, storage) {
  const prev = readOnboardingState(storage) || {};
  const next = { ...prev, ...partial, done: true };
  return writeOnboardingState(next, storage);
}

/**
 * Só na primeira visita da lista de projetos.
 * Fora: recorrente com projeto ativo, captura da extensão, convite e ?novo=.
 */
export function shouldShowOnboarding({
  completed,
  skipSavedOpen,
  activeProjectId,
  joinPending,
  hasNewIntent,
} = {}) {
  if (completed) return false;
  if (skipSavedOpen) return false;
  if (activeProjectId) return false;
  if (joinPending) return false;
  if (hasNewIntent) return false;
  return true;
}

export function nextOnboardingStep(stepIndex) {
  if (stepIndex + 1 >= ONBOARDING_STEPS.length) return { done: true, stepIndex };
  return { done: false, stepIndex: stepIndex + 1 };
}

export function createOnboardingDialog({
  t,
  storage,
  onFinished,
} = {}) {
  let stepIndex = 0;
  const answers = { role: "", start: "", assistant: "" };
  let finishing = false;

  function dialog() {
    return document.getElementById("modal-onboarding");
  }

  function paint() {
    const step = ONBOARDING_STEPS[stepIndex];
    if (!step) return;
    const progress = document.getElementById("onboarding-progress");
    const title = document.getElementById("onboarding-title");
    const lead = document.getElementById("onboarding-lead");
    const choices = document.getElementById("onboarding-choices");
    const skip = document.getElementById("onboarding-skip");
    if (progress) progress.textContent = t("onboarding.progress", { step: stepIndex + 1, total: ONBOARDING_STEPS.length });
    if (title) title.textContent = t(step.title);
    if (lead) lead.textContent = t(step.lead);
    if (skip) skip.textContent = t("onboarding.skip");
    if (choices) {
      choices.replaceChildren(
        ...step.choices.map((choice) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "btn";
          btn.dataset.choice = choice.value;
          btn.textContent = t(choice.label);
          return btn;
        })
      );
    }
  }

  function finish(extra = {}) {
    if (finishing) return;
    finishing = true;
    const result = markOnboardingDone({ ...answers, ...extra }, storage);
    const el = dialog();
    if (el?.open) el.close();
    onFinished?.(result);
  }

  function choose(value) {
    const step = ONBOARDING_STEPS[stepIndex];
    if (!step) return;
    answers[step.id] = value;
    const next = nextOnboardingStep(stepIndex);
    if (next.done) {
      finish();
      return;
    }
    stepIndex = next.stepIndex;
    paint();
  }

  function skip() {
    const step = ONBOARDING_STEPS[stepIndex];
    if (step) answers[step.id] = answers[step.id] || "skip";
    const next = nextOnboardingStep(stepIndex);
    if (next.done) {
      finish({ skipped: true });
      return;
    }
    stepIndex = next.stepIndex;
    paint();
  }

  function open() {
    stepIndex = 0;
    answers.role = "";
    answers.start = "";
    answers.assistant = "";
    finishing = false;
    paint();
    const el = dialog();
    if (el && !el.open) el.showModal();
  }

  function bind() {
    const el = dialog();
    if (!el || el.dataset.onboardingBound === "1") return;
    el.dataset.onboardingBound = "1";
    document.getElementById("onboarding-choices")?.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-choice]");
      if (!btn) return;
      choose(btn.dataset.choice);
    });
    document.getElementById("onboarding-skip")?.addEventListener("click", () => skip());
    el.addEventListener("cancel", () => {
      /* Esc fecha e encerra; "Agora não" só pula o passo */
    });
    el.addEventListener("close", () => {
      if (!finishing) finish({ skipped: true });
    });
  }

  bind();
  return { open, paint, finish, choose, skip };
}
