import test from "node:test";
import assert from "node:assert/strict";
import {
  assignStepPositions, comparePos, createStableStepId, ensureUniqueStepIds, isCollabProject,
  posBetween, posesBetween, prepareProjectForCollab, sortStepsByPos,
} from "./collabSteps.js";

test("ids estáveis: formato, unicidade, duplicados e inválidos", () => {
  const ids = new Set(Array.from({ length: 500 }, createStableStepId));
  assert.equal(ids.size, 500);
  for (const id of ids) assert.match(id, /^step-[a-z0-9]{12}$/);
  const r = ensureUniqueStepIds([{ id: "a" }, { id: "a" }, {}, { id: "bad id!" }, { id: "b" }]);
  assert.equal(new Set(r.steps.map((s) => s.id)).size, 5);
  assert.equal(r.steps[0].id, "a");
  assert.equal(r.idMap["bad id!"], r.steps[3].id);
  assert.equal(ensureUniqueStepIds([{ id: "x" }, { id: "y" }]).changed, false);
});

test("ordem fracionária", () => {
  const a = posBetween(null, null);
  const b = posBetween(a, null);
  assert.ok(posBetween(null, a) < a && a < posBetween(a, b) && posBetween(a, b) < b);
  const many = posesBetween(null, null, 200);
  assert.ok(many.every((k, i) => i === 0 || many[i - 1] < k));
  assert.throws(() => posBetween("b", "a"));
  assert.deepEqual(sortStepsByPos([{ id: "b", pos: "V" }, { id: "a", pos: "V" }, { id: "c", pos: "A" }]).map((s) => s.id), ["c", "a", "b"]);
  assert.equal(comparePos({ id: "a", pos: "V" }, { id: "a", pos: "V" }), 0);
});

test("migração preguiçosa: não muta, preserva ordem, é idempotente", () => {
  const original = { coverStepId: "bad id!", steps: [{ id: "a", title: "A" }, { id: "a", title: "B" }, { id: "bad id!" }] };
  const snap = structuredClone(original);
  assert.equal(isCollabProject(original), false);
  const m = prepareProjectForCollab(original);
  assert.deepEqual(original, snap);
  assert.equal(m.project.collab.v, 1);
  assert.deepEqual(m.project.steps.map((s) => s.title), ["A", "B", undefined]);
  assert.equal(m.project.coverStepId, m.project.steps[2].id);
  assert.equal(prepareProjectForCollab(m.project).changed, false);
  assert.equal(assignStepPositions([]).changed, false);
});
