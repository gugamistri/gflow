import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { initialHandoffState, reduceHandoff } = require("./handoff-deliver.js");

const payload = { name: "Tour", steps: [{ label: "Início", image: "data:image/png;base64,aaa" }] };

test("handoff antes do editor pronto não posta; guia-ready entrega", () => {
  let step = reduceHandoff(initialHandoffState(), {
    type: "handoff",
    id: 10,
    payload,
    mode: "create",
  });
  assert.equal(step.post, null);
  assert.equal(step.state.pending.id, 10);

  step = reduceHandoff(step.state, { type: "editor-ready" });
  assert.equal(step.post.type, "import-project");
  assert.equal(step.post.id, 10);
  assert.equal(step.post.payload, payload);
});

test("aba já pronta recebe a captura na hora, e outra captura depois do ack", () => {
  let step = reduceHandoff(initialHandoffState(), { type: "editor-ready" });
  step = reduceHandoff(step.state, { type: "handoff", id: 1, payload, mode: "create" });
  assert.equal(step.post.type, "import-project");

  step = reduceHandoff(step.state, { type: "ack", id: 1, ok: true, mode: "create", projectId: "p1" });
  assert.equal(step.ack.ok, true);
  assert.equal(step.ack.projectId, "p1");
  assert.equal(step.post, null);

  const again = { name: "Outro", steps: [{ label: "Fim" }] };
  step = reduceHandoff(step.state, { type: "handoff", id: 2, payload: again, mode: "append" });
  assert.equal(step.post.type, "append-steps");
  assert.equal(step.post.id, 2);
  assert.equal(step.post.payload, again);
});

test("foco repete a entrega se o editor ainda não confirmou", () => {
  let step = reduceHandoff(initialHandoffState(), { type: "editor-ready" });
  step = reduceHandoff(step.state, { type: "handoff", id: 4, payload, mode: "append" });
  assert.equal(step.post.mode, "append");

  const ignored = reduceHandoff(step.state, { type: "editor-ready" });
  assert.equal(ignored.post, null);

  const retried = reduceHandoff(step.state, { type: "retry" });
  assert.equal(retried.post.id, 4);
  assert.equal(retried.post.type, "append-steps");
});

test("foco antes do editor pronto não dispara a captura cedo", () => {
  let step = reduceHandoff(initialHandoffState(), { type: "handoff", id: 5, payload, mode: "create" });
  step = reduceHandoff(step.state, { type: "retry" });
  assert.equal(step.post, null);
  step = reduceHandoff(step.state, { type: "editor-ready" });
  assert.equal(step.post.type, "import-project");
});

test("ack antigo não apaga um handoff mais novo", () => {
  let step = reduceHandoff(initialHandoffState(), { type: "editor-ready" });
  step = reduceHandoff(step.state, { type: "handoff", id: 1, payload, mode: "create" });
  step = reduceHandoff(step.state, { type: "handoff", id: 2, payload, mode: "create" });
  assert.equal(step.post.id, 2);
  step = reduceHandoff(step.state, { type: "ack", id: 1, ok: true });
  assert.equal(step.ack, null);
  assert.equal(step.state.pending.id, 2);
});

test("a ponte escuta guia-ready sem comparar event.source e relê no foco", () => {
  const source = readFileSync(new URL("../bridge.js", import.meta.url), "utf8");
  assert.equal(source.includes("event.source"), false);
  assert.match(source, /BRIDGE_VERSION = 2/);
  assert.match(source, /guia-ready/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /HANDOFF_RELAY/);

  const background = readFileSync(new URL("../background.js", import.meta.url), "utf8");
  assert.match(background, /HANDOFF_RELAY/);
  assert.match(background, /world:\s*"MAIN"/);
  assert.match(background, /lib\/handoff-deliver\.js/);
});
