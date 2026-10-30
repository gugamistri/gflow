import test from "node:test";
import assert from "node:assert/strict";
import {
  applyVideoToStep,
  createVideoProgress,
  isVideoStep,
  normalizeStepVideo,
  parseVideoUrl,
  removeVideoFromStep,
  trackVideoTime,
  videoEmbedUrl,
  videoPosterSources,
  videoWatchUrl,
  vimeoThumbnailFromOembed,
} from "./video.js";
import { applyAgentStepInput, checkTourForPublish, stepForAgent } from "./agent.js";
import * as schema from "./index.js";

const YT = "dQw4w9WgXcQ";

test("parseVideoUrl: formatos do YouTube", () => {
  for (const url of [
    `https://www.youtube.com/watch?v=${YT}`,
    `https://youtube.com/watch?v=${YT}&t=42s&list=PL123`,
    `https://m.youtube.com/watch?feature=share&v=${YT}`,
    `https://youtu.be/${YT}`,
    `https://youtu.be/${YT}?si=abc&t=3`,
    `https://www.youtube.com/shorts/${YT}`,
    `https://www.youtube.com/embed/${YT}?start=10`,
    `https://www.youtube-nocookie.com/embed/${YT}`,
    `https://www.youtube.com/live/${YT}`,
    `youtube.com/watch?v=${YT}`,
    `  youtu.be/${YT}  `,
  ]) {
    assert.deepEqual(parseVideoUrl(url), { kind: "youtube", id: YT }, url);
  }
});

test("parseVideoUrl: formatos do Vimeo (com hash de não listado)", () => {
  assert.deepEqual(parseVideoUrl("https://vimeo.com/76979871"), { kind: "vimeo", id: "76979871" });
  assert.deepEqual(parseVideoUrl("vimeo.com/76979871"), { kind: "vimeo", id: "76979871" });
  assert.deepEqual(parseVideoUrl("https://vimeo.com/76979871/ab12cd34ef"), { kind: "vimeo", id: "76979871", h: "ab12cd34ef" });
  assert.deepEqual(parseVideoUrl("https://player.vimeo.com/video/76979871"), { kind: "vimeo", id: "76979871" });
  assert.deepEqual(parseVideoUrl("https://player.vimeo.com/video/76979871?h=AB12CD34EF&badge=0"), { kind: "vimeo", id: "76979871", h: "ab12cd34ef" });
  assert.deepEqual(parseVideoUrl("https://vimeo.com/channels/staffpicks/76979871"), { kind: "vimeo", id: "76979871" });
  assert.deepEqual(parseVideoUrl("https://vimeo.com/groups/motion/videos/76979871"), { kind: "vimeo", id: "76979871" });
  assert.deepEqual(parseVideoUrl("https://vimeo.com/showcase/123/video/76979871"), { kind: "vimeo", id: "76979871" });
});

test("parseVideoUrl: recusa o que não é link de vídeo", () => {
  for (const bad of [
    "",
    null,
    "not a url",
    "javascript:alert(1)",
    "data:text/html,hi",
    "https://example.com/watch?v=" + YT,
    "https://youtube.com.evil.com/watch?v=" + YT,
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/channel/UC123",
    "https://youtu.be/",
    "https://vimeo.com/about",
    "https://vimeo.com/channels/staffpicks",
    "https://evilvimeo.com/123",
    "ftp://vimeo.com/123",
    `https://www.youtube.com/watch?v=${YT}"><script>`,
  ]) {
    assert.equal(parseVideoUrl(bad), null, String(bad));
  }
});

test("normalizeStepVideo: só aceita kind/id válidos e limpa duração", () => {
  assert.deepEqual(normalizeStepVideo({ kind: "youtube", id: YT, durationSec: 61.4, extra: "x" }), { kind: "youtube", id: YT, durationSec: 61 });
  assert.deepEqual(normalizeStepVideo({ kind: "vimeo", id: 123, h: "ABCDEF12" }), { kind: "vimeo", id: "123", h: "abcdef12" });
  assert.equal(normalizeStepVideo({ kind: "vimeo", id: "12a" }), null);
  assert.equal(normalizeStepVideo({ kind: "youtube", id: "../../x" }), null);
  assert.equal(normalizeStepVideo({ kind: "mp4", id: "x" }), null);
  assert.equal(normalizeStepVideo("youtube"), null);
  assert.deepEqual(normalizeStepVideo({ kind: "youtube", id: YT, durationSec: -3 }), { kind: "youtube", id: YT });
  assert.deepEqual(normalizeStepVideo({ kind: "vimeo", id: "1", h: "<bad>" }), { kind: "vimeo", id: "1" });
});

test("isVideoStep: slide nunca é vídeo", () => {
  assert.equal(isVideoStep({ type: "screen", video: { kind: "youtube", id: YT } }), true);
  assert.equal(isVideoStep({ type: "slide", video: { kind: "youtube", id: YT } }), false);
  assert.equal(isVideoStep({ type: "screen" }), false);
});

test("videoEmbedUrl: youtube-nocookie e player.vimeo com os parâmetros de privacidade", () => {
  const yt = new URL(videoEmbedUrl({ kind: "youtube", id: YT }, { origin: "https://guiaflow.pro" }));
  assert.equal(yt.origin, "https://www.youtube-nocookie.com");
  assert.equal(yt.pathname, `/embed/${YT}`);
  for (const [k, v] of Object.entries({ playsinline: "1", mute: "1", autoplay: "1", cc_load_policy: "1", enablejsapi: "1" })) {
    assert.equal(yt.searchParams.get(k), v, k);
  }
  assert.equal(yt.searchParams.get("origin"), "https://guiaflow.pro");
  assert.equal(new URL(videoEmbedUrl({ kind: "youtube", id: YT }, { origin: "null" })).searchParams.has("origin"), false);

  const vm = new URL(videoEmbedUrl({ kind: "vimeo", id: "76979871", h: "abcdef12" }));
  assert.equal(vm.origin, "https://player.vimeo.com");
  assert.equal(vm.pathname, "/video/76979871");
  for (const [k, v] of Object.entries({ muted: "1", playsinline: "1", dnt: "1", h: "abcdef12" })) {
    assert.equal(vm.searchParams.get(k), v, k);
  }
  assert.equal(videoEmbedUrl({ kind: "youtube", id: "bad" }), "");
});

test("videoWatchUrl e fontes do pôster", () => {
  assert.equal(videoWatchUrl({ kind: "youtube", id: YT }), `https://www.youtube.com/watch?v=${YT}`);
  assert.equal(videoWatchUrl({ kind: "vimeo", id: "5", h: "abcdef12" }), "https://vimeo.com/5/abcdef12");
  assert.equal(videoPosterSources({ kind: "youtube", id: YT }).images[0], `https://i.ytimg.com/vi/${YT}/maxresdefault.jpg`);
  assert.match(videoPosterSources({ kind: "vimeo", id: "5" }).oembed, /^https:\/\/vimeo\.com\/api\/oembed\.json\?url=https%3A%2F%2Fvimeo\.com%2F5/);
  assert.equal(
    vimeoThumbnailFromOembed({ thumbnail_url: "https://i.vimeocdn.com/video/209-abc-d_640?region=us" }),
    "https://i.vimeocdn.com/video/209-abc-d_1280?region=us"
  );
  assert.equal(vimeoThumbnailFromOembed({ thumbnail_url: "https://evil.example/x.jpg" }), "");
  assert.equal(vimeoThumbnailFromOembed({ thumbnail_url: "http://i.vimeocdn.com/x.jpg" }), "");
});

test("applyVideoToStep / removeVideoFromStep", () => {
  const step = { type: "screen", image: "custom:old", simulateClick: true, zoomHighlight: true, hotspot: { x: 1, y: 1, w: 2, h: 2 } };
  applyVideoToStep(step, { kind: "youtube", id: YT }, "custom:poster");
  assert.deepEqual(step.video, { kind: "youtube", id: YT });
  assert.equal(step.image, "custom:poster");
  assert.equal(step.simulateClick, false);
  assert.equal(step.zoomHighlight, false);
  assert.deepEqual(step.hotspot, { x: 0, y: 0, w: 100, h: 100 });
  removeVideoFromStep(step);
  assert.equal("video" in step, false);
  assert.equal(step.image, "custom:poster");
});

test("trackVideoTime: marcos 25/50/75/100 e segundos assistidos sem contar pulos", () => {
  const s = createVideoProgress();
  assert.deepEqual(trackVideoTime(s, { currentTime: 0, duration: 100 }), []);
  assert.deepEqual(trackVideoTime(s, { currentTime: 1 }), []);
  assert.deepEqual(trackVideoTime(s, { currentTime: 2 }), []);
  assert.equal(Math.round(s.watchedSec), 2);
  // pulo para 60 s: marcos 25 e 50, mas o tempo assistido não cresce
  assert.deepEqual(trackVideoTime(s, { currentTime: 60 }), [25, 50]);
  assert.equal(Math.round(s.watchedSec), 2);
  assert.deepEqual(trackVideoTime(s, { currentTime: 61 }), []);
  assert.equal(Math.round(s.watchedSec), 3);
  assert.deepEqual(trackVideoTime(s, { currentTime: 76 }), [75]);
  assert.deepEqual(trackVideoTime(s, { currentTime: 76.5, ended: true }), [100]);
  assert.deepEqual(trackVideoTime(s, { currentTime: 100, ended: true }), []);
});

test("checkTourForPublish: vídeo inválido bloqueia; vídeo válido com pôster passa", () => {
  const base = { popover: { title: "t" }, hotspot: { x: 0, y: 0, w: 100, h: 100 } };
  const ok = checkTourForPublish({ steps: [{ ...base, type: "screen", image: "custom:p", video: { kind: "youtube", id: YT } }] });
  assert.equal(ok.ok, true);
  const bad = checkTourForPublish({ steps: [{ ...base, type: "screen", image: "custom:p", video: { kind: "youtube", id: "x" } }] });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors[0].field, "steps[0].video");
  // sem pôster continua sendo "captura sem imagem" (players antigos mostram a imagem)
  const noPoster = checkTourForPublish({ steps: [{ ...base, type: "screen", video: { kind: "youtube", id: YT } }] });
  assert.equal(noPoster.errors[0].field, "steps[0].image");
});

test("index.js exporta o módulo de vídeo", () => {
  assert.equal(typeof schema.parseVideoUrl, "function");
  assert.equal(typeof schema.videoEmbedUrl, "function");
});

test("agente: video aceita link do YouTube/Vimeo, ocupa a tela e sai com null", () => {
  const added = applyAgentStepInput({ title: "Assista", video: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10", highlight: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } });
  assert.equal(added.ok, true);
  assert.deepEqual(added.step.video, { kind: "youtube", id: "dQw4w9WgXcQ" });
  assert.deepEqual(added.step.hotspot, { x: 0, y: 0, w: 100, h: 100 });
  assert.equal(added.step.simulateClick, false);
  assert.ok(added.warnings.some((w) => /highlight e click foram ignorados/.test(w)));
  const seen = stepForAgent({ ...added.step, id: "s1" }, 0);
  assert.deepEqual(seen.video, { kind: "youtube", id: "dQw4w9WgXcQ", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });

  const titled = applyAgentStepInput({ title: "Outro" }, added.step);
  assert.deepEqual(titled.step.video, added.step.video);
  assert.deepEqual(titled.step.hotspot, { x: 0, y: 0, w: 100, h: 100 });

  const vimeo = applyAgentStepInput({ video: "https://vimeo.com/76979871" }, added.step);
  assert.deepEqual(vimeo.step.video, { kind: "vimeo", id: "76979871" });

  const removed = applyAgentStepInput({ video: null }, vimeo.step);
  assert.equal(removed.ok, true);
  assert.equal("video" in removed.step, false);
  assert.equal(stepForAgent({ ...removed.step, id: "s1" }, 0).video, undefined);

  const slide = applyAgentStepInput({ type: "slide" }, added.step);
  assert.equal("video" in slide.step, false);
  assert.ok(slide.warnings.some((w) => /virou slide/.test(w)));
});

test("agente: link de vídeo inválido ou em slide dá erro corrigível", () => {
  const bad = applyAgentStepInput({ video: "https://dailymotion.com/video/x8" });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors[0].field, "video");
  assert.match(bad.errors[0].message, /YouTube ou do Vimeo/);
  const slide = applyAgentStepInput({ type: "slide", video: "https://youtu.be/dQw4w9WgXcQ" });
  assert.equal(slide.ok, false);
  assert.equal(slide.errors[0].field, "video");
});
