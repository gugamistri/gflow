import assert from "node:assert/strict";
import test from "node:test";
import {
  bootShouldSkipSavedOpen,
  captureFingerprint,
  createCaptureClaim,
  planCaptureHandoff,
} from "./captureInbox.js";

const payload = { name: "Cap", steps: [{ label: "Tela", image: "data:image/png,abc" }] };

test("anexar no projeto aberto não troca de projeto", () => {
  assert.deepEqual(planCaptureHandoff({ mode: "append", openProjectId: "a", activeProjectId: "b" }), {
    action: "append",
    projectId: "a",
    flushFirst: true,
  });
});

test("anexar na grade usa o projeto ativo gravado", () => {
  assert.deepEqual(planCaptureHandoff({ mode: "append", openProjectId: null, activeProjectId: "b" }), {
    action: "append-saved",
    projectId: "b",
    flushFirst: false,
  });
});

test("anexar sem projeto nenhum é recusado", () => {
  assert.equal(planCaptureHandoff({ mode: "append", openProjectId: null, activeProjectId: null }).action, "reject");
});

test("criar grava o projeto aberto antes de trocar", () => {
  assert.deepEqual(planCaptureHandoff({ mode: "create", openProjectId: "a", activeProjectId: "a" }), {
    action: "create",
    projectId: null,
    flushFirst: true,
  });
  assert.equal(planCaptureHandoff({ mode: "create", openProjectId: null, activeProjectId: null }).flushFirst, false);
});

test("a abertura não repõe o projeto salvo se a captura já entrou", () => {
  assert.equal(bootShouldSkipSavedOpen(0, 0), false);
  assert.equal(bootShouldSkipSavedOpen(0, 1), true);
});

test("a mesma captura não entra duas vezes; a seguinte sim", () => {
  let clock = 1000;
  const claims = createCaptureClaim(() => clock);
  const first = { id: 1, type: "import-project", payload };
  assert.equal(claims.claim(first), "fresh");
  assert.equal(claims.claim({ type: "import-project", payload }), "busy");
  claims.commit(first);
  assert.equal(claims.claim(first), "done");

  clock += 5000;
  const second = { id: 2, type: "import-project", payload: { ...payload, name: "Outra" } };
  assert.equal(claims.claim(second), "fresh");
  assert.equal(claims.claim(first), "done");
  assert.notEqual(captureFingerprint(first), captureFingerprint(second));
});

test("falha libera a captura para a próxima tentativa", () => {
  const claims = createCaptureClaim(() => 10);
  const data = { id: 9, type: "append-steps", payload };
  assert.equal(claims.claim(data), "fresh");
  claims.release(data);
  assert.equal(claims.claim(data), "fresh");
});
