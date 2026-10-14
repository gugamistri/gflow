import test from "node:test";
import assert from "node:assert/strict";
import {
  sha256Hex, textHash, normalizeLangTag, matchLang, ensureI18n, addLang, removeLang, translatableFields,
  setTranslation, fieldStatus, translationStatus, approveTranslation, resolveContent, normalizeI18n,
  sameVars, i18nPublishWarnings, playerLangs, audioStatus, stepAudioSeconds, MAX_TARGET_LANGS, langLabel, langAudioPlan, textHash as th,
} from "./i18n.js";

const tour = () => ({
  name: "Demo",
  narration: { voiceURI: "pt-BR" },
  steps: [
    { id: "s1", popover: { title: "Crie seu tour", description: "Clique em Novo" }, caption: "Clique em Novo para começar.",
      narrationAudio: { clips: ["asset:aa"], durationSeconds: 4 } },
    { id: "s2", popover: { title: "Fim", description: "" }, caption: "" },
  ],
  startStep: { enabled: true, title: "Oi", consentText: "Aceito a LGPD", submitLabel: "Enviar" },
  endStep: { enabled: true, title: "Tchau", whatsapp: { message: "Olá {nome}", label: "Zap" } },
});

test("sha256 vector and short hash", () => {
  assert.equal(sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(textHash("abc").length, 16);
});

test("tags and base matching", () => {
  assert.equal(normalizeLangTag("pt_br"), "pt-BR");
  assert.equal(normalizeLangTag("x"), "");
  assert.equal(matchLang(["pt-BR", "en", "es-MX"], "es"), "es-MX");
  assert.equal(matchLang(["pt-BR", "en"], "en-GB"), "en");
  assert.equal(matchLang(["pt-BR"], "fr"), "");
  assert.equal(langLabel("es-MX"), "Español (México)");
});

test("project without i18n is untouched", () => {
  const t = tour();
  assert.equal(normalizeI18n(t), t);
  const r = resolveContent(t, "en");
  assert.equal(r.steps[0].popover.title, "Crie seu tour");
  assert.deepEqual(playerLangs(t), []);
});

test("ensure/add/remove langs", () => {
  const t = tour();
  ensureI18n(t);
  assert.equal(t.i18n.defaultLang, "pt-BR");
  addLang(t, "en");
  addLang(t, "en");
  addLang(t, "es-MX", { max: MAX_TARGET_LANGS });
  assert.deepEqual(playerLangs(t), ["pt-BR", "en", "es-MX"]);
  assert.throws(() => addLang(t, "ar"));
  setTranslation(t, { id: "s1", field: "title", lang: "en", text: "Create" });
  removeLang(t, "en");
  assert.equal(t.steps[0].i18n, undefined);
  assert.deepEqual(playerLangs(t), ["pt-BR", "es-MX"]);
});

test("status: missing, auto, reviewed, stale; approve", () => {
  const t = tour();
  addLang(t, "en");
  const fields = translatableFields(t);
  assert.ok(fields.some((f) => f.key === "start:start:consentText"));
  assert.ok(fields.some((f) => f.key === "end:end:whatsapp.message"));
  const title = fields.find((f) => f.key === "step:s1:title");
  assert.equal(fieldStatus(t, title, "en"), "missing");
  setTranslation(t, { id: "s1", field: "title", lang: "en", text: "Create your tour", status: "auto" });
  assert.equal(fieldStatus(t, title, "en"), "auto");
  assert.equal(approveTranslation(t, "en"), 1);
  assert.equal(fieldStatus(t, title, "en"), "reviewed");
  t.steps[0].popover.title = "Crie o tour";
  const f2 = translatableFields(t).find((f) => f.key === "step:s1:title");
  assert.equal(fieldStatus(t, f2, "en"), "stale");
  setTranslation(t, { kind: "start", id: "start", field: "consentText", lang: "en", text: "I agree", status: "auto" });
  const st = translationStatus(t).en;
  assert.equal(st.consentAuto, 1);
  assert.equal(st.stale, 1);
  assert.ok(i18nPublishWarnings(t).some((w) => w.code === "consent_auto"));
});

test("resolveContent with fallback and audio", () => {
  const t = tour();
  addLang(t, "en");
  setTranslation(t, { id: "s1", field: "title", lang: "en", text: "Create your tour" });
  setTranslation(t, { id: "s1", field: "caption", lang: "en", text: "Click New." });
  setTranslation(t, { kind: "start", id: "start", field: "submitLabel", lang: "en", text: "Send" });
  const r = resolveContent(t, "en-US");
  assert.equal(r.textLang, "en");
  assert.equal(r.steps[0].popover.title, "Create your tour");
  assert.equal(r.steps[0].popover.description, "Clique em Novo");
  assert.ok(r.fallback.includes("s1:description"));
  assert.equal(r.startStep.submitLabel, "Send");
  assert.deepEqual(r.audioFallback, ["s1"]);
  assert.equal(r.steps[0].narrationAudio.clips[0], "asset:aa");
  assert.equal(t.steps[0].popover.title, "Crie seu tour");
  assert.equal(audioStatus(t.steps[0], "en"), "missing");
  t.steps[0].i18n.en.narrationAudio = { clips: ["asset:bb"], durationSeconds: 6, textHash: textHash("Click New.") };
  assert.equal(audioStatus(t.steps[0], "en"), "ok");
  const r2 = resolveContent(t, "pt-BR", { audioLang: "en" });
  assert.equal(r2.steps[0].narrationAudio.clips[0], "asset:bb");
  assert.equal(r2.steps[0].popover.title, "Crie seu tour");
  assert.equal(resolveContent(t, "en", { audioLang: "none" }).steps[0].narrationAudio, undefined);
  assert.equal(stepAudioSeconds(t.steps[0], "en"), 6);
  const n = normalizeI18n(JSON.parse(JSON.stringify(t)));
  assert.equal(n.steps[0].i18n.en.title, "Create your tour");
});

test("vars preserved (RF9)", () => {
  assert.ok(sameVars("Olá {nome}, veja https://x.com", "Hi {nome}, see https://x.com"));
  assert.ok(!sameVars("Olá {nome}", "Hi {name}"));
});

test("langAudioPlan: only missing/stale with a translated caption; same text+voice is reused", () => {
  const p = tour();
  addLang(p, "en", { voiceId: "a33f7a4c-100f-41cf-a1fd-5822e8fc253f" });
  const s = p.steps.find((x) => String(x.caption || "").trim());
  assert.ok(s, "fixture has a captioned step");
  assert.equal(langAudioPlan(p).length, 0, "no translated caption → nothing to generate");
  setTranslation(p, { id: s.id, field: "caption", lang: "en", text: "Click New." });
  const plan = langAudioPlan(p);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].seconds, 1);
  s.i18n.en.narrationAudio = { clips: ["data:x"], textHash: th("Click New."), voiceId: "a33f7a4c-100f-41cf-a1fd-5822e8fc253f", durationSeconds: 1 };
  assert.equal(langAudioPlan(p).length, 0, "cache hit");
  setTranslation(p, { id: s.id, field: "caption", lang: "en", text: "Click New to start." });
  assert.equal(langAudioPlan(p, { langs: ["en"], stepIds: [s.id] }).length, 1, "stale");
});
