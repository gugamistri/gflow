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

test("no source audio: audio is off instead of another language (Q1)", () => {
  const d = demo();
  for (const s of d.steps) delete s.narrationAudio;
  d.steps[1].i18n = { es: { narrationAudio: { clips: ["asset:9"] } } };
  const st = resolvePlayerLangs(d, { languages: ["pt-BR"] });
  assert.equal(st.audio === "es", false);
});

test("applyLangChoice: escolher o áudio leva o texto junto; texto e legenda ficam independentes", async () => {
  const { applyLangChoice } = await import("./langMenu.js");
  const langs = ["pt-BR", "en", "es"];
  assert.deepEqual(applyLangChoice({ text: "es", audio: "es", cc: true }, "audio", "en", langs), { text: "en", audio: "en", cc: true });
  assert.deepEqual(applyLangChoice({ text: "es", audio: "es", cc: true }, "audio", "none", langs), { text: "es", audio: "none", cc: true });
  assert.deepEqual(applyLangChoice({ text: "en", audio: "en", cc: true }, "text", "pt-BR", langs), { text: "pt-BR", audio: "en", cc: true });
  assert.deepEqual(applyLangChoice({ text: "en", audio: "en", cc: true }, "cc", "off", langs), { text: "en", audio: "en", cc: false });
});
