import assert from "node:assert/strict";
import test from "node:test";
import {
  chunkEvents,
  createViewTracker,
  ctaFromAction,
  deviceKind,
  privacySignal,
  shortLocale,
  shouldTrack,
  trafficSource,
  uuidV4,
} from "./viewAnalytics.js";
import { CLOUD_EVENTS_PATH } from "./cloudConfig.js";

const base = { kind: "permanent", cloudEnabled: true, flags: { analytics: true }, search: "" };

test("shouldTrack: só /p com Cloud; nada com DNT, GPC ou ?preview=1", () => {
  assert.equal(shouldTrack(base), true);
  assert.equal(shouldTrack({ ...base, kind: "temporary" }), false);
  assert.equal(shouldTrack({ ...base, cloudEnabled: false }), false);
  assert.equal(shouldTrack({ ...base, flags: { analytics: false } }), false);
  assert.equal(shouldTrack({ ...base, dnt: "1" }), false);
  assert.equal(shouldTrack({ ...base, windowDnt: "1" }), false);
  assert.equal(shouldTrack({ ...base, msDnt: "1" }), false);
  assert.equal(shouldTrack({ ...base, dnt: "yes" }), false);
  assert.equal(shouldTrack({ ...base, gpc: true }), false);
  assert.equal(shouldTrack({ ...base, dnt: "0", gpc: false }), true);
  assert.equal(shouldTrack({ ...base, search: "?preview=1" }), false);
  assert.equal(privacySignal({ dnt: "unspecified" }), false);
});

test("trafficSource: só host do referrer e UTM; o próprio site não conta", () => {
  assert.deepEqual(trafficSource("https://www.linkedin.com/feed/?x=secret", "?utm_source=news&utm_medium=email&utm_campaign=out&email=a@b.c", "https://guiaflow.pro"), {
    referrerHost: "linkedin.com",
    utm_source: "news",
    utm_medium: "email",
    utm_campaign: "out",
  });
  assert.equal(trafficSource("https://guiaflow.pro/", "", "https://guiaflow.pro").referrerHost, null);
  assert.equal(trafficSource("javascript:alert(1)", "").referrerHost, null);
  assert.equal(trafficSource("", "?utm_source=" + "x".repeat(300)).utm_source.length, 100);
  assert.equal(deviceKind({ coarse: true, width: 1200 }), "mobile");
  assert.equal(deviceKind({ width: 1440 }), "desktop");
  assert.equal(shortLocale("pt-br"), "pt-BR");
  assert.equal(shortLocale("es"), "es");
  assert.match(uuidV4(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(CLOUD_EVENTS_PATH("meu-tour"), "/api/shares/meu-tour/events");
});

function harness(opts = {}) {
  let t = 0;
  const sent = [];
  const timers = [];
  const tracker = createViewTracker({
    send: (body, meta) => sent.push({ body: JSON.parse(body), beacon: Boolean(meta?.beacon) }),
    embed: opts.embed,
    source: { referrerHost: "wa.me" },
    device: "desktop",
    locale: "pt-BR",
    now: () => t,
    uuid: () => "11111111-2222-4333-8444-555555555555",
    setTimer: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    clearTimer: () => {},
  });
  return {
    tracker,
    sent,
    timers,
    advance: (ms) => {
      t += ms;
    },
    events: () => sent.flatMap((s) => s.body.events),
  };
}

test("ver 3 de 5 passos e fechar: tour_start, dwell por passo e exit", () => {
  const h = harness();
  h.tracker.onStep({ index: 0, stepId: "a", total: 5 });
  h.advance(1200);
  h.tracker.onStep({ index: 1, stepId: "b", total: 5 });
  h.advance(800);
  h.tracker.onStep({ index: 2, stepId: "c", total: 5 });
  h.advance(500);
  h.tracker.onExit({ index: 2, reason: "close" });
  const ev = h.events();
  assert.deepEqual(ev.map((e) => e.name), [
    "session_start", "tour_start", "step_view", "step_leave", "step_view", "step_leave", "step_view", "step_leave", "exit",
  ]);
  assert.deepEqual(ev.filter((e) => e.name === "step_leave").map((e) => [e.index, e.dwellMs]), [[0, 1200], [1, 800], [2, 500]]);
  assert.equal(ev.at(-1).reason, "close");
  assert.equal(h.sent[0].body.sessionId, "11111111-2222-4333-8444-555555555555");
  assert.equal(ev[0].referrerHost, "wa.me");
});

test("aba escondida pausa o tempo, manda por beacon; pagehide fecha o passo", () => {
  const h = harness();
  h.tracker.onStep({ index: 0, stepId: "a", total: 2 });
  h.advance(1000);
  h.tracker.visibility(true);
  assert.equal(h.sent.at(-1).beacon, true);
  h.advance(60_000);
  h.tracker.visibility(false);
  h.advance(500);
  h.tracker.pagehide();
  const leave = h.events().find((e) => e.name === "step_leave");
  assert.equal(leave.dwellMs, 1500);
  assert.equal(h.events().at(-1).reason, "pagehide");
  assert.equal(h.sent.at(-1).beacon, true);
});

test("conclusão, CTA e lead; replay acumula dwell; flush periódico", () => {
  const h = harness({ embed: true });
  h.tracker.lead("lead-123456");
  h.tracker.lead("lead-other");
  h.tracker.onStep({ index: 0, stepId: "a", total: 1 });
  h.advance(300);
  h.tracker.onComplete();
  h.tracker.ctaView();
  h.tracker.ctaClick(ctaFromAction({ kind: "whatsapp", href: "https://wa.me/55" }));
  h.tracker.onStep({ index: 0, stepId: "a", total: 1 });
  h.advance(200);
  h.tracker.onComplete();
  const ev = h.events();
  assert.equal(ev.filter((e) => e.name === "lead").length, 1);
  assert.equal(ev.filter((e) => e.name === "tour_start").length, 1);
  assert.deepEqual(ev.filter((e) => e.name === "step_leave").map((e) => e.dwellMs), [300, 500]);
  assert.deepEqual(ev.find((e) => e.name === "cta_click"), { name: "cta_click", slot: "primary", type: "whatsapp" });
  assert.equal(ev[0].embed, true);
  assert.equal(h.tracker.queue.length, 0);
  // o timer de 10 s esvazia a fila
  h.tracker.ctaView();
  h.timers.at(-1)();
  assert.equal(h.tracker.queue.length, 0);
});

test("ctaFromAction e chunkEvents (≤ 32 eventos / 16 KB)", () => {
  assert.deepEqual(ctaFromAction({ kind: "contact-link", href: "mailto:a@b.co" }), { slot: "secondary", type: "mailto" });
  assert.deepEqual(ctaFromAction({ kind: "contact-link", href: "https://x" }), { slot: "secondary", type: "url" });
  assert.deepEqual(ctaFromAction({ kind: "contact-form" }), { slot: "secondary", type: "form" });
  const many = Array.from({ length: 70 }, (_, i) => ({ name: "step_view", index: i }));
  const bodies = chunkEvents("s", many);
  assert.equal(bodies.length, 3);
  assert.ok(bodies.every((b) => JSON.parse(b).events.length <= 32 && b.length <= 16 * 1024));
});

test("o tracker não usa cookies nem storage", async () => {
  const src = (await import("node:fs")).readFileSync(new URL("./viewAnalytics.js", import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.equal(/document\.cookie|localStorage|sessionStorage|indexedDB/.test(code), false);
});

test("session_start carries text/audio/cc and lang_change is queued (RF28)", async () => {
  const { langFields } = await import("./viewAnalytics.js");
  assert.deepEqual(langFields(null), {});
  assert.deepEqual(langFields({ text: "es", audio: "none", cc: false }), { textLang: "es", audioLang: "none", cc: false });
  assert.deepEqual(langFields({ text: "<x>", audio: "", cc: "y" }), {});
  const t = createViewTracker({ send: () => {}, langs: { text: "pt-BR", audio: "pt-BR", cc: true }, setTimer: () => 0, clearTimer: () => {} });
  t.langChange({ text: "es", audio: "es", cc: true });
  const names = t.queue.map((e) => e.name);
  assert.equal(t.queue[0].textLang, "pt-BR");
  assert.ok(names.includes("lang_change"));
});
