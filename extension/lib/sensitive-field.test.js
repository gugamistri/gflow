import assert from "node:assert/strict";
import test from "node:test";
import { clipStoredActions, clipTypeText, fieldIsSensitive, typeActionFromInput } from "./sensitive-field.js";

const point = { t: 40, x: 30, y: 40 };

test("senha, código e cartão não geram action", () => {
  const blocked = [
    { type: "password", name: "q", id: "q" },
    { type: "text", autocomplete: "current-password", name: "login" },
    { type: "text", autocomplete: "section-user new-password", name: "nova" },
    { type: "text", autocomplete: "one-time-code", name: "otp" },
    { type: "text", autocomplete: "cc-number", name: "pan" },
    { type: "text", autocomplete: "cc-csc", name: "sec" },
    { type: "text", autocomplete: "cc-exp", name: "exp" },
    { type: "text", autocomplete: "cc-name", name: "holder" },
    { type: "text", autocomplete: "cc-exp-month", name: "mes" },
    { type: "text", name: "user_password", id: "ok" },
    { type: "text", name: "senha", id: "s" },
    { type: "text", name: "cardNumber", id: "c" },
    { type: "text", name: "cvv", id: "v" },
    { type: "text", name: "cartao", id: "c" },
    { type: "text", id: "cc-csc" },
  ];
  for (const field of blocked) {
    assert.equal(fieldIsSensitive(field), true, JSON.stringify(field));
    assert.equal(typeActionFromInput(field, "segredo", point), null, JSON.stringify(field));
  }
  assert.equal(clipStoredActions([{ t: 0, kind: "type", text: "4111", x: 1, y: 2, field: { autocomplete: "cc-number" } }]), null);
});

test("busca e formulário comum gravam, no máximo 200 caracteres", () => {
  assert.equal(fieldIsSensitive({ type: "search", name: "q", id: "busca", autocomplete: "off" }), false);
  assert.equal(fieldIsSensitive({ type: "email", name: "email", id: "email" }), false);
  const action = typeActionFromInput({ type: "text", name: "titulo", id: "titulo" }, "  norte", point);
  assert.equal(action.text, "  norte");
  assert.equal(action.kind, "type");
  assert.equal(typeActionFromInput({ type: "text", name: "q" }, "", point), null);
  const long = typeActionFromInput({ type: "text", name: "q" }, "a".repeat(240), point);
  assert.equal(long.text.length, 200);
  assert.equal(clipTypeText("a".repeat(201)).length, 200);
});

test("lista gravada sem actions continua nula", () => {
  assert.equal(clipStoredActions(undefined), null);
  assert.equal(clipStoredActions([]), null);
  assert.equal(clipStoredActions("norte"), null);
  assert.deepEqual(clipStoredActions([{ t: 1, kind: "type", text: "oi", x: 10, y: 20 }]), [
    { t: 1, kind: "type", text: "oi", x: 10, y: 20 },
  ]);
});
