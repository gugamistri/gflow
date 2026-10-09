import assert from "node:assert/strict";
import test from "node:test";
import { setLocale, t } from "./i18n.js";
import {
  exportShowsWatermark,
  hostedAccess,
  hostedQuotaCopy,
  quotaMessageKey,
  shouldShowByokSettings,
  shouldShowProBadge,
  upgradeCopyKeys,
} from "./billing.js";
import { drawExportHeader } from "./exportPack.js";
import { completeHostedCopy, parseHostedResult, readHostedAudio, synthesizeHostedSpeech } from "./hosted.js";

setLocale("pt", { persist: false });

const env = { baseUrl: "https://app.guiaflow.pro", accessToken: "jwt-session" };

test("texto e áudio com chave própria ficam livres", () => {
  assert.equal(hostedAccess({ cloudEnabled: true, hasByok: true, signedIn: false }), "byok");
  assert.equal(shouldShowProBadge({ cloudEnabled: true, hasByok: true, signedIn: false }), false);
  assert.equal(shouldShowByokSettings({ signedIn: false, status: "idle", active: false }), true);
});

test("Pro ativo usa a API hospedada e esconde as chaves, mesmo com BYOK salvo", () => {
  const pro = { cloudEnabled: true, signedIn: true, status: "ready", active: true, hasByok: true };
  assert.equal(hostedAccess(pro), "proceed");
  assert.equal(shouldShowProBadge(pro), false);
  assert.equal(shouldShowByokSettings(pro), false);
});

test("plano none e pagamento pendente mantêm chave própria e o selo", () => {
  const none = { cloudEnabled: true, signedIn: true, status: "ready", active: false, hasByok: false };
  const late = { cloudEnabled: true, signedIn: true, status: "ready", active: false, hasByok: true };
  assert.equal(hostedAccess(none), "upgrade");
  assert.equal(shouldShowProBadge(none), true);
  assert.equal(shouldShowByokSettings(none), true);
  assert.equal(hostedAccess(late), "byok");
  assert.equal(shouldShowProBadge(late), false);
  assert.equal(shouldShowByokSettings(late), true);
});

test("cota mensal usa os números da resposta quando existem", () => {
  assert.deepEqual(hostedQuotaCopy("hostedAi", null), { key: "billing.quotaAi", vars: {} });
  assert.equal(t("billing.quotaAi"), "O limite de 100 textos deste mês acabou.");
  assert.deepEqual(hostedQuotaCopy("hostedAi", { texts: 100, textLimit: 100 }), {
    key: "billing.quotaAiUsed",
    vars: { used: 100, limit: 100 },
  });
  assert.deepEqual(hostedQuotaCopy("tts", { audioSeconds: 1800 }), {
    key: "billing.quotaTtsUsed",
    vars: { used: 30, limit: 30 },
  });
  assert.equal(t("billing.quotaTts"), "O limite de 30 min de áudio deste mês acabou.");
  assert.equal(t("billing.tryAgain"), "Não deu certo. Tente de novo.");
  assert.match(t("billing.unconfigured"), /ainda não está disponível/i);
});

test("sem sessão o recurso hospedado abre o Pro e mostra o selo", () => {
  const anon = { cloudEnabled: true, signedIn: false, status: "idle", active: false, hasByok: false };
  assert.equal(hostedAccess(anon), "upgrade");
  assert.equal(shouldShowProBadge(anon), true);
  assert.equal(exportShowsWatermark(anon), true);
});

test("sem assinatura abre o upgrade e o assinante segue", () => {
  const free = { cloudEnabled: true, signedIn: true, status: "ready", active: false, hasByok: false };
  const pro = { cloudEnabled: true, signedIn: true, status: "ready", active: true, hasByok: false };
  assert.equal(hostedAccess(free), "upgrade");
  assert.equal(shouldShowProBadge(free), true);
  assert.equal(exportShowsWatermark(free), true);
  assert.equal(hostedAccess(pro), "proceed");
  assert.equal(shouldShowProBadge(pro), false);
  assert.equal(exportShowsWatermark(pro), false);
});

test("billing ausente não marca o vídeo de quem já entrou", () => {
  const hidden = { cloudEnabled: true, signedIn: true, status: "hidden", active: false };
  assert.equal(exportShowsWatermark(hidden), false);
  assert.equal(shouldShowProBadge({ ...hidden, hasByok: false }), false);
  assert.equal(hostedAccess({ ...hidden, hasByok: false }), "proceed");
});

test("os títulos do diálogo falam de GuiaFlow Pro", () => {
  assert.equal(upgradeCopyKeys("hostedAi").title, "billing.hostedAiTitle");
  assert.equal(upgradeCopyKeys("tts").title, "billing.ttsTitle");
  assert.equal(upgradeCopyKeys("branding").title, "billing.brandTitle");
  assert.equal(quotaMessageKey("hostedAi"), "billing.quotaAi");
  assert.equal(quotaMessageKey("tts"), "billing.quotaTts");
  assert.equal(quotaMessageKey("permanentShare"), "billing.quota");
});

test("o prompt é uma string e o áudio lê audio.base64", async () => {
  const fenced = '```json\n{"title":"Um","description":"Dois","narration":"Três"}\n```';
  assert.deepEqual(parseHostedResult(fenced), {
    ok: true,
    title: "Um",
    description: "Dois",
    narration: "Três",
  });
  assert.equal(parseHostedResult("só narração", ["narration"]).narration, "só narração");
  assert.equal(parseHostedResult("sem json").ok, false);
  assert.equal(
    readHostedAudio({ audio: { contentType: "audio/mpeg", base64: "QUJDRA==" }, seconds: 1, usage: {} }),
    "data:audio/mpeg;base64,QUJDRA=="
  );

  const prev = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), body: JSON.parse(init.body) });
    if (String(url).endsWith("/ai/complete")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          result: '{"title":"Título","description":"Descrição","narration":"Narração"}',
          usage: { total: 1 },
        }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        audio: { contentType: "audio/wav", base64: "QUJDRA==" },
        seconds: 1,
        usage: {},
      }),
    };
  };
  try {
    const done = await completeHostedCopy(
      [{ role: "user", content: [{ type: "text", text: "passo" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] }],
      env
    );
    assert.equal(done.copy.title, "Título");
    assert.equal(Object.keys(seen[0].body).join(","), "prompt");
    assert.equal(seen[0].body.prompt.includes("passo"), true);
    assert.equal(seen[0].body.prompt.includes("data:image"), false);
    assert.equal(seen[0].body.prompt.includes('{"title"'), true);
    assert.ok(seen[0].body.prompt.length <= 8000);

    const speech = await synthesizeHostedSpeech("olá tour", { voice: "pt-BR" }, env);
    assert.equal(speech.clip, "data:audio/wav;base64,QUJDRA==");
    assert.deepEqual(seen[1].body, { text: "olá tour", voice: "pt-BR" });
  } finally {
    globalThis.fetch = prev;
  }
});

test("503 config_missing não é o diálogo de assinatura e 502 usa a mensagem", async () => {
  const prev = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/tts/synthesize")) {
      return {
        ok: false,
        status: 503,
        json: async () => ({ ok: false, error: "config_missing" }),
      };
    }
    return {
      ok: false,
      status: 502,
      json: async () => ({ ok: false, message: "O modelo não respondeu." }),
    };
  };
  try {
    const tts = await synthesizeHostedSpeech("oi", {}, env);
    assert.equal(tts.status, 503);
    assert.equal(tts.error, "config_missing");
    const ai = await completeHostedCopy([{ role: "user", content: "oi" }], env);
    assert.equal(ai.status, 502);
    assert.equal(ai.message, "O modelo não respondeu.");
  } finally {
    globalThis.fetch = prev;
  }
});

function headerPaints(opts) {
  const paints = [];
  const ctx = {
    canvas: { width: 1280, height: 720 },
    save() {},
    restore() {},
    measureText(text) {
      return { width: String(text).length * 14 };
    },
    fillText(text) {
      paints.push(text);
    },
  };
  drawExportHeader(ctx, opts);
  return paints;
}

test("o vídeo grátis mostra o logo e o Pro mostra o título", () => {
  const free = headerPaints({ showBrand: true, projectTitle: "Meu tour" });
  assert.deepEqual(free.slice(0, 2), ["Guia", "Flow"]);
  assert.equal(free.includes("Meu tour"), false);
  const pro = headerPaints({ showBrand: false, projectTitle: "Meu tour" });
  assert.deepEqual(pro, ["Meu tour"]);
  assert.equal(pro.includes("Guia"), false);
  assert.deepEqual(headerPaints({ showBrand: false, projectTitle: "" }), []);
});
