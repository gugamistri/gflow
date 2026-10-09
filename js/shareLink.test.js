import assert from "node:assert/strict";
import test from "node:test";
import {
  hashSharePayload,
  permanentPublicUrl,
  permanentSlug,
  publishedPayloadFromShare,
  shareBaselineHash,
  shareFreshness,
  shareRecordIsStale,
  shouldRecreatePermanent,
} from "./shareLink.js";

function project(name = "Tour") {
  return {
    name,
    steps: [{ label: "Um", image: "data:image/png,abc" }],
    customImages: {},
    theme: { accent: "#111" },
    share: { writeToken: "segredo" },
    cloudShare: { url: "https://app.guiaflow.pro/v/antigo" },
  };
}

test("o endereço permanente mostrado é sempre guiaflow.pro/p", () => {
  assert.equal(
    permanentPublicUrl({ url: "https://app.guiaflow.pro/v/demo-rcv-90bc01", id: "sh_1" }),
    "https://guiaflow.pro/p/demo-rcv-90bc01"
  );
  assert.equal(
    permanentPublicUrl({ url: "https://guiaflow.pro/p/demo-rcv-90bc01" }),
    "https://guiaflow.pro/p/demo-rcv-90bc01"
  );
  assert.equal(permanentPublicUrl({ slug: "slug-permanente" }), "https://guiaflow.pro/p/slug-permanente");
  assert.equal(permanentSlug({ url: "https://app.guiaflow.pro/v/demo-rcv-90bc01" }), "demo-rcv-90bc01");
});

test("link antigo sem hash só fica desatualizado depois de o projeto mudar", () => {
  const original = project();
  const legacy = { url: "https://guiaflow.pro/p/x" };
  assert.equal(shareRecordIsStale(legacy, original), false);
  const baseline = shareBaselineHash(legacy, original);
  assert.equal(baseline, hashSharePayload(original));
  legacy.payloadHash = baseline;
  assert.equal(shareBaselineHash(legacy, original), "");
  assert.equal(shareRecordIsStale(legacy, original), false);
  const edited = project("Outro nome");
  assert.equal(shareRecordIsStale(legacy, edited), true);
  assert.equal(original.share.writeToken, "segredo");
  assert.equal(JSON.stringify(baseline).includes("segredo"), false);
});

test("projeto sem edição tem o mesmo hash que o payload publicado", () => {
  const dataUrl = "data:image/png,abc";
  const local = {
    name: "E2E Pro Test",
    theme: { accent: "#111111", accentDark: "#000000" },
    customImages: { img: { name: "tela.png", dataUrl } },
    steps: [
      {
        type: "slide",
        label: "Passo de teste",
        image: "custom:img",
        popover: { title: "Passo de teste", description: "Segundo passo." },
      },
    ],
    sceneLabels: { 2: "Cena" },
    share: { writeToken: "segredo" },
    id: "local-id",
    updatedAt: 123,
    cloudShare: { url: "https://guiaflow.pro/p/e2e-pro-test-c61771" },
  };
  const response = {
    ok: true,
    updatedAt: "2026-10-09T12:00:00.000Z",
    payload: {
      narration: { background: null, rate: 1, voiceURI: "", enabled: true },
      steps: [
        {
          popover: { description: "Segundo passo.", title: "Passo de teste" },
          image: dataUrl,
          label: "Passo de teste",
          type: "slide",
        },
      ],
      name: "E2E Pro Test",
      customImages: {},
      sceneLabels: { 2: "Cena" },
      theme: { accentDark: "#000000", accent: "#111111" },
      playback: { defaultHoldSeconds: 6 },
    },
  };
  const published = publishedPayloadFromShare(response);
  assert.equal(hashSharePayload(local), hashSharePayload(published));
  const edited = structuredClone(local);
  edited.steps[0].popover.title = "Título novo";
  assert.notEqual(hashSharePayload(edited), hashSharePayload(published));
  assert.equal(publishedPayloadFromShare({ ok: false, error: "not_found" }), null);
  assert.equal(publishedPayloadFromShare(null), null);
});

test("a frescura do link é agora, minutos, horas ou dias", () => {
  const now = Date.parse("2026-10-09T12:00:00.000Z");
  assert.equal(shareFreshness(now - 20_000, now).key, "share.updatedNow");
  assert.deepEqual(shareFreshness(now - 5 * 60_000, now), { key: "share.updatedMinutes", n: 5 });
  assert.deepEqual(shareFreshness(now - 3 * 60 * 60_000, now), { key: "share.updatedHours", n: 3 });
  assert.deepEqual(shareFreshness(now - 2 * 24 * 60 * 60_000, now), { key: "share.updatedDays", n: 2 });
});

test("404 e 403 recriam o link permanente; 500 não", () => {
  assert.equal(shouldRecreatePermanent({ status: 404, error: "not_found" }), true);
  assert.equal(shouldRecreatePermanent({ status: 403, data: { error: "not_owner" } }), true);
  assert.equal(shouldRecreatePermanent({ status: 500, error: "failed" }), false);
  assert.equal(shouldRecreatePermanent({ status: 402, error: "subscription_required" }), false);
});
