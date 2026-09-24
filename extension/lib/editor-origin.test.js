import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_EDITOR_ORIGIN,
  normalizeEditorOrigin,
  originToMatchPattern,
  tabMatchesOrigin,
} from "./editor-origin.js";

test("origem padrão é localhost:4173", () => {
  assert.equal(DEFAULT_EDITOR_ORIGIN, "http://localhost:4173");
});

test("normaliza URL com caminho e barra final", () => {
  assert.equal(normalizeEditorOrigin("http://localhost:4173/"), "http://localhost:4173");
  assert.equal(normalizeEditorOrigin("http://localhost:4173/index.html"), "http://localhost:4173");
});

test("aceita host sem protocolo", () => {
  assert.equal(normalizeEditorOrigin("localhost:4173"), "http://localhost:4173");
});

test("rejeita protocolo inválido", () => {
  assert.equal(normalizeEditorOrigin("chrome://extensions"), null);
  assert.equal(normalizeEditorOrigin(""), null);
});

test("match pattern cobre todas as rotas da origem", () => {
  assert.equal(originToMatchPattern("http://localhost:4173"), "http://localhost:4173/*");
  assert.equal(originToMatchPattern("https://demo.example.com/app"), "https://demo.example.com/*");
});

test("localhost e 127.0.0.1 são origens distintas", () => {
  assert.equal(tabMatchesOrigin("http://localhost:4173/", "http://localhost:4173"), true);
  assert.equal(tabMatchesOrigin("http://127.0.0.1:4173/", "http://localhost:4173"), false);
});
