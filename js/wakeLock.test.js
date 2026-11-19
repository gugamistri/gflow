import assert from "node:assert/strict";
import test from "node:test";
import { createTourWakeLock, TOUR_WAKE_LOCK_IDLE_MS } from "./wakeLock.js";

function fakeTimers() {
  let t = 0;
  let id = 0;
  const timers = new Map();
  return {
    now: () => t,
    setTimer: (fn, ms) => {
      id += 1;
      timers.set(id, { at: t + ms, fn });
      return id;
    },
    clearTimer: (i) => timers.delete(i),
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        const next = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        t = next[1].at;
        timers.delete(next[0]);
        await next[1].fn();
      }
      t = end;
    },
  };
}

function createSentinel() {
  const listeners = new Set();
  const s = {
    released: false,
    addEventListener(type, fn) {
      if (type === "release") listeners.add(fn);
    },
    removeEventListener(type, fn) {
      if (type === "release") listeners.delete(fn);
    },
    async release() {
      if (s.released) return;
      s.released = true;
      for (const fn of [...listeners]) fn();
    },
    _listeners: listeners,
  };
  return s;
}

function mockEnv({ request, visibility = "visible" } = {}) {
  const ft = fakeTimers();
  const docListeners = new Map();
  const winListeners = new Map();
  const document = {
    visibilityState: visibility,
    addEventListener(type, fn) {
      const set = docListeners.get(type) || new Set();
      set.add(fn);
      docListeners.set(type, set);
    },
    removeEventListener(type, fn) {
      docListeners.get(type)?.delete(fn);
    },
    dispatch(type) {
      for (const fn of [...(docListeners.get(type) || [])]) fn();
    },
  };
  const window = {
    addEventListener(type, fn) {
      const set = winListeners.get(type) || new Set();
      set.add(fn);
      winListeners.set(type, set);
    },
    removeEventListener(type, fn) {
      winListeners.get(type)?.delete(fn);
    },
    dispatch(type) {
      for (const fn of [...(winListeners.get(type) || [])]) fn();
    },
    _has(type) {
      return (winListeners.get(type)?.size || 0) > 0;
    },
  };
  const sentinels = [];
  const calls = [];
  const wakeLock = {
    request: async (type) => {
      calls.push(type);
      if (typeof request === "function") return request(type, calls, sentinels);
      const s = createSentinel();
      sentinels.push(s);
      return s;
    },
  };
  return { ft, document, window, wakeLock, sentinels, calls };
}

function makeLock(env, opts = {}) {
  return createTourWakeLock({
    wakeLock: env.wakeLock,
    document: env.document,
    window: env.window,
    setTimer: env.ft.setTimer,
    clearTimer: env.ft.clearTimer,
    ...opts,
  });
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

test("ociosidade padrão é 3 minutos", () => {
  assert.equal(TOUR_WAKE_LOCK_IDLE_MS, 3 * 60 * 1000);
});

test("start pede o lock 'screen' quando a aba está visível", async () => {
  const env = mockEnv();
  const lock = makeLock(env);
  lock.start();
  await flush();
  assert.deepEqual(env.calls, ["screen"]);
  assert.equal(lock.active, true);
  assert.equal(lock.held, true);
  assert.equal(env.sentinels.length, 1);
  assert.equal(env.sentinels[0].released, false);
});

test("sem API, start não quebra e não segura nada", async () => {
  const env = mockEnv();
  const lock = makeLock(env, { wakeLock: undefined });
  assert.doesNotThrow(() => lock.start());
  await flush();
  assert.equal(lock.active, true);
  assert.equal(lock.held, false);
  assert.equal(env.calls.length, 0);
  lock.stop();
  assert.equal(lock.active, false);
});

test("NotAllowedError (e qualquer recusa) falha em silêncio", async () => {
  const env = mockEnv({
    request: async () => {
      const err = new Error("blocked");
      err.name = "NotAllowedError";
      throw err;
    },
  });
  const lock = makeLock(env);
  lock.start();
  await flush();
  assert.equal(env.calls.length, 1);
  assert.equal(lock.held, false);
  assert.equal(lock.active, true);
});

test("stop solta o sentinel e não pede de novo", async () => {
  const env = mockEnv();
  const lock = makeLock(env);
  lock.start();
  await flush();
  const s = env.sentinels[0];
  lock.stop();
  await flush();
  assert.equal(s.released, true);
  assert.equal(lock.held, false);
  assert.equal(lock.active, false);
  env.document.visibilityState = "visible";
  env.document.dispatch("visibilitychange");
  env.window.dispatch("pointerdown");
  await flush();
  assert.equal(env.calls.length, 1);
  assert.equal(env.window._has("pointerdown"), false);
});

test("aba oculta solta; visível de novo pede outra vez se o tour segue ativo", async () => {
  const env = mockEnv();
  const lock = makeLock(env);
  lock.start();
  await flush();
  const first = env.sentinels[0];
  env.document.visibilityState = "hidden";
  env.document.dispatch("visibilitychange");
  await flush();
  assert.equal(first.released, true);
  assert.equal(lock.held, false);
  assert.equal(lock.active, true);
  env.document.visibilityState = "visible";
  env.document.dispatch("visibilitychange");
  await flush();
  assert.equal(env.calls.length, 2);
  assert.equal(lock.held, true);
  assert.equal(env.sentinels[1].released, false);
});

test("evento release do sentinel zera o held; visibility visível pede de novo", async () => {
  const env = mockEnv();
  const lock = makeLock(env);
  lock.start();
  await flush();
  const first = env.sentinels[0];
  // why: o navegador solta sozinho (ex.: aba oculta); só o evento chega
  await first.release();
  assert.equal(lock.held, false);
  env.document.visibilityState = "visible";
  env.document.dispatch("visibilitychange");
  await flush();
  assert.equal(env.calls.length, 2);
  assert.equal(lock.held, true);
});

test("depois de 3 min sem interação, solta; interação visível pede de novo", async () => {
  const env = mockEnv();
  const lock = makeLock(env);
  lock.start();
  await flush();
  const first = env.sentinels[0];
  await env.ft.advance(TOUR_WAKE_LOCK_IDLE_MS - 1);
  assert.equal(lock.held, true);
  await env.ft.advance(1);
  assert.equal(first.released, true);
  assert.equal(lock.held, false);
  assert.equal(lock.idle, true);
  assert.equal(lock.active, true);
  // still visible: no auto re-acquire until interaction
  env.document.dispatch("visibilitychange");
  await flush();
  assert.equal(env.calls.length, 1);
  env.window.dispatch("pointerdown");
  await flush();
  assert.equal(env.calls.length, 2);
  assert.equal(lock.held, true);
  assert.equal(lock.idle, false);
});

test("touchstart, keydown e ping do passo reiniciam a ociosidade", async () => {
  const env = mockEnv();
  const lock = makeLock(env);
  lock.start();
  await flush();
  await env.ft.advance(TOUR_WAKE_LOCK_IDLE_MS - 1);
  env.window.dispatch("touchstart");
  await flush();
  await env.ft.advance(TOUR_WAKE_LOCK_IDLE_MS - 1);
  assert.equal(lock.held, true);
  assert.equal(env.sentinels[0].released, false);
  env.window.dispatch("keydown");
  await flush();
  await env.ft.advance(TOUR_WAKE_LOCK_IDLE_MS - 1);
  assert.equal(lock.held, true);
  lock.ping();
  await flush();
  await env.ft.advance(TOUR_WAKE_LOCK_IDLE_MS - 1);
  assert.equal(lock.held, true);
  await env.ft.advance(1);
  assert.equal(lock.held, false);
  assert.equal(env.calls.length, 1, "ainda era o mesmo lock; ping só atrasou a ociosidade");
});

test("start de novo no mesmo tour reinicia a ociosidade", async () => {
  const env = mockEnv();
  const lock = makeLock(env);
  lock.start();
  await flush();
  await env.ft.advance(TOUR_WAKE_LOCK_IDLE_MS - 1);
  lock.start();
  await flush();
  await env.ft.advance(TOUR_WAKE_LOCK_IDLE_MS - 1);
  assert.equal(lock.held, true);
  await env.ft.advance(1);
  assert.equal(lock.held, false);
  assert.equal(env.calls.length, 1);
});

test("start com a aba oculta não pede; ao voltar, pede", async () => {
  const env = mockEnv({ visibility: "hidden" });
  const lock = makeLock(env);
  lock.start();
  await flush();
  assert.equal(env.calls.length, 0);
  assert.equal(lock.held, false);
  assert.equal(lock.active, true);
  env.document.visibilityState = "visible";
  env.document.dispatch("visibilitychange");
  await flush();
  assert.equal(env.calls.length, 1);
  assert.equal(lock.held, true);
});

test("pedido em voo depois do stop é solto e não fica held", async () => {
  let release;
  const pending = new Promise((r) => {
    release = r;
  });
  const env = mockEnv({
    request: async () => {
      await pending;
      const s = createSentinel();
      env.sentinels.push(s);
      return s;
    },
  });
  const lock = makeLock(env);
  lock.start();
  lock.stop();
  release();
  await flush();
  await flush();
  assert.equal(lock.held, false);
  assert.equal(lock.active, false);
  assert.equal(env.sentinels.length, 1);
  assert.equal(env.sentinels[0].released, true);
});

test("pedido em voo com a aba já oculta é solto", async () => {
  let release;
  const pending = new Promise((r) => {
    release = r;
  });
  const env = mockEnv({
    request: async () => {
      await pending;
      const s = createSentinel();
      env.sentinels.push(s);
      return s;
    },
  });
  const lock = makeLock(env);
  lock.start();
  env.document.visibilityState = "hidden";
  env.document.dispatch("visibilitychange");
  release();
  await flush();
  await flush();
  assert.equal(lock.held, false);
  assert.equal(lock.active, true);
  assert.equal(env.sentinels[0].released, true);
});
