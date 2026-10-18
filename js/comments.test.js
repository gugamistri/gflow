import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  COMMENT_MAX, applyMention, commentSegments, countLinks, createCommentsClient, errorKey, fieldThreads, filterMembers, filterThreads,
  groupThreads, mentionQuery, mentionedIds, newFromOthers, openCountForStep, parseCommentLink, safeHref, validateDraft,
} from "./comments.js";
import { COMMENTS_STRINGS } from "./commentsI18n.js";

test("texto do comentário vira pedaços sem interpretar HTML; links só http(s)", () => {
  const segs = commentSegments('<img src=x onerror=alert(1)> veja https://guiaflow.pro/x, ok javascript:alert(1) http://a.com).', []);
  assert.equal(segs.map((s) => s.value).join(""), '<img src=x onerror=alert(1)> veja https://guiaflow.pro/x, ok javascript:alert(1) http://a.com).');
  const links = segs.filter((s) => s.type === "link");
  assert.deepEqual(links.map((l) => l.href), ["https://guiaflow.pro/x", "http://a.com/"]);
  assert.ok(segs.every((s) => s.type !== "link" || /^https?:\/\//.test(s.href)));
  assert.equal(safeHref("javascript:alert(1)"), "");
  assert.equal(safeHref("data:text/html,x"), "");
  assert.equal(safeHref("https://a.com"), "https://a.com/");
  assert.equal(countLinks("a http://x.com b https://y.com"), 2);
});

test("menções: só com o nome exato e na borda de palavra", () => {
  const segs = commentSegments("oi @Ana Souza e @Bia, veja email@Ana e @Anabela", ["Ana Souza", "Bia", "Ana"]);
  const m = segs.filter((s) => s.type === "mention").map((s) => s.value);
  assert.deepEqual(m, ["@Ana Souza", "@Bia"]);
  assert.equal(segs.map((s) => s.value).join(""), "oi @Ana Souza e @Bia, veja email@Ana e @Anabela");
  const members = [{ userId: "a", name: "Ana Souza" }, { userId: "b", name: "Bia" }, { userId: "me", name: "Eu" }];
  assert.deepEqual(mentionedIds("oi @Ana Souza e @Bia @Eu @Ana Souza", members, "me"), ["a", "b"]);
  assert.deepEqual(mentionedIds("sem menção", members, "me"), []);
});

test("autocomplete de menção: consulta, filtro e inserção", () => {
  assert.deepEqual(mentionQuery("oi @An", 6), { start: 3, query: "An" });
  assert.equal(mentionQuery("oi a@b", 6), null);
  assert.equal(mentionQuery("oi @An ", 7), null);
  assert.deepEqual(mentionQuery("@", 1), { start: 0, query: "" });
  const members = [{ userId: "a", name: "Ana" }, { userId: "b", name: "Bruno" }, { userId: "c", name: "Joana" }, { userId: "me", name: "Anita" }];
  assert.deepEqual(filterMembers(members, "an", "me").map((m) => m.name), ["Ana", "Joana"]);
  const st = mentionQuery("oi @An fim", 6);
  const r = applyMention("oi @An fim", st, "Ana", 6);
  assert.equal(r.value, "oi @Ana fim");
  assert.equal(r.caret, 8);
});

test("validação local do rascunho", () => {
  assert.equal(validateDraft(""), "invalid_body");
  assert.equal(validateDraft("   "), "invalid_body");
  assert.equal(validateDraft("a".repeat(COMMENT_MAX + 1)), "body_too_long");
  assert.equal(validateDraft("<b>x</b>"), "html_not_allowed");
  assert.equal(validateDraft("1 < 2 e 3 > 2"), "");
  assert.equal(validateDraft("http://a.co http://b.co http://c.co http://d.co"), "too_many_links");
  assert.equal(validateDraft("ok"), "");
});

const th = (id, over = {}) => ({ id, stepId: "s1", fieldKey: null, status: "open", orphaned: false, createdBy: { id: "u1" }, comments: [{ id: `${id}c`, author: { id: "u1" }, deleted: false }], ...over });

test("agrupar por passo na ordem do projeto; órfãs e projeto inteiro no fim; filtros", () => {
  const list = [th("a", { stepId: "s2" }), th("b", { stepId: "s1" }), th("c", { stepId: null }), th("d", { stepId: "gone", orphaned: true }), th("e", { stepId: "s1", status: "resolved" })];
  const groups = groupThreads(list, ["s1", "s2"]);
  assert.deepEqual(groups.map((g) => g.kind), ["step", "step", "project", "orphan"]);
  assert.deepEqual(groups.map((g) => g.n), [1, 2, 0, 0]);
  assert.deepEqual(filterThreads(list, "open", "x").map((t) => t.id), ["a", "b", "c", "d"]);
  assert.deepEqual(filterThreads(list, "resolved", "x").map((t) => t.id), ["e"]);
  assert.deepEqual(filterThreads(list, "mine", "u1").length, 5);
  assert.deepEqual(filterThreads(list, "mine", "zz").length, 0);
  assert.equal(openCountForStep({ byStep: { s1: { open: 2 } } }, "s1"), 2);
  assert.equal(openCountForStep({}, "s1"), 0);
  assert.deepEqual(fieldThreads(list, "s1", "title"), []);
  assert.deepEqual(fieldThreads([th("f", { fieldKey: "title" })], "s1", "title").map((t) => t.id), ["f"]);
});

test("toast: só comentários novos de outras pessoas, e se é o primeiro da conversa", () => {
  const prev = [th("a")];
  const next = [
    th("a", { comments: [{ id: "ac", author: { id: "u1" } }, { id: "ac2", author: { id: "u2" } }, { id: "ac3", author: { id: "me" } }] }),
    th("b", { comments: [{ id: "bc", author: { id: "u3" } }] }),
    th("c", { comments: [{ id: "cc", author: { id: "u4" }, deleted: true }] }),
  ];
  const fresh = newFromOthers(prev, next, "me");
  assert.deepEqual(fresh.map((f) => [f.comment.id, f.first]), [["ac2", false], ["bc", true]]);
  assert.deepEqual(newFromOthers(null, [], "me"), []);
});

test("link do e-mail e chaves de erro", () => {
  assert.deepEqual(parseCommentLink("#/comments/p1/t1"), { projectId: "p1", threadId: "t1" });
  assert.deepEqual(parseCommentLink("#/comments/p1"), { projectId: "p1", threadId: null });
  assert.equal(parseCommentLink("#/comments/../x"), null);
  assert.equal(parseCommentLink("#/join/abc"), null);
  assert.equal(errorKey({ status: 402, data: { error: "owner_subscription_required" } }), "comments.errors.owner_subscription_required");
  assert.equal(errorKey({ status: 0, error: "network" }), "comments.errors.network");
  assert.equal(errorKey({ status: 502, data: {} }), "comments.errors.network");
});

test("cliente de rede: caminhos e corpos", async () => {
  const calls = [];
  const request = async (path, init) => { calls.push([init.method, path, init.body ? JSON.parse(init.body) : null]); return { ok: true, status: 200, data: {} }; };
  const api = createCommentsClient({ request, projectId: "p 1" });
  await api.list("all");
  await api.createThread({ body: "x", stepId: "s1" });
  await api.reply("t1", { body: "r" });
  await api.edit("c1", { body: "e" });
  await api.remove("c1");
  await api.resolve("t1");
  await api.reopen("t1");
  await api.markRead("t1");
  await api.setPrefs(true);
  assert.deepEqual(calls.map((c) => `${c[0]} ${c[1]}`), [
    "GET /projects/p%201/comments/threads?status=all",
    "POST /projects/p%201/comments/threads",
    "POST /projects/p%201/comments/threads/t1/comments",
    "PATCH /projects/p%201/comments/comments/c1",
    "DELETE /projects/p%201/comments/comments/c1",
    "POST /projects/p%201/comments/threads/t1/resolve",
    "POST /projects/p%201/comments/threads/t1/reopen",
    "POST /projects/p%201/comments/threads/t1/read",
    "PUT /projects/p%201/comments/prefs",
  ]);
  assert.deepEqual(calls[8][2], { emailMuted: true });
});

test("i18n: pt, en e es têm as mesmas chaves e os mesmos {marcadores}", () => {
  const keys = (l) => Object.keys(COMMENTS_STRINGS[l]).sort();
  assert.deepEqual(keys("en"), keys("pt"));
  assert.deepEqual(keys("es"), keys("pt"));
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  for (const k of keys("pt")) {
    assert.equal(vars(COMMENTS_STRINGS.en[k]), vars(COMMENTS_STRINGS.pt[k]), k);
    assert.equal(vars(COMMENTS_STRINGS.es[k]), vars(COMMENTS_STRINGS.pt[k]), k);
    assert.ok(COMMENTS_STRINGS.pt[k].trim(), k);
  }
});

test("UI: os textos do usuário nunca passam por innerHTML e o CSS está ligado ao editor", () => {
  const ui = readFileSync(new URL("./commentsUi.js", import.meta.url), "utf8");
  assert.equal(/innerHTML|insertAdjacentHTML|outerHTML|document\.write/.test(ui), false);
  const html = readFileSync(new URL("../editor.html", import.meta.url), "utf8");
  assert.match(html, /css\/comments\.css/);
});
