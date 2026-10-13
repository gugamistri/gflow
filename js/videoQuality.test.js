import test from "node:test";
import assert from "node:assert/strict";
import { resolveVideoQuality, avcCodecCandidates } from "./videoQuality.js";

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

test("nível H.264 adequado", () => {
  assert.equal(avcCodecCandidates(1920, 1080, 30)[0], "avc1.640028");
  assert.equal(avcCodecCandidates(1920, 1080, 60)[0], "avc1.64002a");
  assert.equal(avcCodecCandidates(2560, 1440, 30)[0], "avc1.640032");
  assert.equal(avcCodecCandidates(2560, 1440, 60)[0], "avc1.640033");
  assert.equal(avcCodecCandidates(3840, 2160, 30)[0], "avc1.640033");
  assert.equal(avcCodecCandidates(3840, 2160, 60)[0], "avc1.640034");
});
