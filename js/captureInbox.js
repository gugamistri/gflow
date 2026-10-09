/**
 * O que fazer com uma captura que chega numa aba já aberta.
 * Anexar no projeto da memória preserva edições não salvas.
 * Criar outro projeto só troca de tela depois de gravar o atual.
 */

export function planCaptureHandoff({ mode, openProjectId, activeProjectId } = {}) {
  if (mode === "append") {
    if (openProjectId) return { action: "append", projectId: openProjectId, flushFirst: true };
    if (activeProjectId) return { action: "append-saved", projectId: activeProjectId, flushFirst: false };
    return { action: "reject", projectId: null, flushFirst: false };
  }
  return { action: "create", projectId: null, flushFirst: Boolean(openProjectId) };
}

/** A abertura inicial não pode repor o projeto antigo por cima da captura. */
export function bootShouldSkipSavedOpen(bootGeneration, captureGeneration) {
  return captureGeneration !== bootGeneration;
}

export function captureFingerprint(data) {
  const steps = Array.isArray(data?.payload?.steps) ? data.payload.steps : [];
  const first = steps[0] || {};
  const imageSize = typeof first.image === "string" ? first.image.length : 0;
  return [data?.type || "", steps.length, data?.payload?.name || "", imageSize, first.label || ""].join("|");
}

export function createCaptureClaim(now = () => Date.now()) {
  const doneIds = new Set();
  const recentFp = new Map();

  return {
    claim(data, windowMs = 2000) {
      const id = data?.id == null ? null : String(data.id);
      const fp = captureFingerprint(data);
      const t = now();
      if (id && doneIds.has(id)) return "done";
      const seen = recentFp.get(fp);
      if (seen != null && t - seen < windowMs) return "busy";
      recentFp.set(fp, t);
      return "fresh";
    },
    commit(data) {
      if (data?.id != null) doneIds.add(String(data.id));
      recentFp.set(captureFingerprint(data), now());
    },
    release(data) {
      recentFp.delete(captureFingerprint(data));
    },
  };
}
