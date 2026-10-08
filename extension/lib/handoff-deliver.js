/**
 * Decide quando a captura entra no editor.
 *
 * O content script roda num mundo isolado: `event.source !== window` mesmo
 * quando a página enviou `guia-ready`. Esse sinal não pode depender da
 * comparação. Um handoff novo também não pode ficar preso porque o anterior
 * já foi postado.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.__guiaHandoffDeliver = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function initialHandoffState() {
    return {
      editorReady: false,
      pending: null,
      postedId: null,
      ackedId: null,
    };
  }

  function cloneState(state) {
    const pending = state?.pending;
    return {
      editorReady: Boolean(state?.editorReady),
      pending: pending
        ? { id: pending.id, payload: pending.payload, mode: pending.mode }
        : null,
      postedId: state?.postedId ?? null,
      ackedId: state?.ackedId ?? null,
    };
  }

  function sameId(a, b) {
    return a != null && b != null && String(a) === String(b);
  }

  /**
   * @param {ReturnType<typeof initialHandoffState>} state
   * @param {{ type: string, id?: string|number, payload?: object, mode?: string, ok?: boolean, projectId?: string, error?: string }} event
   * @returns {{ state: ReturnType<typeof initialHandoffState>, post: object|null, ack: object|null }}
   */
  function reduceHandoff(state, event) {
    const next = cloneState(state);
    let ack = null;
    const kind = event?.type;

    if (kind === "editor-ready") {
      next.editorReady = true;
    } else if (kind === "retry") {
      if (next.editorReady && next.pending && !sameId(next.pending.id, next.ackedId)) {
        next.postedId = null;
      }
    } else if (kind === "handoff") {
      const id = event.id;
      const payload = event.payload;
      const mode = event.mode === "append" ? "append" : "create";
      if (id != null && payload && Array.isArray(payload.steps) && !sameId(id, next.ackedId)) {
        next.pending = { id, payload, mode };
        if (!sameId(id, next.postedId)) next.postedId = null;
      }
    } else if (kind === "ack") {
      const id = event.id != null ? event.id : next.pending?.id ?? next.postedId;
      if (id != null && (!next.pending || sameId(next.pending.id, id))) {
        const mode = event.mode === "append" || next.pending?.mode === "append" ? "append" : "create";
        next.ackedId = id;
        next.postedId = id;
        next.pending = null;
        ack = {
          id,
          ok: Boolean(event.ok),
          mode,
          projectId: event.projectId || null,
          error: event.error || null,
        };
      }
    }

    let post = null;
    if (
      next.editorReady &&
      next.pending &&
      !sameId(next.postedId, next.pending.id) &&
      !sameId(next.ackedId, next.pending.id)
    ) {
      next.postedId = next.pending.id;
      post = {
        id: next.pending.id,
        payload: next.pending.payload,
        mode: next.pending.mode,
        type: next.pending.mode === "append" ? "append-steps" : "import-project",
      };
    }

    return { state: next, post, ack };
  }

  return { initialHandoffState, reduceHandoff };
});
