import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DEFAULT_EDITOR_ORIGIN,
  EDITOR_CONTENT_MATCHES,
  LEGACY_EDITOR_ORIGIN,
  normalizeEditorOrigin,
  originToMatchPattern,
  resolveEditorOrigin,
  tabMatchesOrigin,
} from "./editor-origin.js";

test("origem padrão é guiaflow.pro", () => {
  assert.equal(DEFAULT_EDITOR_ORIGIN, "https://guiaflow.pro");
  assert.equal(LEGACY_EDITOR_ORIGIN, "https://guiaflow-seven.vercel.app");
});

test("host antigo salvo passa a abrir guiaflow.pro; localhost fica", () => {
  assert.equal(resolveEditorOrigin(""), "https://guiaflow.pro");
  assert.equal(resolveEditorOrigin(undefined), "https://guiaflow.pro");
  assert.equal(resolveEditorOrigin("https://guiaflow-seven.vercel.app"), "https://guiaflow.pro");
  assert.equal(
    resolveEditorOrigin("https://guiaflow-seven.vercel.app/index.html"),
    "https://guiaflow.pro"
  );
  assert.equal(resolveEditorOrigin("https://guiaflow.pro/"), "https://guiaflow.pro");
  assert.equal(resolveEditorOrigin("http://localhost:4173"), "http://localhost:4173");
  assert.equal(resolveEditorOrigin("http://127.0.0.1:4173/app"), "http://127.0.0.1:4173");
  assert.equal(resolveEditorOrigin("https://preview.example.com"), "https://preview.example.com");
});

test("manifest injeta presença e permissão nos mesmos hosts do editor", () => {
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.host_permissions, EDITOR_CONTENT_MATCHES);
  assert.equal(manifest.content_scripts.length, 1);
  assert.deepEqual(manifest.content_scripts[0].js, ["presence.js"]);
  assert.deepEqual(manifest.content_scripts[0].matches, EDITOR_CONTENT_MATCHES);
  assert.equal(EDITOR_CONTENT_MATCHES[0], "https://guiaflow.pro/*");
  assert.ok(EDITOR_CONTENT_MATCHES.includes("http://localhost:4173/*"));
  assert.ok(EDITOR_CONTENT_MATCHES.includes("http://127.0.0.1:4173/*"));
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
