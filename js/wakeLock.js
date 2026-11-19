/**
 * Mantém a tela acesa enquanto um tour está visível e em uso.
 * Só a Screen Wake Lock API — sem vídeo invisível nem fallback.
 * Sem suporte, ou com NotAllowedError, não faz nada.
 */

export const TOUR_WAKE_LOCK_IDLE_MS = 3 * 60 * 1000;

function defaultDoc() {
  return typeof document !== "undefined" ? document : null;
}

function defaultWin() {
  return typeof window !== "undefined" ? window : null;
}

function defaultWakeLock() {
  return typeof navigator !== "undefined" ? navigator.wakeLock : null;
}

/**
 * Máquina de estado do wake lock do tour.
 * `start()` enquanto o tour roda; `stop()` ao terminar; `ping()` a cada
 * passo ou interação (reinicia os ~3 min de ociosidade).
 */
export function createTourWakeLock(opts = {}) {
  const {
    idleMs = TOUR_WAKE_LOCK_IDLE_MS,
    document: doc,
    window: win,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (id) => clearTimeout(id),
  } = opts;
  const getDoc = () => doc ?? defaultDoc();
  const getWin = () => win ?? defaultWin();
  // why: wakeLock no opts (mesmo undefined) substitui o navigator; senão cai no ambiente
  const getApi = () => ("wakeLock" in opts ? opts.wakeLock : defaultWakeLock());

  let wanted = false;
  let idle = false;
  let sentinel = null;
  let idleTimer = 0;
  let requestId = 0;
  let bound = false;

  function isVisible() {
    const d = getDoc();
    if (!d) return true;
    return d.visibilityState !== "hidden";
  }

  function clearIdleTimer() {
    if (!idleTimer) return;
    clearTimer(idleTimer);
    idleTimer = 0;
  }

  function armIdleTimer() {
    clearIdleTimer();
    if (!wanted) return;
    const ms = Number(idleMs);
    if (!Number.isFinite(ms) || ms <= 0) return;
    idleTimer = setTimer(() => {
      idleTimer = 0;
      if (!wanted) return;
      idle = true;
      releaseSentinel();
    }, ms);
  }

  function onSentinelRelease() {
    sentinel = null;
  }

  function listenSentinel(s, on) {
    if (!s) return;
    if (on) s.addEventListener?.("release", onSentinelRelease);
    else s.removeEventListener?.("release", onSentinelRelease);
  }

  function releaseSentinel() {
    requestId += 1;
    const cur = sentinel;
    sentinel = null;
    if (!cur) return;
    listenSentinel(cur, false);
    try {
      const done = cur.release?.();
      if (done && typeof done.catch === "function") done.catch(() => {});
    } catch {
      /* ignore */
    }
  }

  async function acquire() {
    if (!wanted || idle || !isVisible()) return;
    const api = getApi();
    if (!api || typeof api.request !== "function") return;
    if (sentinel && sentinel.released !== true) return;
    const id = (requestId += 1);
    try {
      const next = await api.request("screen");
      if (id !== requestId || !wanted || idle || !isVisible()) {
        try {
          const done = next?.release?.();
          if (done && typeof done.catch === "function") done.catch(() => {});
        } catch {
          /* ignore */
        }
        return;
      }
      sentinel = next;
      listenSentinel(next, true);
    } catch {
      // why: NotAllowedError (e qualquer outra recusa) não pode quebrar o tour
    }
  }

  function onVisibility() {
    if (!wanted) return;
    if (!isVisible()) {
      releaseSentinel();
      return;
    }
    if (!idle) acquire();
  }

  function ping() {
    if (!wanted) return;
    idle = false;
    armIdleTimer();
    acquire();
  }

  function bind() {
    if (bound) return;
    bound = true;
    const d = getDoc();
    const w = getWin() || d;
    d?.addEventListener?.("visibilitychange", onVisibility);
    // why: pointer cobre mouse e toque moderno; touchstart pega navegadores antigos
    w?.addEventListener?.("pointerdown", ping, { capture: true, passive: true });
    w?.addEventListener?.("touchstart", ping, { capture: true, passive: true });
    w?.addEventListener?.("keydown", ping, { capture: true });
  }

  function unbind() {
    if (!bound) return;
    bound = false;
    const d = getDoc();
    const w = getWin() || d;
    d?.removeEventListener?.("visibilitychange", onVisibility);
    w?.removeEventListener?.("pointerdown", ping, { capture: true });
    w?.removeEventListener?.("touchstart", ping, { capture: true });
    w?.removeEventListener?.("keydown", ping, { capture: true });
  }

  return {
    /** Tour visível e em uso: pede o lock se o navegador deixar. */
    start() {
      wanted = true;
      idle = false;
      bind();
      armIdleTimer();
      acquire();
    },
    /** Tour acabou: solta o lock e para de ouvir. */
    stop() {
      wanted = false;
      idle = false;
      clearIdleTimer();
      releaseSentinel();
      unbind();
    },
    /** Interação ou troca de passo: reinicia a ociosidade e tenta de novo se precisar. */
    ping,
    get active() {
      return wanted;
    },
    get held() {
      return Boolean(sentinel && sentinel.released !== true);
    },
    get idle() {
      return idle;
    },
  };
}
