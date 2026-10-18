/**
 * Lock suave por passo (cliente). O servidor é a autoridade (TTL 60 s); aqui ficam as regras de UX:
 * - adquire no primeiro `input` num passo (não no `focus`: no celular o toque por engano não trava);
 * - renova a cada 20 s enquanto há atividade; solta ao sair do passo, no blur com debounce de 5 s e no pagehide;
 * - o passo travado por outra pessoa fica somente leitura; "Assumir" aparece depois do TTL (ou ocioso)
 *   e simplesmente tenta adquirir de novo: se a outra pessoa ainda está ativa o servidor recusa.
 * - operações estruturais não passam por aqui (o servidor as isenta).
 */
export const LOCK_TTL_MS = 60_000;
export const LOCK_RENEW_MS = 20_000;
export const LOCK_BLUR_RELEASE_MS = 5_000;

export function createLockManager({
  selfId: initialSelfId,
  acquire, // (stepId) => Promise<{ok, holder?:{userId,name}}>
  release, // (stepId) => Promise
  onChange = () => {},
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  ttlMs = LOCK_TTL_MS,
  renewMs = LOCK_RENEW_MS,
  blurReleaseMs = LOCK_BLUR_RELEASE_MS,
} = {}) {
  let selfId = initialSelfId;
  const mine = new Map(); // stepId → { renewTimer, active, since }
  const others = new Map(); // stepId → { userId, name, seenAt }
  const releaseTimers = new Map();
  const acquiring = new Map();

  const emit = () => onChange();

  function scheduleRenew(stepId) {
    const m = mine.get(stepId);
    if (!m) return;
    clearTimer(m.renewTimer);
    m.renewTimer = setTimer(async () => {
      const cur = mine.get(stepId);
      if (!cur) return;
      if (!cur.active) {
        // sem atividade desde a última renovação: deixa expirar sozinho (não renova lock de aba parada)
        await dropMine(stepId, { remote: true });
        return;
      }
      cur.active = false;
      const res = await acquire(stepId).catch(() => ({ ok: false, error: "network" }));
      if (res?.ok) scheduleRenew(stepId);
      else if (res?.holder) {
        mine.delete(stepId);
        others.set(stepId, { userId: res.holder.userId, name: res.holder.name || "", seenAt: now() });
        emit();
      } else scheduleRenew(stepId); // rede: tenta de novo na próxima janela
    }, renewMs);
    m.renewTimer?.unref?.();
  }

  async function dropMine(stepId, { remote = false } = {}) {
    const m = mine.get(stepId);
    if (!m) return;
    clearTimer(m.renewTimer);
    mine.delete(stepId);
    emit();
    if (remote) await release(stepId).catch(() => {});
  }

  /** Atividade no passo (primeiro input, digitação). */
  async function touch(stepId) {
    if (!stepId) return { ok: true };
    const rt = releaseTimers.get(stepId);
    if (rt) {
      clearTimer(rt);
      releaseTimers.delete(stepId);
    }
    const m = mine.get(stepId);
    if (m) {
      m.active = true;
      return { ok: true, held: true };
    }
    const other = others.get(stepId);
    if (other && other.userId !== selfId) return { ok: false, holder: other };
    if (acquiring.has(stepId)) return acquiring.get(stepId);
    const p = (async () => {
      try {
        const res = await acquire(stepId);
        if (res?.ok) {
          mine.set(stepId, { renewTimer: null, active: true, since: now() });
          others.delete(stepId);
          scheduleRenew(stepId);
          emit();
          return { ok: true };
        }
        if (res?.holder) {
          others.set(stepId, { userId: res.holder.userId, name: res.holder.name || "", seenAt: now() });
          emit();
          return { ok: false, holder: res.holder };
        }
        return { ok: true, offline: true }; // sem rede/limite: não trava a digitação
      } catch {
        return { ok: true, offline: true };
      } finally {
        acquiring.delete(stepId);
      }
    })();
    acquiring.set(stepId, p);
    return p;
  }

  /** Saiu do passo: solta na hora. */
  function leave(stepId) {
    const rt = releaseTimers.get(stepId);
    if (rt) clearTimer(rt);
    releaseTimers.delete(stepId);
    return dropMine(stepId, { remote: true });
  }

  /** Blur do campo: solta depois de um tempo, a menos que haja nova atividade. */
  function blur(stepId) {
    if (!mine.has(stepId) || releaseTimers.has(stepId)) return;
    const id = setTimer(() => {
      releaseTimers.delete(stepId);
      void dropMine(stepId, { remote: true });
    }, blurReleaseMs);
    id?.unref?.();
    releaseTimers.set(stepId, id);
  }

  /** Locks do `state` do servidor. */
  function applyRemote(list = []) {
    const t = now();
    const next = new Map();
    for (const l of list) {
      if (l.userId === selfId) {
        if (!mine.has(l.stepId)) mine.set(l.stepId, { renewTimer: null, active: false, since: t });
        continue;
      }
      const prev = others.get(l.stepId);
      next.set(l.stepId, prev && prev.userId === l.userId ? { ...prev, name: l.name || prev.name } : { userId: l.userId, name: l.name || "", seenAt: t });
    }
    // lock meu que o servidor não lista mais: expirou
    for (const id of [...mine.keys()]) {
      if (!list.some((l) => l.stepId === id && l.userId === selfId) && !acquiring.has(id)) {
        clearTimer(mine.get(id).renewTimer);
        mine.delete(id);
      }
    }
    others.clear();
    for (const [k, v] of next) others.set(k, v);
    emit();
  }

  const holderOf = (stepId) => {
    const o = others.get(stepId);
    return o && o.userId !== selfId ? o : null;
  };

  return {
    touch, leave, blur, applyRemote,
    setSelf(id) { selfId = id; },
    holderOf,
    isLockedByOther: (stepId) => Boolean(holderOf(stepId)),
    holdsLock: (stepId) => mine.has(stepId),
    /** "Assumir": só depois do TTL desde que vimos o lock (o servidor recusa se ainda estiver vivo). */
    canTakeOver(stepId) {
      const o = holderOf(stepId);
      return Boolean(o && now() - o.seenAt >= ttlMs);
    },
    async takeOver(stepId) {
      others.delete(stepId);
      return touch(stepId);
    },
    mineIds: () => [...mine.keys()],
    othersMap: () => new Map(others),
    async releaseAll() {
      for (const id of [...mine.keys()]) await leave(id);
    },
    destroy() {
      for (const m of mine.values()) clearTimer(m.renewTimer);
      for (const t of releaseTimers.values()) clearTimer(t);
      mine.clear();
      others.clear();
    },
  };
}
