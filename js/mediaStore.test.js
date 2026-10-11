import assert from "node:assert/strict";
import test from "node:test";
import {
  collectMediaRefs,
  createMediaCodec,
  externalizeMedia,
  internalizeMedia,
  isMediaToken,
  mediaFootprint,
  parseMediaToken,
} from "./mediaStore.js";
import { dataUrlByteLength, dataUrlToBytes, formatBytes, sha256Hex } from "./mediaBytes.js";
import { dehydrate } from "./cloudSync.js";

const png = (fill, n = 4000) => "data:image/png;base64," + Buffer.alloc(n, fill).toString("base64");
const mp3 = (fill, n = 4000) => "data:audio/mpeg;base64," + Buffer.alloc(n, fill).toString("base64");

function memoryStore() {
  const rows = new Map();
  return {
    rows,
    put(blobs) {
      for (const [sha, entry] of blobs) {
        const bytes = entry.bytes || dataUrlToBytes(entry.dataUrl).bytes;
        rows.set(sha, { sha, mime: entry.mime, size: entry.size, blob: new Blob([bytes], { type: entry.mime }) });
      }
    },
    async load(shas) {
      return new Map(shas.filter((s) => rows.has(s)).map((s) => [s, rows.get(s)]));
    },
  };
}

test("o disco guarda ficha + bytes uma vez só; ler devolve o data URL idêntico", async () => {
  const a = png(1);
  const project = {
    name: "T",
    customImages: { x: { dataUrl: a }, y: { dataUrl: a } },
    steps: [{ image: "custom:x", narrationAudio: { clips: [mp3(2)] } }, { image: a }],
    tiny: "data:image/png;base64,AAAA",
  };
  const codec = createMediaCodec();
  const ext = await externalizeMedia(project, codec);
  assert.equal(ext.blobs.size, 2, "imagem repetida vira um arquivo só");
  assert.ok(isMediaToken(ext.value.customImages.x.dataUrl));
  assert.equal(ext.value.customImages.x.dataUrl, ext.value.steps[1].image);
  assert.equal(ext.value.tiny, project.tiny, "data: pequeno fica inline");
  assert.equal(JSON.stringify(ext.value).includes("base64,AQEB"), false);
  assert.equal(project.customImages.x.dataUrl, a, "não mexe no objeto da memória");

  const store = memoryStore();
  store.put(ext.blobs);
  const back = await internalizeMedia(ext.value, createMediaCodec(), store.load.bind(store));
  assert.deepEqual(back.value, project);
  assert.deepEqual(back.missing, []);
});

test("a chave é o sha256 dos bytes — a mesma da sincronização do Pro (PUT /media/:sha)", async () => {
  const a = png(9);
  const ext = await externalizeMedia({ image: a }, createMediaCodec());
  const { sha } = parseMediaToken(ext.value.image);
  assert.equal(sha, await sha256Hex(dataUrlToBytes(a).bytes));
  const synced = await dehydrate({ image: a });
  assert.equal(synced.payload.image, `asset:${sha}`);
  assert.equal(parseMediaToken(ext.value.image).size, dataUrlByteLength(a));
});

test("registro antigo (data: inline) e ficha convivem; ficha sem arquivo não é apagada", async () => {
  const a = png(3);
  const codec = createMediaCodec();
  const ext = await externalizeMedia({ img: a }, codec);
  const legacy = { old: png(4), img: ext.value.img };
  const store = memoryStore();
  const read = await internalizeMedia(legacy, createMediaCodec(), store.load.bind(store));
  assert.equal(read.value.old, legacy.old);
  assert.equal(read.value.img, ext.value.img, "sem o arquivo a ficha fica (nada some do projeto)");
  assert.equal(read.missing.length, 1);
  // já externalizado: a ficha passa direto e é contada
  const again = await externalizeMedia(read.value, codec);
  assert.equal(again.value.img, ext.value.img);
  assert.equal(again.refs.size, 2);
});

test("o cache da sessão não refaz o hash nem relê o Blob", async () => {
  const a = png(5);
  const codec = createMediaCodec();
  const first = await externalizeMedia({ a }, codec);
  assert.ok(first.blobs.get(parseMediaToken(first.value.a).sha).bytes, "arquivo novo leva os bytes");
  const second = await externalizeMedia({ a }, codec);
  assert.equal(second.blobs.get(parseMediaToken(second.value.a).sha).bytes, null, "conhecido: sem decodificar de novo");
  let loads = 0;
  const back = await internalizeMedia(first.value, codec, async () => {
    loads += 1;
    return new Map();
  });
  assert.equal(back.value.a, a);
  assert.equal(loads, 0);
});

test("tamanho do projeto: arquivos contados uma vez, com ou sem fichas", async () => {
  const a = png(6, 30000);
  const project = { steps: [{ image: a }, { image: a }], name: "x" };
  const inline = mediaFootprint(project);
  const ext = await externalizeMedia(project, createMediaCodec());
  const stored = mediaFootprint(ext.value);
  assert.equal(inline.files, 1);
  assert.equal(stored.mediaBytes, 30000);
  assert.ok(Math.abs(inline.bytes - stored.bytes) < 200);
  assert.equal(collectMediaRefs(ext.value).size, 1);
});

test("formatBytes é discreto e respeita o separador do idioma", () => {
  assert.equal(formatBytes(4.2 * 1024 * 1024, "pt"), "4,2 MB");
  assert.equal(formatBytes(4.2 * 1024 * 1024, "en"), "4.2 MB");
  assert.equal(formatBytes(12.4 * 1024 * 1024, "pt"), "12 MB");
  assert.equal(formatBytes(300 * 1024, "es"), "300 KB");
});
