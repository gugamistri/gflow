/**
 * Transporte da colaboração (cliente): polling de `state` com ETag/304, envio de ops, presença e locks.
 * Sem DOM. `request(path, init)` é o `cloudFetch` ({ ok, status, error, data }).
 * Intervalos: 3 s com a aba visível, 15 s em segundo plano; presença no máximo a cada ~3,5 s
 * (o servidor limita a 1 por 3 s). Falha de rede → offline com recuo até 15 s; ao voltar, o
 * `state` traz `resync` se o log de eventos não cobre o intervalo.
 */
export const POLL_ACTIVE_MS = 3_000;
export const POLL_HIDDEN_MS = 15_000;
export const PRESENCE_EVERY_MS = 3_500;
const BACKOFF = [3_000, 6_000, 10_000, 15_000];

export function createCollabClient({
  request,
  projectId,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  isHidden = () => (typeof document !== "undefined" ? document.visibilityState === "hidden" : false),
  getStep = () => null,
  getField = () => null,
  handlers = {},
} = {}) {
  const base = `/projects/${encodeURIComponent(projectId)}/collab`;
  let seq = null;
  let etag = "";
  let timer = null;
  let running = false;
  let online = true;
  let failures = 0;
  let lastPresenceAt = 0;
  let polling = false;
  let lastRole = null;
  const h = (name, ...args) => {
    try { return handlers[name]?.(...args); } catch (err) { console.error(err); return undefined; }
  };

  function setOnline(value) {
    if (online === value) return;
    online = value;
    h("onOnline", value);
  }

  /** Erros que encerram a sessão colaborativa deste projeto. */
  function terminal(res) {
    if (res.status === 404 || res.status === 403 || res.status === 401) {
      h("onAccessLost", { status: res.status, error: res.error });
      stop();
      return true;
    }
    return false;
  }

  async function pollOnce() {
    if (polling) return { skipped: true };
    polling = true;
    try {
      const qs = seq == null ? "" : `?since=${seq}`;
      const headers = etag && seq != null ? { "If-None-Match": etag } : undefined;
      const res = await request(`${base}/state${qs}`, { method: "GET", ...(headers ? { headers } : {}), timeoutMs: 15_000 });
      if (res.status === 304) {
        failures = 0;
        setOnline(true);
        return { unchanged: true };
      }
      if (!res.ok) {
        if (res.status === 429) return { limited: true, retryMs: Math.max(1, Number(res.data?.retryAfterSec) || 3) * 1000 };
        if (terminal(res)) return { terminal: true };
        if (res.status === 402) h("onReadOnly", res.error);
        if (!res.status || res.status >= 500 || res.error === "network" || res.error === "timeout") {
          failures += 1;
          setOnline(false);
          return { offline: true };
        }
        return { error: res.error };
      }
      failures = 0;
      setOnline(true);
      const data = res.data || {};
      etag = data.etag || "";
      if (data.role && data.role !== lastRole) {
        lastRole = data.role;
        h("onRole", data.role);
      }
      if (data.cseq != null) h("onCseq", data.cseq);
      // presença e locks antes das mudanças: o toast sabe se quem editou ainda está com o passo travado
      h("onPresence", data.presence || []);
      h("onLocks", data.locks || []);
      if (data.resync) {
        seq = data.seq;
        await h("onResync", data);
      } else {
        const events = Array.isArray(data.events) ? data.events : [];
        seq = data.seq;
        if (events.length) await h("onEvents", events);
      }
      return { ok: true, resync: Boolean(data.resync), seq };
    } finally {
      polling = false;
    }
  }

  async function sendPresence({ force = false } = {}) {
    const t = now();
    if (!force && t - lastPresenceAt < PRESENCE_EVERY_MS) return null;
    lastPresenceAt = t;
    const res = await request(`${base}/presence`, { method: "POST", body: JSON.stringify({ stepId: getStep(), field: getField() }), timeoutMs: 8_000 });
    if (res.ok) h("onEffectiveRole", { role: res.data?.role, effectiveRole: res.data?.effectiveRole, downgraded: Boolean(res.data?.downgraded) });
    else if (!terminal(res) && res.status !== 429) setOnline(false);
    return res;
  }

  async function tick() {
    timer = null;
    if (!running) return;
    let delay = isHidden() ? POLL_HIDDEN_MS : POLL_ACTIVE_MS;
    try {
      const r = await pollOnce();
      if (r.limited) delay = Math.max(delay, r.retryMs);
      if (r.offline) delay = BACKOFF[Math.min(failures - 1, BACKOFF.length - 1)] || POLL_HIDDEN_MS;
      if (running && online && !isHidden()) await sendPresence();
    } catch (err) {
      console.error(err);
    }
    if (running) {
      timer = setTimer(tick, delay);
      timer?.unref?.();
    }
  }

  function start() {
    if (running) return;
    running = true;
    seq = null;
    etag = "";
    void tick();
  }

  function stop() {
    running = false;
    clearTimer(timer);
    timer = null;
  }

  /** Acorda o polling já (aba voltou ao foco, enviou ops). */
  function nudge() {
    if (!running) return;
    clearTimer(timer);
    timer = null;
    void tick();
  }

  async function sendOps(ops) {
    const res = await request(`${base}/ops`, { method: "POST", body: JSON.stringify({ ops }), timeoutMs: 30_000 });
    if (res.ok) {
      setOnline(true);
      if (Number.isFinite(res.data?.seq)) etag = ""; // o state seguinte traz os eventos (inclusive os meus, que a UI ignora por `by`)
      return { ok: true, ...res.data };
    }
    if (res.status === 429) return { ok: false, limited: true, retryMs: Math.max(1, Number(res.data?.retryAfterSec) || 3) * 1000 };
    if (res.status === 402) return { ok: false, readOnly: true, error: res.error };
    if (res.status === 403 || res.status === 404 || res.status === 401) {
      terminal(res);
      return { ok: false, denied: true, status: res.status, error: res.data?.error || res.error };
    }
    if (res.status === 409) return { ok: false, error: res.data?.error || res.error, editorLimit: (res.data?.error || res.error) === "editor_limit" };
    if (!res.status || res.status >= 500 || res.error === "network" || res.error === "timeout") setOnline(false);
    return { ok: false, network: !res.status || res.status >= 500, error: res.error };
  }

  async function acquireLock(stepId) {
    const res = await request(`${base}/locks`, { method: "POST", body: JSON.stringify({ stepId }), timeoutMs: 8_000 });
    if (res.ok) return { ok: true };
    if (res.status === 409 && (res.data?.error || res.error) === "locked_by") return { ok: false, holder: res.data?.holder || null };
    if (res.status === 409) return { ok: false, error: res.data?.error || res.error };
    return { ok: false, error: res.error || "network" };
  }

  const releaseLock = (stepId) => request(`${base}/locks/${encodeURIComponent(stepId)}`, { method: "DELETE", timeoutMs: 8_000 });
  const members = () => request(`${base}/members`, { method: "GET" });
  const leavePresence = () => request(`${base}/presence`, { method: "DELETE", timeoutMs: 4_000 });

  return {
    start, stop, nudge, pollOnce, sendOps, sendPresence, acquireLock, releaseLock, members, leavePresence,
    isOnline: () => online,
    isRunning: () => running,
    seq: () => seq,
  };
}
