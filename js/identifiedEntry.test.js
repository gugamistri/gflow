import assert from "node:assert/strict";
import test from "node:test";
import {
  consumeEntryToken,
  entryResult,
  markNoticeSeen,
  noticeAlreadySeen,
  privacyNoticeUrl,
  readEntryToken,
  stripEntryParam,
} from "./identifiedEntry.js";
import { createViewTracker, shouldTrack } from "./viewAnalytics.js";
import { planLeadProntoSave, normalizeLeadPronto, LP_EVENT_TYPES } from "./leadPronto.js";
import { normalizeWebhook, webhookSaveBody } from "./leadWebhook.js";

const TOKEN = "v1.eyJpaWQiOiJ4In0.c2lnbmF0dXJl";

test("readEntryToken: só o formato v1.<b64url>.<b64url>", () => {
  assert.equal(readEntryToken(`?lp=${TOKEN}`), TOKEN);
  assert.equal(readEntryToken(`?embed=1&lp=${TOKEN}&x=2`), TOKEN);
  assert.equal(readEntryToken("?lp=v2.a.b"), null);
  assert.equal(readEntryToken("?lp=v1.a=.b"), null);
  assert.equal(readEntryToken("?lp=v1.a+b.c"), null);
  assert.equal(readEntryToken(`?lp=v1.${"a".repeat(2100)}.b`), null);
  assert.equal(readEntryToken(""), null);
});

test("stripEntryParam / consumeEntryToken: tira o lp da barra e mantém o resto", () => {
  assert.equal(stripEntryParam(`https://guiaflow.pro/p/x?lp=${TOKEN}&utm_source=lp#a`), "/p/x?utm_source=lp#a");
  assert.equal(stripEntryParam(`https://guiaflow.pro/p/x?lp=${TOKEN}`), "/p/x");
  assert.equal(stripEntryParam("https://guiaflow.pro/p/x?embed=1"), null);
  const calls = [];
  const loc = { search: `?lp=${TOKEN}&embed=1`, href: `https://guiaflow.pro/p/x?lp=${TOKEN}&embed=1` };
  const hist = { state: null, replaceState: (...args) => calls.push(args) };
  assert.equal(consumeEntryToken(loc, hist), TOKEN);
  assert.deepEqual(calls, [[null, "", "/p/x?embed=1"]]);
  // lp inválido também sai da barra, mas não vira token
  const bad = [];
  assert.equal(consumeEntryToken({ search: "?lp=lixo", href: "https://guiaflow.pro/p/x?lp=lixo" }, { replaceState: (...a) => bad.push(a) }), null);
  assert.equal(bad[0][2], "/p/x");
});

test("shouldTrack: DNT/GPC só são ignorados na entrada identificada", () => {
  const base = { kind: "permanent", cloudEnabled: true, flags: { analytics: true }, search: "" };
  assert.equal(shouldTrack({ ...base, dnt: "1" }), false);
  assert.equal(shouldTrack({ ...base, gpc: true }), false);
  assert.equal(shouldTrack({ ...base, dnt: "1", identified: "yes" }), false, "só true literal");
  assert.equal(shouldTrack({ ...base, dnt: "1", gpc: true, identified: true }), true);
  assert.equal(shouldTrack({ ...base, identified: true, search: "?preview=1" }), false, "preview continua fora");
  assert.equal(shouldTrack({ ...base, identified: true, flags: { analytics: false } }), false);
  assert.equal(shouldTrack({ ...base, identified: true, kind: "temporary" }), false);
});

test("createViewTracker usa o sessionId dado pela entrada identificada", () => {
  const sent = [];
  const tracker = createViewTracker({ send: (body) => sent.push(body), sessionId: "11111111-2222-4333-8444-555555555555", setTimer: () => 1, clearTimer: () => {} });
  assert.equal(tracker.sessionId, "11111111-2222-4333-8444-555555555555");
  const anon = createViewTracker({ send: () => {}, uuid: () => "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", setTimer: () => 1, clearTimer: () => {} });
  assert.equal(anon.sessionId, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
});

test("entryResult e aviso único", () => {
  assert.deepEqual(entryResult({ ok: true, data: { identified: true, source: "api", company: " ACME " } }), { identified: true, source: "api", company: "ACME" });
  assert.equal(entryResult({ ok: true, data: { identified: false, reason: "expired" } }), null);
  assert.equal(entryResult({ ok: false, data: { identified: true } }), null);
  assert.equal(privacyNoticeUrl("pt-BR"), "/privacidade#treinamento-identificado");
  assert.equal(privacyNoticeUrl("en"), "/en/privacy#treinamento-identificado");
  assert.equal(privacyNoticeUrl("es"), "/es/privacidad#treinamento-identificado");
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(noticeAlreadySeen(storage, "tour"), false);
  markNoticeSeen(storage, "tour");
  assert.equal(noticeAlreadySeen(storage, "tour"), true);
  assert.equal(noticeAlreadySeen(storage, "outro"), false);
  assert.equal(noticeAlreadySeen({ getItem() { throw new Error("x"); } }, "tour"), false);
});

test("LeadPronto no editor: tipos por conexão e status da chave de entrada", () => {
  const all = normalizeLeadPronto({ leadpronto: { status: "connected", events: LP_EVENT_TYPES, entryKey: { kid: "ek_1", createdAt: "2026-11-04T12:00:00Z", delivery: { status: "delivered", deliveredAt: "2026-11-04T12:00:05Z", attempts: 1 } } } });
  assert.deepEqual(all.events, LP_EVENT_TYPES);
  assert.equal(all.entryKey.kid, "ek_1");
  assert.equal(all.entryKey.state, "delivered");
  assert.equal(JSON.stringify(all).includes("gfek_"), false);
  assert.deepEqual(normalizeLeadPronto({ leadpronto: { status: "connected" } }).events, LP_EVENT_TYPES, "sem events = todos");
  assert.equal(planLeadProntoSave({ allTours: true, events: [...LP_EVENT_TYPES] }).body.events, null);
  assert.deepEqual(planLeadProntoSave({ allTours: true, events: ["session.completed", "lead.created"] }).body.events, ["lead.created", "session.completed"]);
  assert.equal("events" in planLeadProntoSave({ allTours: true }).body, false);
});

test("webhook no editor: session.* nos tipos e histórico das últimas 20", () => {
  const body = webhookSaveBody({ url: "https://x.example/h", enabled: true, events: ["session.progress", "lead.created", "nope"] });
  assert.deepEqual(body.events, ["lead.created", "session.progress"]);
  assert.deepEqual(webhookSaveBody({ url: "https://x.example/h", events: [] }).events, ["lead.created"]);
  const rows = Array.from({ length: 25 }, (_, i) => ({ msgId: `evt_${i}`, eventType: "session.progress", status: i % 2 ? "delivered" : "failed", lastStatus: i % 2 ? 204 : 500, createdAt: "2026-11-04T12:00:00Z" }));
  const hook = normalizeWebhook({ webhook: { url: "https://x.example/h", events: ["session.started"] }, deliveries: rows });
  assert.equal(hook.history.length, 20);
  assert.deepEqual(hook.history[1], { id: "evt_1", eventType: "session.progress", state: "delivered", attempts: 0, httpStatus: 204, error: "", at: "2026-11-04T12:00:00Z" });
  assert.deepEqual(hook.events, ["session.started"]);
});
