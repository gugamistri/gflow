import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveVideoQuality, avcCodecCandidates, exportVideoOptions } from "./videoQuality.js";

test("free fica no padrão 1080p30 8 Mbps mesmo pedindo Pro", () => {
  const q = resolveVideoQuality({ quality: "uhd", fps: 60, pro: false });
  assert.deepEqual([q.id, q.width, q.height, q.fps, q.bitrate], ["standard", 1920, 1080, 30, 8_000_000]);
});

test("pro recebe resolução, fps e bitrate pedidos", () => {
  assert.equal(resolveVideoQuality({ quality: "high", pro: true }).bitrate, 12_000_000);
  const qhd = resolveVideoQuality({ quality: "qhd", fps: 30, pro: true });
  assert.deepEqual([qhd.width, qhd.height, qhd.bitrate], [2560, 1440, 20_000_000]);
  const uhd = resolveVideoQuality({ quality: "uhd", fps: 60, pro: true });
  assert.deepEqual([uhd.width, uhd.height, uhd.fps, uhd.bitrate], [3840, 2160, 60, 60_000_000]);
});

test("valores inválidos caem no padrão", () => {
  const q = resolveVideoQuality({ quality: "x", fps: 24, pro: true });
  assert.deepEqual([q.id, q.fps], ["standard", 30]);
});

test("o export recebe uhd/60 no Pro e rebaixa o resto para standard/30", () => {
  assert.deepEqual(exportVideoOptions({ quality: "uhd", fps: "60", pro: true }), {
    quality: "uhd",
    fps: 60,
    pro: true,
  });
  assert.deepEqual(exportVideoOptions({ quality: "uhd", fps: 60, pro: false }), {
    quality: "standard",
    fps: 30,
    pro: false,
  });
  assert.doesNotThrow(() => {
    assert.deepEqual(exportVideoOptions({ quality: "x", fps: "x", pro: true }), {
      quality: "standard",
      fps: 30,
      pro: true,
    });
  });
});

test("o handler de export lê os selects e entrega o resultado do gate", () => {
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  const start = app.indexOf('getElementById("btn-export-video")');
  const handler = app.slice(start, app.indexOf("function showLinkCopied", start));
  assert.match(handler, /getElementById\("export-video-quality"\)/);
  assert.match(handler, /getElementById\("export-video-fps"\)/);
  assert.match(handler, /exportVideoOptions\(/);
  assert.match(handler, /quality: videoOpts\.quality/);
  assert.match(handler, /fps: videoOpts\.fps/);
  assert.equal(handler.includes('quality: "standard"'), false);
  assert.equal(handler.includes("fps: 30"), false);
});

test("nível H.264 adequado", () => {
  assert.equal(avcCodecCandidates(1920, 1080, 30)[0], "avc1.640028");
  assert.equal(avcCodecCandidates(1920, 1080, 60)[0], "avc1.64002a");
  assert.equal(avcCodecCandidates(2560, 1440, 30)[0], "avc1.640032");
  assert.equal(avcCodecCandidates(2560, 1440, 60)[0], "avc1.640033");
  assert.equal(avcCodecCandidates(3840, 2160, 30)[0], "avc1.640033");
  assert.equal(avcCodecCandidates(3840, 2160, 60)[0], "avc1.640034");
});
