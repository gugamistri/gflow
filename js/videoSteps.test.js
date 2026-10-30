import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parseEmbedMessage, VIDEO_STAGE_ID } from "./videoStage.js";
import { posterCrop, fetchVideoPoster } from "./stepVideoEditor.js";
import { createViewTracker, MEDIA_EVENTS } from "./viewAnalytics.js";
import { HIGHLIGHT_CLICK_IGNORE } from "./highlightClick.js";
import { VIDEO_STRINGS } from "./videoI18n.js";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("parseEmbedMessage: YouTube (infoDelivery/onStateChange) e Vimeo (timeupdate/ended)", () => {
  assert.deepEqual(
    parseEmbedMessage("youtube", JSON.stringify({ event: "infoDelivery", info: { currentTime: 12.5, duration: 100, playerState: 1 } })),
    { currentTime: 12.5, duration: 100, state: "playing" }
  );
  assert.deepEqual(parseEmbedMessage("youtube", { event: "onStateChange", info: 0 }), { state: "ended" });
  assert.deepEqual(parseEmbedMessage("youtube", { event: "onReady" }), { ready: true });
  assert.equal(parseEmbedMessage("youtube", "não é json"), null);
  assert.equal(parseEmbedMessage("youtube", { event: "infoDelivery", info: { volume: 3 } }), null);
  assert.deepEqual(parseEmbedMessage("vimeo", { event: "timeupdate", data: { seconds: 5, duration: 20 } }), {
    state: "playing",
    currentTime: 5,
    duration: 20,
  });
  assert.deepEqual(parseEmbedMessage("vimeo", '{"event":"ready"}'), { ready: true });
  assert.deepEqual(parseEmbedMessage("vimeo", { event: "pause" }), { state: "paused" });
  assert.equal(parseEmbedMessage("vimeo", { event: "ended" }).state, "ended");
  assert.equal(parseEmbedMessage("other", { event: "ready" }), null);
});

test("posterCrop: 4:3 com faixas vira 16:9 central; largura limitada", () => {
  assert.deepEqual(posterCrop(640, 480), { sx: 0, sy: 60, sw: 640, sh: 360, w: 640, h: 360 });
  assert.deepEqual(posterCrop(1280, 720), { sx: 0, sy: 0, sw: 1280, sh: 720, w: 1280, h: 720 });
  assert.deepEqual(posterCrop(3840, 2160), { sx: 0, sy: 0, sw: 3840, sh: 2160, w: 1920, h: 1080 });
});

function fakeFetch(routes) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    const r = routes.find(([m]) => url.startsWith(m));
    if (!r) return { ok: false, status: 404 };
    return r[1];
  };
  return { impl, calls };
}

test("fetchVideoPoster: YouTube pula placeholder 120×90 e usa o título do oEmbed", async () => {
  const prev = globalThis.createImageBitmap;
  const sizes = { maxres: 120, sd: 640 };
  globalThis.createImageBitmap = async (blob) => ({ width: sizes[blob.tag], height: 90, close() {} });
  try {
    const img = (tag) => ({ ok: true, blob: async () => ({ type: "image/jpeg", tag }) });
    const { impl, calls } = fakeFetch([
      ["https://www.youtube.com/oembed", { ok: true, json: async () => ({ title: "  Meu vídeo  " }) }],
      ["https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault", img("maxres")],
      ["https://i.ytimg.com/vi/dQw4w9WgXcQ/sddefault", img("sd")],
    ]);
    const out = await fetchVideoPoster(
      { kind: "youtube", id: "dQw4w9WgXcQ" },
      { fetchImpl: impl, encode: async (b) => ({ dataUrl: `data:image/webp;base64,${b.width}` }) }
    );
    assert.equal(out.dataUrl, "data:image/webp;base64,640");
    assert.equal(out.title, "Meu vídeo");
    assert.equal(out.durationSec, null);
    assert.ok(calls.every((u) => u.startsWith("https://")));
  } finally {
    globalThis.createImageBitmap = prev;
  }
});

test("fetchVideoPoster: Vimeo usa thumbnail e duração do oEmbed", async () => {
  const prev = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async () => ({ width: 1280, height: 720, close() {} });
  try {
    const { impl, calls } = fakeFetch([
      [
        "https://vimeo.com/api/oembed.json",
        { ok: true, json: async () => ({ title: "Demo", duration: 62.4, thumbnail_url: "https://i.vimeocdn.com/video/1-d_640" }) },
      ],
      ["https://i.vimeocdn.com/video/1-d_1280", { ok: true, blob: async () => ({ type: "image/jpeg" }) }],
    ]);
    const out = await fetchVideoPoster({ kind: "vimeo", id: "76979871" }, { fetchImpl: impl, encode: async () => ({ dataUrl: "data:x" }) });
    assert.deepEqual(out, { dataUrl: "data:x", title: "Demo", durationSec: 62 });
    assert.ok(calls.some((u) => u.startsWith("https://i.vimeocdn.com/video/1-d_1280")));
  } finally {
    globalThis.createImageBitmap = prev;
  }
});

function tracker(opts = {}) {
  const sent = [];
  const t = createViewTracker({
    send: (body) => sent.push(JSON.parse(body)),
    now: () => 0,
    uuid: () => "11111111-2222-4333-8444-555555555555",
    setTimer: () => 1,
    clearTimer: () => {},
    ...opts,
  });
  return { t, sent };
}

test("vídeo: eventos de mídia vão em lote separado (servidor antigo só descarta esse lote)", () => {
  const { t, sent } = tracker();
  t.onStep({ index: 1, stepId: "s1", total: 3 });
  t.videoPlay({ index: 1, stepId: "s1", kind: "youtube" });
  t.videoPlay({ index: 1, stepId: "s1", kind: "youtube" }); // uma vez por passo
  t.videoProgress({ index: 1, stepId: "s1", kind: "youtube", pct: 25, watchedSec: 10.4 });
  t.videoProgress({ index: 1, stepId: "s1", kind: "youtube", pct: 33, watchedSec: 1 }); // pct inválido
  t.videoProgress({ index: 1, kind: "dailymotion", pct: 25 }); // provedor inválido
  t.videoProgress({ index: -1, kind: "vimeo", pct: 25 });
  assert.equal(t.mediaQueue.length, 2);
  t.flush();
  assert.equal(sent.length, 2);
  assert.ok(sent[0].events.every((e) => !MEDIA_EVENTS.includes(e.name)));
  assert.equal(sent[0].events[0].name, "session_start");
  assert.deepEqual(sent[1].events, [
    { name: "video_play", index: 1, stepId: "s1", kind: "youtube" },
    { name: "video_progress", index: 1, stepId: "s1", kind: "youtube", pct: 25, watchedSec: 10 },
  ]);
  assert.equal(sent[1].sessionId, sent[0].sessionId);
});

test("vídeo: 100% força envio; segundos limitados; mediaEvents:false desliga", () => {
  const { t, sent } = tracker();
  t.flush();
  const before = sent.length;
  t.videoProgress({ index: 0, kind: "vimeo", pct: 100, watchedSec: 1e9 });
  assert.equal(sent.length, before + 1);
  assert.equal(sent.at(-1).events[0].watchedSec, 86400);
  const off = tracker({ mediaEvents: false });
  off.t.videoPlay({ index: 0, kind: "vimeo" });
  assert.equal(off.t.mediaQueue.length, 0);
});

test("vídeo: clique na fachada não avança o passo; textos nos 3 idiomas; CSS e editor ligados", () => {
  assert.ok(HIGHLIGHT_CLICK_IGNORE.includes(".gf-video"));
  const keys = Object.keys(VIDEO_STRINGS.pt).sort();
  assert.deepEqual(Object.keys(VIDEO_STRINGS.en).sort(), keys);
  assert.deepEqual(Object.keys(VIDEO_STRINGS.es).sort(), keys);
  assert.equal(VIDEO_STAGE_ID, "gf-video");
  assert.match(read("css/player.css"), /\.gf-video\.is-expanded\s*\{[^}]*100dvh/);
  const editor = read("editor.html");
  assert.match(editor, /id="prop-video-url"/);
  assert.match(editor, /id="stb-video"/);
});
