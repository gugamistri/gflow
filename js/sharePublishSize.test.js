import assert from "node:assert/strict";
import test from "node:test";
import { catalogs, setLocale } from "./i18n.js";
import { cloudFetch } from "./cloudConfig.js";
import { permanentShareErrorMessage, publishPermanentShare } from "./share.js";
import {
  SHARE_MAX_BODY_BYTES,
  compressTourImages,
  formatMb,
  uploadTimeoutMs,
  utf8Bytes,
} from "./shareCompress.js";

setLocale("pt", { persist: false });

const env = { baseUrl: "https://app.guiaflow.pro", accessToken: "jwt-session" };
const project = () => ({ name: "Tour", steps: [{ title: "Um" }] });
const fast = { buildCover: async () => ({ dataUrl: "data:image/jpeg;base64,AAAA" }), measureRatio: async () => "16:9" };
const noCompress = async (tour) => tour;

async function withFetch(impl, fn) {
  const prev = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete globalThis.fetch;
    else globalThis.fetch = prev;
  }
}

function hangingFetch(calls) {
  return (_url, init) => {
    calls.push(init);
    return new Promise((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });
  };
}

test("tour acima do limite falha na hora, sem upload, com X MB de Y MB", async () => {
  const calls = [];
  const big = { name: "Tour", steps: [{ image: `data:image/png;base64,${"A".repeat(13 * 1024 * 1024)}` }] };
  await withFetch(async (...a) => { calls.push(a); return { ok: true, status: 201, json: async () => ({}) }; }, async () => {
    await assert.rejects(
      () => publishPermanentShare(project(), { env, ...fast, compress: noCompress, buildSnapshot: async () => big }),
      (err) =>
        err.code === "payload_too_large" &&
        /O tour é grande demais para o link permanente \(13,1 MB de 12 MB\)/.test(err.message) &&
        /comprima as imagens/.test(err.message)
    );
  });
  assert.equal(calls.length, 0);
});

test("acima do limite só por causa da capa: publica sem a capa", async () => {
  const seen = [];
  const almost = { name: "Tour", steps: [{ image: "A".repeat(SHARE_MAX_BODY_BYTES - 200) }] };
  await withFetch(async (url, init) => {
    seen.push(JSON.parse(init.body));
    return { ok: true, status: 201, json: async () => ({ share: { slug: "s-1", url: "https://guiaflow.pro/p/s-1" } }) };
  }, async () => {
    const share = await publishPermanentShare(project(), {
      env, compress: noCompress, buildSnapshot: async () => almost,
      buildCover: async () => ({ dataUrl: `data:image/jpeg;base64,${"B".repeat(2000)}` }), measureRatio: async () => "",
    });
    assert.equal(share.coverSkipped, true);
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].cover, undefined);
});

test("413 payload_too_large do servidor não reenvia o tour (antes subia duas vezes)", async () => {
  const calls = [];
  await withFetch(async (url, init) => {
    calls.push(init.method);
    return {
      ok: false, status: 413,
      json: async () => ({ ok: false, error: "payload_too_large", message: "O tour passa do limite de 4 MB.", limitBytes: 4 * 1024 * 1024 }),
    };
  }, async () => {
    await assert.rejects(
      () => publishPermanentShare(project(), { env, ...fast, compress: noCompress, buildSnapshot: async () => ({ steps: [{ image: "A".repeat(5 * 1024 * 1024) }] }) }),
      (err) => err.code === "payload_too_large" && /\(5,1 MB de 4 MB\)/.test(err.message)
    );
  });
  assert.deepEqual(calls, ["POST"]);
});

test("413 de proxy (HTML, sem código) também vira mensagem de tamanho, sem repetir", async () => {
  const calls = [];
  await withFetch(async (url, init) => {
    calls.push(init.method);
    return { ok: false, status: 413, json: async () => { throw new SyntaxError("html"); } };
  }, async () => {
    await assert.rejects(
      () => publishPermanentShare(project(), { env, ...fast, compress: noCompress, slug: "velho", buildSnapshot: async () => ({ steps: [] }) }),
      (err) => err.code === "payload_too_large" && /grande demais/.test(err.message)
    );
  });
  assert.deepEqual(calls, ["PUT"]);
});

test("capa recusada (cover_too_large) ainda reenvia sem a capa", async () => {
  const bodies = [];
  await withFetch(async (url, init) => {
    bodies.push(JSON.parse(init.body));
    if (bodies.length === 1) return { ok: false, status: 413, json: async () => ({ ok: false, error: "cover_too_large" }) };
    return { ok: true, status: 201, json: async () => ({ share: { slug: "s-2", url: "https://guiaflow.pro/p/s-2" } }) };
  }, async () => {
    const share = await publishPermanentShare(project(), { env, ...fast, compress: noCompress, buildSnapshot: async () => ({ steps: [] }) });
    assert.equal(share.coverSkipped, true);
  });
  assert.equal(bodies.length, 2);
  assert.ok(bodies[0].cover);
  assert.equal(bodies[1].cover, undefined);
});

test("cloudFetch com prazo: fetch parado vira error timeout", async () => {
  const calls = [];
  await withFetch(hangingFetch(calls), async () => {
    const res = await cloudFetch("/shares", { method: "POST", body: "{}", timeoutMs: 30 }, env);
    assert.equal(res.ok, false);
    assert.equal(res.error, "timeout");
  });
  assert.match(permanentShareErrorMessage({ error: "timeout" }), /demorou demais/);
});

test("cloudFetch com sinal: cancelar solta o pedido parado", async () => {
  const calls = [];
  const ctl = new AbortController();
  await withFetch(hangingFetch(calls), async () => {
    const pending = cloudFetch("/shares", { method: "POST", body: "{}", signal: ctl.signal }, env);
    setTimeout(() => ctl.abort(), 10);
    const res = await pending;
    assert.equal(res.error, "aborted");
  });
});

test("capa que nunca termina não segura a publicação", async () => {
  await withFetch(async () => ({ ok: true, status: 201, json: async () => ({ share: { slug: "s-3", url: "https://guiaflow.pro/p/s-3" } }) }), async () => {
    const share = await publishPermanentShare(project(), {
      env, compress: noCompress, buildSnapshot: async () => ({ steps: [] }),
      buildCover: () => new Promise(() => {}), measureRatio: () => new Promise(() => {}), coverTimeoutMs: 20,
    });
    assert.equal(share.slug, "s-3");
    assert.equal(share.coverSkipped, true);
  });
});

test("montagem do tour parada vira erro de prazo; cancelar também solta", async () => {
  await assert.rejects(
    () => publishPermanentShare(project(), { env, ...fast, buildSnapshot: () => new Promise(() => {}), snapshotTimeoutMs: 20 }),
    (err) => err.code === "timeout" && /demorou demais/.test(err.message)
  );
  const ctl = new AbortController();
  setTimeout(() => ctl.abort(), 10);
  await assert.rejects(
    () => publishPermanentShare(project(), { env, ...fast, signal: ctl.signal, snapshotTimeoutMs: 200, buildSnapshot: () => new Promise(() => {}) }),
    (err) => err.code === "aborted"
  );
});

test("compressTourImages: troca só o que ficou menor, uma vez por imagem, e guarda a original se falhar", async () => {
  const png = `data:image/png;base64,${"P".repeat(100_000)}`;
  const other = `data:image/png;base64,${"Q".repeat(100_000)}`;
  const broken = `data:image/png;base64,${"R".repeat(100_000)}`;
  const tiny = `data:image/png;base64,${"T".repeat(100)}`;
  const tour = { steps: [{ image: png }, { image: png }, { image: other }, { image: broken }, { image: tiny }, { image: "custom:x" }] };
  const encoded = [];
  const out = await compressTourImages(tour, {
    encode: async (src) => {
      encoded.push(src);
      if (src === other) return `data:image/webp;base64,${"W".repeat(200_000)}`;
      if (src === broken) throw new Error("decode");
      return "data:image/webp;base64,SMALL";
    },
  });
  assert.equal(encoded.length, 3);
  assert.equal(out.steps[0].image, "data:image/webp;base64,SMALL");
  assert.equal(out.steps[1].image, "data:image/webp;base64,SMALL");
  assert.equal(out.steps[2].image, other);
  assert.equal(out.steps[3].image, broken);
  assert.equal(out.steps[4].image, tiny);
  assert.equal(out.steps[5].image, "custom:x");
  assert.equal(tour.steps[0].image, png, "não muda o projeto original");
});

test("compressTourImages: encode parado cai no prazo e mantém a original", async () => {
  const png = `data:image/png;base64,${"P".repeat(100_000)}`;
  const out = await compressTourImages({ steps: [{ image: png }] }, { encode: () => new Promise(() => {}), timeoutMs: 20 });
  assert.equal(out.steps[0].image, png);
});

test("tamanhos, prazo de envio e textos em pt, es e en", () => {
  assert.equal(utf8Bytes("ção"), 5);
  assert.equal(formatMb(9.4 * 1024 * 1024, "pt"), "9,4");
  assert.equal(formatMb(9.4 * 1024 * 1024, "en"), "9.4");
  assert.equal(formatMb(4 * 1024 * 1024, "pt"), "4");
  assert.equal(uploadTimeoutMs(0), 60_000);
  assert.equal(uploadTimeoutMs(12 * 1024 * 1024), 60_000 + 192_000);
  assert.equal(uploadTimeoutMs(500 * 1024 * 1024), 6 * 60_000);
  const keys = ["share.cloud.tooLarge", "share.cloud.tooLargeNoSize", "share.cloud.timeout", "share.cloud.aborted", "share.cloud.progressSize", "share.cloud.failedTitle", "share.compress.progress", "share.retry"];
  for (const locale of ["pt", "es", "en"]) for (const key of keys) assert.ok(catalogs[locale][key], `${locale} ${key}`);
  setLocale("es", { persist: false });
  assert.match(permanentShareErrorMessage({ status: 413, error: "payload_too_large", data: { limitBytes: 12 * 1024 * 1024 }, sizeBytes: 13 * 1024 * 1024 }), /demasiado grande .*\(13 MB de 12 MB\)/);
  setLocale("en", { persist: false });
  assert.match(permanentShareErrorMessage({ status: 413, error: "payload_too_large", sizeBytes: 9.4 * 1024 * 1024 }), /too large .*\(9\.4 MB of 4 MB\)/);
  setLocale("pt", { persist: false });
});
