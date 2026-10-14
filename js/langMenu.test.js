import test from "node:test";
import assert from "node:assert/strict";
import { audioLangs, resolvePlayerLangs } from "./langMenu.js";

const demo = () => ({
  i18n: { v: 1, defaultLang: "pt-BR", langs: [{ lang: "en", enabled: true }, { lang: "es", enabled: true }, { lang: "fr", enabled: false }] },
  steps: [
    { id: "a", caption: "Oi", narrationAudio: { clips: ["asset:1"] }, i18n: { en: { caption: "Hi", narrationAudio: { clips: ["asset:2"] } } } },
    { id: "b", caption: "Tchau", narrationAudio: { clips: ["asset:3"] } },
  ],
});

test("no menu for monolingual tours", () => {
  assert.equal(resolvePlayerLangs({ steps: [] }), null);
});

test("audio langs mark partial", () => {
  assert.deepEqual(audioLangs(demo()), [{ lang: "pt-BR", partial: false }, { lang: "en", partial: true }]);
});

test("browser language drives text and audio; audio falls back to source (Q1)", () => {
  assert.deepEqual(resolvePlayerLangs(demo(), { languages: ["en-US", "pt"] }), { text: "en", audio: "en", cc: true });
  assert.deepEqual(resolvePlayerLangs(demo(), { languages: ["es-MX"] }), { text: "es", audio: "pt-BR", cc: true });
  assert.deepEqual(resolvePlayerLangs(demo(), { languages: ["de"] }), { text: "pt-BR", audio: "pt-BR", cc: true });
});

test("URL beats session beats browser; disabled lang ignored", () => {
  assert.equal(resolvePlayerLangs(demo(), { search: "?lang=es", stored: { text: "en" }, languages: ["en"] }).text, "es");
  assert.equal(resolvePlayerLangs(demo(), { stored: { text: "en", audio: "pt-BR", cc: false }, languages: ["es"] }).audio, "pt-BR");
  assert.equal(resolvePlayerLangs(demo(), { search: "?lang=fr", languages: [] }).text, "pt-BR");
  assert.deepEqual(resolvePlayerLangs(demo(), { search: "?lang=en&audio=none&cc=0" }), { text: "en", audio: "none", cc: false });
  assert.equal(resolvePlayerLangs(demo(), { search: "?lang=en&audio=pt" }).audio, "pt-BR");
});
