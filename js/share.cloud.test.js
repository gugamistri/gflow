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
    assert.equal(share.url, "https://app.guiaflow.pro/v/slug-permanente");
    assert.equal(share.id, "sh_1");
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
    "Limite de links do plano Free"
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
      (err) => err.code === "share_limit" && err.message === "Limite de links do plano Free"
    );
  } finally {
    if (prev === undefined) delete globalThis.fetch;
    else globalThis.fetch = prev;
  }
});
