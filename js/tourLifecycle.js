/**
 * Ganchos do player: onStep, onComplete e onExit.
 * why: a tela final (F3) e o analytics (F4) precisam saber em que passo o visitante
 * está e como o tour acabou, sem conhecer o Driver nem o DOM.
 * Cada execução do tour reporta no máximo um fim: conclusão OU saída.
 */

export const EXIT_REASONS = ["esc", "click_outside", "close", "pagehide"];

export function normalizeExitReason(reason) {
  const raw = String(reason || "").trim();
  return EXIT_REASONS.includes(raw) ? raw : "close";
}

function safeCall(fn, payload) {
  if (typeof fn !== "function") return;
  try {
    fn(payload);
  } catch (err) {
    // why: um gancho com erro (ex.: analytics) nunca pode travar o tour
    console.error(err);
  }
}

export function createTourLifecycle({ onStep, onComplete, onExit } = {}) {
  let lastIndex = -1;
  let total = 0;
  let completed = false;
  let ended = false;

  return {
    /** Nova execução (play ou replay). */
    start() {
      lastIndex = -1;
      total = 0;
      completed = false;
      ended = false;
    },
    /** Passo exibido. `index` é o índice no tour; `position` é a posição na lista tocada. */
    step({ index, stepId = null, position = index, total: count = 0 } = {}) {
      if (ended) return;
      const i = Number(index);
      if (!Number.isInteger(i) || i < 0) return;
      lastIndex = i;
      total = Math.max(0, Number(count) || 0);
      safeCall(onStep, {
        index: i,
        stepId: stepId == null || stepId === "" ? null : String(stepId),
        position: Number.isInteger(Number(position)) ? Number(position) : i,
        total,
      });
    },
    /** Último passo concluído. Devolve false se a execução já tinha acabado. */
    complete() {
      if (ended || lastIndex < 0) return false;
      completed = true;
      ended = true;
      safeCall(onComplete, { index: lastIndex, total });
      return true;
    },
    /** Saída antes do fim. Ignorada depois da conclusão ou sem passo exibido. */
    exit(reason) {
      if (ended || lastIndex < 0) return false;
      ended = true;
      safeCall(onExit, { index: lastIndex, total, reason: normalizeExitReason(reason) });
      return true;
    },
    get completed() {
      return completed;
    },
    get active() {
      return lastIndex >= 0 && !ended;
    },
    get index() {
      return lastIndex;
    },
  };
}
