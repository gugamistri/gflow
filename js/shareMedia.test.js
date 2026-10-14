import test from "node:test";
import assert from "node:assert/strict";
import { externalizeLangAudio, isPlayableClipUrl, resolveShareMedia } from "./shareMedia.js";

const clip = "data:audio/mpeg;base64," + Buffer.from("fake-mp3-bytes").toString("base64");
const snap = () => ({
  steps: [
    { id: "s1", narrationAudio: { clips: [clip] }, i18n: { en: { narrationAudio: { clips: [clip], durationSeconds: 1 } }, es: { title: "Hola" } } },
    { id: "s2", i18n: { es: { narrationAudio: { clips: [clip] } } } },
  ],
});

test("externalize: target clips become asset refs, source stays inline, uploads deduped", async () => {
  const uploads = [];
  const s = snap();
  const r = await externalizeLangAudio(s, {
    check: async (h) => ({ ok: true, data: { missing: h } }),
    upload: async (sha, bytes, mime) => { uploads.push([sha, mime, bytes.length]); return { ok: true }; },
  });
  assert.equal(r.refs, 1);
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0][1], "audio/mpeg");
  assert.match(r.snapshot.steps[0].i18n.en.narrationAudio.clips[0], /^asset:[a-f0-9]{64}$/);
  assert.equal(r.snapshot.steps[1].i18n.es.narrationAudio.clips[0], r.snapshot.steps[0].i18n.en.narrationAudio.clips[0]);
  assert.equal(r.snapshot.steps[0].narrationAudio.clips[0], clip, "origem inline");
  assert.equal(s.steps[0].i18n.en.narrationAudio.clips[0], clip, "não muta o original");
});

test("externalize: already on the server → no upload; failure throws", async () => {
  const r = await externalizeLangAudio(snap(), { check: async () => ({ ok: true, data: { missing: [] } }), upload: async () => ({ ok: true }) });
  assert.equal(r.uploaded, 0);
  await assert.rejects(externalizeLangAudio(snap(), { check: async (h) => ({ ok: true, data: { missing: h } }), upload: async () => ({ ok: false }) }));
});

test("resolveShareMedia + isPlayableClipUrl", () => {
  const sha = "a".repeat(64);
  const t = { steps: [{ i18n: { en: { narrationAudio: { clips: [`asset:${sha}`, "asset:bad"] } } } }] };
  resolveShareMedia(t, "https://app.guiaflow.pro/api/shares/demo-1");
  const url = t.steps[0].i18n.en.narrationAudio.clips[0];
  assert.equal(url, `https://app.guiaflow.pro/api/shares/demo-1/media/${sha}`);
  assert.equal(t.steps[0].i18n.en.narrationAudio.clips.length, 1);
  assert.ok(isPlayableClipUrl(url));
  assert.ok(!isPlayableClipUrl("https://evil.example/x.mp3"));
  assert.ok(isPlayableClipUrl("data:audio/mpeg;base64,AAAA"));
});
