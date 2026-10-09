import assert from "node:assert/strict";
import test from "node:test";
import { setLocale } from "./i18n.js";
import { copyText, permanentShareErrorMessage, publishPermanentShare } from "./share.js";

setLocale("pt", { persist: false });

const env = { baseUrl: "https://app.guiaflow.pro", accessToken: "jwt-session" };

function project() {
  return {
    name: "Tour da nuvem",
    share: { id: "blob", writeToken: "secret-write-token" },
    steps: [{ title: "Um" }],
  };
}

test("copyText cai no textarea quando o clipboard rejeita", async () => {
  const prevNav = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const prevDoc = globalThis.document;
  let stored = "";
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      clipboard: {
        writeText: async () => {
          throw new Error("Document is not focused");
        },
      },
    },
  });
  globalThis.document = {
    createElement() {
      const el = { style: {} };
      el.setAttribute = () => {};
      el.select = () => {};
      Object.defineProperty(el, "value", {
        get() { return stored; },
        set(v) { stored = String(v); },
      });
      return el;
    },
    body: { appendChild() {}, removeChild() {} },
    execCommand() { return true; },
  };
  try {
    await copyText("https://app.guiaflow.pro/v/slug-teste");
    assert.equal(stored, "https://app.guiaflow.pro/v/slug-teste");
  } finally {
    if (prevNav) Object.defineProperty(globalThis, "navigator", prevNav);
    else delete globalThis.navigator;
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
  }
});

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
      (err) => err.code === "cloud-not-configured" && /não está configurada/.test(err.message) && !/nuvem/i.test(err.message)
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
    assert.equal(share.url, "https://guiaflow.pro/p/slug-permanente");
    assert.equal(share.slug, "slug-permanente");
    assert.equal(seen.url, "https://app.guiaflow.pro/shares");
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

test("URL absoluta em guiaflow.pro/p fica como a API devolveu", async () => {
  const prev = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 201,
    json: async () => ({
      ok: true,
      share: { id: "slug-permanente", slug: "slug-permanente", url: "https://guiaflow.pro/p/slug-permanente" },
    }),
  });
  try {
    const share = await publishPermanentShare(project(), {
      env,
      buildSnapshot: async () => ({ name: "Tour da nuvem", steps: [{ title: "Um" }] }),
    });
    assert.equal(share.url, "https://guiaflow.pro/p/slug-permanente");
    assert.equal(share.url.includes("app.guiaflow.pro"), false);
    assert.equal(share.id, "slug-permanente");
  } finally {
    if (prev === undefined) delete globalThis.fetch;
    else globalThis.fetch = prev;
  }
});

test("PUT /shares/:slug atualiza no lugar e 404 ou 403 criam outro", async () => {
  const prev = globalThis.fetch;
  const cases = [
    { status: 404, body: { ok: false, error: "not_found" } },
    { status: 403, body: { ok: false, error: "not_owner" } },
  ];
  try {
    for (const item of cases) {
      const seen = [];
      globalThis.fetch = async (url, init) => {
        seen.push({ url: String(url), method: init.method, body: init.body });
        if (init.method === "PUT") {
          return { ok: false, status: item.status, json: async () => item.body };
        }
        return {
          ok: true,
          status: 201,
          json: async () => ({
            ok: true,
            share: { slug: "novo-slug", url: "https://app.guiaflow.pro/v/novo-slug", createdAt: "2026-10-09T00:00:00.000Z", updatedAt: "2026-10-09T00:00:00.000Z" },
          }),
        };
      };
      const share = await publishPermanentShare(project(), {
        env,
        slug: "slug-velho",
        buildSnapshot: async () => ({ name: "Tour", steps: [{ title: "Um" }] }),
      });
      assert.equal(seen[0].method, "PUT");
      assert.equal(seen[0].url, "https://app.guiaflow.pro/shares/slug-velho");
      assert.equal(JSON.parse(seen[0].body).tour.steps[0].title, "Um");
      assert.equal(seen[1].method, "POST");
      assert.equal(seen[1].url, "https://app.guiaflow.pro/shares");
      assert.equal(share.url, "https://guiaflow.pro/p/novo-slug");
      assert.equal(share.slug, "novo-slug");
    }
  } finally {
    if (prev === undefined) delete globalThis.fetch;
    else globalThis.fetch = prev;
  }
});

test("PUT 200 reescreve app.guiaflow.pro/v para guiaflow.pro/p e 500 não cria outro", async () => {
  const prev = globalThis.fetch;
  try {
    let calls = 0;
    globalThis.fetch = async (url, init) => {
      calls += 1;
      assert.equal(init.method, "PUT");
      assert.equal(String(url), "https://app.guiaflow.pro/shares/demo-rcv-90bc01");
      const sent = JSON.parse(init.body);
      assert.equal(sent.title, "Tour da nuvem");
      assert.ok(sent.tour);
      assert.equal(sent.payloadRef, undefined);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          share: {
            slug: "demo-rcv-90bc01",
            url: "https://app.guiaflow.pro/v/demo-rcv-90bc01",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-10-09T12:00:00.000Z",
          },
        }),
      };
    };
    const share = await publishPermanentShare(project(), {
      env,
      slug: "demo-rcv-90bc01",
      buildSnapshot: async () => ({ name: "Tour", steps: [] }),
    });
    assert.equal(calls, 1);
    assert.equal(share.url, "https://guiaflow.pro/p/demo-rcv-90bc01");
    assert.equal(share.updatedAt, Date.parse("2026-10-09T12:00:00.000Z"));

    calls = 0;
    globalThis.fetch = async (_url, init) => {
      calls += 1;
      assert.equal(init.method, "PUT");
      return { ok: false, status: 500, json: async () => ({ ok: false, error: "failed" }) };
    };
    await assert.rejects(
      () =>
        publishPermanentShare(project(), {
          env,
          slug: "demo-rcv-90bc01",
          buildSnapshot: async () => ({ name: "Tour", steps: [] }),
        }),
      (err) => err.status === 500
    );
    assert.equal(calls, 1);
  } finally {
    if (prev === undefined) delete globalThis.fetch;
    else globalThis.fetch = prev;
  }
});

test("401 e 402 no PUT não criam outro link", async () => {
  const prev = globalThis.fetch;
  try {
    for (const status of [401, 402]) {
      let posts = 0;
      globalThis.fetch = async (_url, init) => {
        if (init.method === "POST") posts += 1;
        return {
          ok: false,
          status,
          json: async () => ({
            ok: false,
            error: status === 401 ? "unauthorized" : "subscription_required",
          }),
        };
      };
      await assert.rejects(
        () =>
          publishPermanentShare(project(), {
            env,
            slug: "demo-rcv-90bc01",
            buildSnapshot: async () => ({ name: "Tour", steps: [{ title: "Um" }] }),
          }),
        (err) => err.status === status
      );
      assert.equal(posts, 0);
    }
  } finally {
    if (prev === undefined) delete globalThis.fetch;
    else globalThis.fetch = prev;
  }
});

test("402 subscription_required abre o gate sem dizer nuvem", async () => {
  const message =
    "Disponível no GuiaFlow Cloud. Assine para gerar links permanentes e textos/áudios com IA.";
  assert.equal(
    permanentShareErrorMessage({
      status: 402,
      error: "subscription_required",
      message,
      data: { code: "subscription_required", feature: "permanentShare", plan: "free", message },
    }),
    message
  );
  assert.equal(/nuvem/i.test(permanentShareErrorMessage({ status: 402, error: "subscription_required" })), false);
  assert.match(permanentShareErrorMessage({ status: 429, error: "quota_exceeded" }), /cota/i);
  assert.match(permanentShareErrorMessage({ status: 503 }), /[Ii]ndisponível/);

  const prev = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 402,
    json: async () => ({
      ok: false,
      code: "subscription_required",
      feature: "permanentShare",
      plan: "free",
      message,
    }),
  });
  try {
    await assert.rejects(
      () =>
        publishPermanentShare(project(), {
          env,
          buildSnapshot: async () => ({ name: "Tour", steps: [] }),
        }),
      (err) =>
        err.code === "subscription_required" &&
        err.status === 402 &&
        err.feature === "permanentShare" &&
        err.plan === "free" &&
        err.message === message &&
        !/nuvem/i.test(err.message)
    );
  } finally {
    if (prev === undefined) delete globalThis.fetch;
    else globalThis.fetch = prev;
  }
});

test("share_limit, 401 e rede têm mensagens claras", async () => {
  assert.equal(
    permanentShareErrorMessage({ error: "share_limit", data: { plan: "free" } }),
    "Limite de links da conta"
  );
  assert.equal(
    permanentShareErrorMessage({ error: "share_limit", data: { plan: "cloud", limit: 25 } }),
    "Limite de links da conta"
  );
  assert.match(permanentShareErrorMessage({ status: 401, error: "unauthorized" }), /sessão expirou/i);
  assert.match(permanentShareErrorMessage({ error: "network" }), /contactar o GuiaFlow/);
  assert.doesNotMatch(permanentShareErrorMessage({ error: "network" }), /nuvem|cloud/i);

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
      (err) => err.code === "share_limit" && err.message === "Limite de links da conta"
    );
  } finally {
    if (prev === undefined) delete globalThis.fetch;
    else globalThis.fetch = prev;
  }
});
