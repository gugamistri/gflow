import assert from "node:assert/strict";
import test from "node:test";
import { setLocale } from "./i18n.js";
import { permanentShareErrorMessage, publishPermanentShare } from "./share.js";

setLocale("pt", { persist: false });

const env = { baseUrl: "https://guiaflow.pro", accessToken: "jwt-session" };

function project() {
  return {
    name: "Tour da nuvem",
    share: { id: "blob", writeToken: "secret-write-token" },
    steps: [{ title: "Um" }],
  };
}

test("sem URL base o link permanente não chama a rede", async () => {
  const prev = globalThis.fetch;
  let called = 0;
  globalThis.fetch = async () => {
    called += 1;
    throw new Error("network");
  };
  try {
    await assert.rejects(
      () => publishPermanentShare(project(), { env: { baseUrl: "" }, buildSnapshot: async () => ({}) }),
      (err) => err.code === "cloud-not-configured" && /não está configurada/.test(err.message)
    );
    assert.equal(called, 0);
  } finally {
    if (prev === undefined) delete globalThis.fetch;
    else globalThis.fetch = prev;
  }
});

test("POST /shares devolve o URL e não leva o bearer no corpo", async () => {
  const prev = globalThis.fetch;
  let seen = null;
  globalThis.fetch = async (url, init) => {
    seen = { url: String(url), init };
    return {
      ok: true,
      status: 201,
      json: async () => ({ id: "sh_1", url: "/v/slug-permanente" }),
    };
  };
  try {
    const share = await publishPermanentShare(project(), {
      env,
      buildSnapshot: async () => ({ name: "Tour da nuvem", steps: [{ title: "Um" }] }),
    });
    assert.equal(share.url, "https://guiaflow.pro/v/slug-permanente");
    assert.equal(share.id, "sh_1");
    assert.equal(seen.url, "https://guiaflow.pro/shares");
    assert.equal(new Headers(seen.init.headers).get("authorization"), "Bearer jwt-session");
    const body = JSON.parse(seen.init.body);
    assert.equal(body.title, "Tour da nuvem");
    assert.equal(body.tour.steps[0].title, "Um");
    assert.equal(seen.init.body.includes("jwt-session"), false);
    assert.equal(seen.init.body.includes("secret-write-token"), false);
    assert.equal(body.tour.share, undefined);
  } finally {
    if (prev === undefined) delete globalThis.fetch;
    else globalThis.fetch = prev;
  }
});

test("share_limit, 401 e rede têm mensagens claras", async () => {
  assert.equal(
    permanentShareErrorMessage({ error: "share_limit", data: { plan: "free" } }),
    "Limite de links do plano Free"
  );
  assert.equal(
    permanentShareErrorMessage({ error: "share_limit", data: { plan: "cloud", limit: 25 } }),
    "Limite de links do plano Cloud"
  );
  assert.match(permanentShareErrorMessage({ status: 401, error: "unauthorized" }), /sessão da nuvem/i);
  assert.match(permanentShareErrorMessage({ error: "network" }), /contactar a nuvem/);

  const prev = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 403,
    json: async () => ({ error: "share_limit", plan: "free" }),
  });
  try {
    await assert.rejects(
      () =>
        publishPermanentShare(project(), {
          env,
          buildSnapshot: async () => ({ name: "Tour", steps: [] }),
        }),
      (err) => err.code === "share_limit" && err.message === "Limite de links do plano Free"
    );
  } finally {
    if (prev === undefined) delete globalThis.fetch;
    else globalThis.fetch = prev;
  }
});
