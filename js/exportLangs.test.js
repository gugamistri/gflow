import test from "node:test";
import assert from "node:assert/strict";
import { addLang, setTranslation } from "./tour-schema/i18n.js";
import { buildVtt, exportLangs, htmlLangData, htmlLangScript, langFileName, pickHtmlLang, videoDemoForLang, wrapTextUnits } from "./exportLangs.js";

const tour = () => ({
  name: "Demo",
  narration: { voiceURI: "pt-BR" },
  steps: [{ id: "s1", image: "data:image/png;base64,AAAA", popover: { title: "Olá", description: "Clique" }, caption: "Clique aqui.", narrationAudio: { clips: ["data:audio/mpeg;base64,PT"], durationSeconds: 2 } }],
});

test("monolingual tours export as before", () => {
  const p = tour();
  assert.deepEqual(exportLangs(p), []);
  assert.equal(htmlLangData(p), null);
  assert.equal(langFileName("demo", "", "mp4"), "demo.mp4");
});

test("video demo per language: text + audio in the language, audio falls back, cc off hides captions", () => {
  const p = tour();
  addLang(p, "en");
  setTranslation(p, { id: "s1", field: "title", lang: "en", text: "Hello" });
  setTranslation(p, { id: "s1", field: "caption", lang: "en", text: "Click here." });
  assert.deepEqual(exportLangs(p), ["pt-BR", "en"]);
  const v = videoDemoForLang(p, "en");
  assert.equal(v.steps[0].popover.title, "Hello");
  assert.equal(v.steps[0].caption, "Click here.");
  assert.equal(v.steps[0].narrationAudio.clips[0], "data:audio/mpeg;base64,PT", "fallback to source audio");
  p.steps[0].i18n.en.narrationAudio = { clips: ["data:audio/mpeg;base64,EN"], durationSeconds: 2 };
  assert.equal(videoDemoForLang(p, "en").steps[0].narrationAudio.clips[0], "data:audio/mpeg;base64,EN");
  assert.equal(videoDemoForLang(p, "en", { cc: false }).steps[0].showCaption, false);
  assert.equal(p.steps[0].popover.title, "Olá", "project untouched");
  assert.equal(langFileName("demo", "pt-BR", "mp4"), "demo.pt-BR.mp4");
});

test("HTML: overlays carry text/audio only; language pick order; script is classic JS", () => {
  const p = tour();
  addLang(p, "es");
  setTranslation(p, { id: "s1", field: "title", lang: "es", text: "Hola" });
  const d = htmlLangData(p);
  assert.equal(d.overlays.es.steps.s1.popover.title, "Hola");
  assert.equal(d.overlays.es.steps.s1.image, undefined, "no images duplicated");
  assert.equal(pickHtmlLang(d, { browser: ["es-MX", "en"] }), "es");
  assert.equal(pickHtmlLang(d, { query: "pt", browser: ["es"] }), "pt-BR");
  assert.equal(pickHtmlLang(d, { browser: ["fr"] }), "pt-BR");
  const js = htmlLangScript(d);
  assert.doesNotThrow(() => new Function(js));
  assert.ok(!js.includes("</script"));
});

test("CJK wraps by character; latin by word", () => {
  const m = (s) => s.length;
  assert.deepEqual(wrapTextUnits(m, "aaa bbb ccc", 7), ["aaa bbb", "ccc"]);
  assert.deepEqual(wrapTextUnits(m, "これは日本語のテストです", 5), ["これは日本", "語のテスト", "です"]);
});

test("VTT", () => {
  const v = buildVtt([{ text: "Hi", startMs: 0, endMs: 1500 }, { text: "", startMs: 1500, endMs: 2000 }, { text: "Bye", startMs: 3723004, endMs: 3724000 }]);
  assert.match(v, /^WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.500\nHi\n\n2\n01:02:03.004 --> 01:02:04.000\nBye\n$/);
});
