import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {
  IMAGE_MAX_EDGE,
  acceptOptimized,
  fitWithin,
  isOptimizableImage,
  optimizeImageDataUrl,
} from "./imageOptimize.js";
import {
  MUSIC_PROFILE,
  VOICE_PROFILE,
  acceptAudio,
  audioNeedsWork,
  mp3Bitrate,
  optimizeAudioDataUrl,
} from "./audioOptimize.js";
import {
  applyMediaMap,
  collectProjectMedia,
  optimizeProjectMedia,
  replaceMediaStrings,
} from "./projectOptimize.js";
import { createHistory } from "./history.js";
import { compressTourImages } from "./shareCompress.js";
import { bytesToDataUrl, dataUrlByteLength } from "./mediaBytes.js";

const dataUrl = (mime, n, fill = 1) => `data:${mime};base64,` + Buffer.alloc(n, fill).toString("base64");

/** Cabeçalho MP3 válido: MPEG-1 L3 (44,1 kHz) ou MPEG-2 L3 (24 kHz) no kbps pedido. */
function mp3Frame({ kbps, mpeg2 = false, id3 = false }) {
  const table = mpeg2 ? [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] : [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const index = table.indexOf(kbps);
  const head = [0xff, mpeg2 ? 0xf3 : 0xfb, (index << 4) | (1 << 2), 0xc4];
  const tag = id3 ? [0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 10, ...new Array(10).fill(0)] : [];
  return Uint8Array.from([...tag, ...head, ...new Array(30000).fill(0)]);
}

test("imagem: lado maior até 2560 px mantendo a proporção (hotspots em % não mudam)", () => {
  assert.deepEqual(fitWithin(2880, 1800), { width: 2560, height: 1600, resized: true });
  assert.deepEqual(fitWithin(1800, 2880), { width: 1600, height: 2560, resized: true });
  assert.deepEqual(fitWithin(1920, 1080), { width: 1920, height: 1080, resized: false });
  assert.equal(IMAGE_MAX_EDGE, 2560);
});

test("imagem: só troca quando vale (PNG menor; JPEG/WebP só com ganho real; GIF nunca)", () => {
  assert.equal(acceptOptimized({ beforeBytes: 1000, afterBytes: 900, sourceMime: "image/png", resized: false }), true);
  assert.equal(acceptOptimized({ beforeBytes: 1000, afterBytes: 1001, sourceMime: "image/png", resized: false }), false, "PNG pequeno com transparência fica");
  assert.equal(acceptOptimized({ beforeBytes: 1000, afterBytes: 950, sourceMime: "image/jpeg", resized: false }), false);
  assert.equal(acceptOptimized({ beforeBytes: 1000, afterBytes: 800, sourceMime: "image/webp", resized: false }), true);
  assert.equal(acceptOptimized({ beforeBytes: 1000, afterBytes: 1000, sourceMime: "image/jpeg", resized: true }), true);
  assert.equal(acceptOptimized({ beforeBytes: 1000, afterBytes: 10, sourceMime: "image/gif", resized: false }), false);
  assert.equal(isOptimizableImage(dataUrl("image/png", 10)), true);
  assert.equal(isOptimizableImage("data:image/svg+xml;base64,AAAA"), false);
  assert.equal(isOptimizableImage("demo/como-usar/01.png"), false);
});

test("imagem: optimizeImageDataUrl usa o resultado menor e nunca quebra", async () => {
  const src = dataUrl("image/png", 100000);
  const small = dataUrl("image/webp", 20000);
  const ok = await optimizeImageDataUrl(src, { encode: async () => ({ dataUrl: small, width: 2560, height: 1600, resized: true }) });
  assert.equal(ok.changed, true);
  assert.equal(ok.dataUrl, small);
  assert.equal(ok.afterBytes, 20000);
  const failed = await optimizeImageDataUrl(src, { encode: async () => { throw new Error("boom"); } });
  assert.deepEqual([failed.changed, failed.dataUrl], [false, src]);
  const tiny = await optimizeImageDataUrl(dataUrl("image/png", 500), { encode: async () => assert.fail("não processa imagem minúscula") });
  assert.equal(tiny.changed, false);
});

test("áudio: lê o kbps do MP3 (com e sem ID3) e só reprocessa o que está pesado", () => {
  assert.equal(mp3Bitrate(mp3Frame({ kbps: 128 })), 128);
  assert.equal(mp3Bitrate(mp3Frame({ kbps: 64, id3: true })), 64);
  assert.equal(mp3Bitrate(mp3Frame({ kbps: 48, mpeg2: true })), 48);
  const heavy = bytesToDataUrl(mp3Frame({ kbps: 128 }), "audio/mpeg");
  const light = bytesToDataUrl(mp3Frame({ kbps: 48, mpeg2: true }), "audio/mpeg");
  const tts64 = bytesToDataUrl(mp3Frame({ kbps: 64 }), "audio/mpeg");
  assert.equal(audioNeedsWork(heavy), true);
  assert.equal(audioNeedsWork(light), false);
  assert.equal(audioNeedsWork(tts64), false, "TTS novo (64 kbps) não é recodificado (sem perda dupla)");
  assert.equal(audioNeedsWork(dataUrl("audio/ogg", 40000)), true, "ogg/webm viram MP3 (iOS)");
  assert.deepEqual(VOICE_PROFILE, { kbps: 48, sampleRate: 24000, channels: 1 });
  assert.equal(MUSIC_PROFILE.channels, 2);
});

test("áudio: aceita MP3 só com ganho; formato sem suporte no iOS troca mesmo empatado", async () => {
  assert.equal(acceptAudio({ beforeBytes: 1000, afterBytes: 900, sourceMime: "audio/mpeg" }), false);
  assert.equal(acceptAudio({ beforeBytes: 1000, afterBytes: 400, sourceMime: "audio/mpeg" }), true);
  assert.equal(acceptAudio({ beforeBytes: 1000, afterBytes: 1100, sourceMime: "audio/webm" }), true);
  const heavy = bytesToDataUrl(mp3Frame({ kbps: 128 }), "audio/mpeg");
  const res = await optimizeAudioDataUrl(heavy, { encode: async (_src, profile) => ({ dataUrl: dataUrl("audio/mpeg", 11000), profile }) });
  assert.equal(res.changed, true);
  assert.equal(res.afterBytes, 11000);
  const broken = await optimizeAudioDataUrl(heavy, { encode: async () => { throw new Error("decode"); } });
  assert.equal(broken.dataUrl, heavy);
});

test("projeto: cada arquivo é processado uma vez; trilha de fundo usa o perfil de música", async () => {
  const img = dataUrl("image/png", 90000, 2);
  const voice = bytesToDataUrl(mp3Frame({ kbps: 128 }), "audio/mpeg");
  const music = bytesToDataUrl(mp3Frame({ kbps: 192 }), "audio/mpeg");
  const project = {
    customImages: { a: { dataUrl: img }, b: { dataUrl: img } },
    steps: [{ image: "custom:a", narrationAudio: { clips: [voice] } }, { image: img }],
    narration: { background: { dataUrl: music } },
    share: { cover: dataUrl("image/png", 90000, 3) },
  };
  const roles = collectProjectMedia(project);
  assert.equal(roles.size, 3, "capa do link fica de fora");
  assert.equal(roles.get(music).profile, MUSIC_PROFILE);
  assert.equal(roles.get(voice).profile, VOICE_PROFILE);
  const seen = [];
  const res = await optimizeProjectMedia(project, {
    optimizeImage: async (src) => (seen.push(src), { changed: true, dataUrl: dataUrl("image/webp", 9000) }),
    optimizeAudio: async (src, { profile }) => (seen.push(profile.kbps), { changed: true, dataUrl: dataUrl("audio/mpeg", 3000, profile.kbps) }),
  });
  assert.equal(seen.filter((s) => s === img).length, 1);
  assert.deepEqual(seen.filter((s) => typeof s === "number").sort(), [48, 96]);
  assert.ok(res.before - res.after > 100000, `${res.before} → ${res.after}`);
  const next = applyMediaMap(project, res.map);
  assert.equal(project.steps[1].image, img, "original intacto até Aplicar");
  assert.equal(next.customImages.b.dataUrl, next.steps[1].image);
  assert.equal(next.share.cover, project.share.cover);
});

test("troca em segundo plano: o desfazer também recebe a versão leve, sem passo novo", () => {
  const original = dataUrl("image/png", 5000, 4);
  const light = dataUrl("image/webp", 900, 5);
  const project = { steps: [{ image: "" }] };
  const history = createHistory();
  history.reset(project);
  history.noteChange();
  project.steps[0].image = original;
  history.settle(project);
  history.noteChange();
  project.steps.push({ image: original });
  history.settle(project);
  replaceMediaStrings(project, new Map([[original, light]]));
  assert.equal(history.replaceMedia(new Map([[original, light]])), 1);
  const back = history.undoChange(project);
  assert.equal(back.steps.length, 1);
  assert.equal(back.steps[0].image, light);
  assert.equal(JSON.stringify(history.exportStacks()).includes(original.slice(30, 60)), false);
});

test("publicar: rede de segurança não recodifica WebP já otimizado nem troca por ganho mínimo", async () => {
  const webp = dataUrl("image/webp", 200000);
  const jpeg = dataUrl("image/jpeg", 200000);
  const calls = [];
  const out = await compressTourImages(
    { steps: [{ image: webp }, { image: jpeg }] },
    { encode: async (src) => (calls.push(src), dataUrl("image/webp", 190000)) }
  );
  assert.deepEqual(calls, [jpeg]);
  assert.equal(out.steps[0].image, webp);
  assert.equal(out.steps[1].image, jpeg, "5% menor não compensa perda de geração");
});

test("worker: o LAME embutido grava MP3 mono 48 kbps 24 kHz (toca em iOS, export HTML e vídeo)", async () => {
  const posted = [];
  const sandbox = {
    console,
    URL,
    Blob,
    Uint8Array,
    self: { location: { href: new URL("./mediaWorker.js", import.meta.url).href }, postMessage: (msg) => posted.push(msg) },
  };
  sandbox.importScripts = (href) => vm.runInContext(readFileSync(new URL(href)), sandbox);
  vm.createContext(sandbox);
  sandbox.self.importScripts = sandbox.importScripts;
  vm.runInContext(readFileSync(new URL("./mediaWorker.js", import.meta.url), "utf8").replace(/\bself\.onmessage\b/, "globalThis.onmessage"), sandbox);
  vm.runInContext("var self = globalThis.self; var lamejs; importScripts = globalThis.importScripts;", sandbox);
  const rate = 24000;
  const pcm = new Int16Array(rate * 2);
  for (let i = 0; i < pcm.length; i += 1) pcm[i] = Math.round(Math.sin((i * 2 * Math.PI * 220) / rate) * 8000);
  await sandbox.onmessage({ data: { id: 1, kind: "mp3", channels: [pcm], sampleRate: rate, kbps: 48 } });
  const msg = posted[0];
  assert.equal(msg.ok, true, msg.error);
  assert.equal(msg.mime, "audio/mpeg");
  const bytes = msg.bytes;
  assert.equal(mp3Bitrate(bytes), 48);
  const i = bytes.findIndex((b, k) => b === 0xff && (bytes[k + 1] & 0xe0) === 0xe0);
  assert.equal((bytes[i + 1] >> 3) & 0x03, 2, "MPEG-2 (24 kHz)");
  assert.equal((bytes[i + 3] >> 6) & 0x03, 3, "mono");
  assert.ok(bytes.length < 2 * 48000 / 8 + 2000);
});

test("tour de exemplo: só formatos que todos os players tocam, imagens ≤ 2560 px, narração leve", () => {
  const demo = JSON.parse(readFileSync(new URL("../data/demo.json", import.meta.url), "utf8"));
  const text = JSON.stringify(demo);
  const mimes = new Set([...text.matchAll(/data:([a-z]+\/[a-z0-9.+-]+);base64/g)].map((m) => m[1]));
  for (const mime of mimes) assert.ok(["image/webp", "image/jpeg", "image/png", "audio/mpeg"].includes(mime), mime);
  for (const ref of demo.steps.map((s) => s.image).filter((r) => r?.startsWith("custom:"))) {
    assert.ok(demo.customImages[ref.slice(7)], `imagem ${ref} existe`);
  }
  for (const { dataUrl: src } of Object.values(demo.customImages)) {
    const bytes = Buffer.from(src.slice(src.indexOf(",") + 1), "base64");
    if (!src.startsWith("data:image/webp")) continue;
    assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
    const chunk = bytes.toString("ascii", 12, 16);
    let w = 0;
    let h = 0;
    if (chunk === "VP8 ") {
      w = bytes.readUInt16LE(26) & 0x3fff;
      h = bytes.readUInt16LE(28) & 0x3fff;
    } else if (chunk === "VP8X") {
      w = 1 + bytes.readUIntLE(24, 3);
      h = 1 + bytes.readUIntLE(27, 3);
    }
    assert.ok(Math.max(w, h) <= 2560 && w > 0, `${w}x${h}`);
  }
  for (const step of demo.steps) {
    for (const clip of step.narrationAudio?.clips || []) {
      const kbps = mp3Bitrate(Buffer.from(clip.slice(clip.indexOf(",") + 1, clip.indexOf(",") + 40000), "base64"));
      assert.ok(kbps > 0 && kbps <= 64, `narração em ${kbps} kbps`);
    }
  }
  assert.ok(Buffer.byteLength(text) < 4 * 1024 * 1024, "demo.json abaixo de 4 MB");
  assert.ok(dataUrlByteLength(Object.values(demo.customImages)[0].dataUrl) > 0);
});
