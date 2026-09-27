import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import {
  assertShareSnapshotSafe,
  prepareSharePayload,
  shareViewUrl,
} from "./shareSnapshot.js";
import { embedImagesInDemo } from "./exportPack.js";
import { defaultTheme } from "./themes.js";
import { defaultNarration, defaultPlayback } from "./playback.js";

const require = createRequire(import.meta.url);
const {
  hashToken,
  tokensMatch,
  createShareIds,
  isShareId,
  tourPathname,
  metaPathname,
} = require("../api/lib/share-crypto.cjs");

test("prepareSharePayload omite share e writeToken", () => {
  const project = {
    id: "proj-local",
    name: "Demo",
    share: { id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", writeToken: "SECRET_TOKEN_XYZ", updatedAt: 1 },
    theme: defaultTheme(),
    customImages: {},
    steps: [{ type: "screen", title: "A", image: "data:image/png;base64,xx" }],
    sceneLabels: {},
    playback: defaultPlayback(),
    narration: defaultNarration(),
    createdAt: 1,
    updatedAt: 2,
  };
  const payload = prepareSharePayload(project);
  assert.equal(payload.share, undefined);
  assert.equal(payload.id, undefined);
  assert.equal(payload.name, "Demo");
  assertShareSnapshotSafe(payload, "SECRET_TOKEN_XYZ");
  assert.throws(() => assertShareSnapshotSafe({ ...payload, share: project.share }, "SECRET_TOKEN_XYZ"));
});

test("embedImagesInDemo embute custom: sem rede", async () => {
  const dataUrl = "data:image/png;base64,QQ==";
  const out = await embedImagesInDemo({
    name: "t",
    theme: defaultTheme(),
    steps: [{ type: "screen", title: "1", image: "custom:img1" }],
    customImages: { img1: { dataUrl, name: "a.png" } },
    playback: defaultPlayback(),
    narration: defaultNarration(),
  });
  assert.equal(out.steps[0].image, dataUrl);
  assert.deepEqual(out.customImages, {});
});

test("shareViewUrl monta /v/:id", () => {
  assert.equal(
    shareViewUrl("Ab3xY9kLm2Q", "https://guiaflow-seven.vercel.app"),
    "https://guiaflow-seven.vercel.app/v/Ab3xY9kLm2Q"
  );
});

test("hashToken e tokensMatch", () => {
  const token = "write-token-example";
  const hash = hashToken(token);
  assert.equal(hash.length, 64);
  assert.equal(tokensMatch(token, hash), true);
  assert.equal(tokensMatch("wrong", hash), false);
  assert.equal(tokensMatch("", hash), false);
  assert.equal(tokensMatch(token, ""), false);
});

test("createShareIds gera id curto estilo YouTube", () => {
  const { id, writeToken } = createShareIds();
  assert.equal(id.length, 11);
  assert.equal(isShareId(id), true);
  assert.ok(writeToken.length > 20);
  assert.equal(tourPathname(id), `shares/${id}.json`);
  assert.equal(metaPathname(id), `shares/${id}.meta.json`);
  assert.equal(isShareId("short"), false);
  assert.equal(isShareId("ggggggggggg"), true); // 11 letras válidas
  assert.equal(isShareId("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), true); // legado hex
  assert.equal(isShareId("zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"), false); // hex inválido
});
