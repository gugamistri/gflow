import assert from "node:assert/strict";
import test from "node:test";
import { setLocale } from "./i18n.js";
import {
  exportShowsWatermark,
  hostedAccess,
  quotaMessageKey,
  shouldShowProBadge,
  upgradeCopyKeys,
} from "./billing.js";
import { cloudFetch } from "./cloudConfig.js";
import { drawBrandWatermark } from "./exportPack.js";
import { completeHostedCopy, readHostedAudio, readHostedCopy, synthesizeHostedSpeech } from "./hosted.js";

setLocale("pt", { persist: false });

const env = { baseUrl: "https://app.guiaflow.pro", accessToken: "jwt-session" };

test("texto e áudio com chave própria ficam livres", () => {
  assert.equal(hostedAccess({ cloudEnabled: true, hasByok: true, signedIn: false }), "byok");
  assert.equal(shouldShowProBadge({ cloudEnabled: true, hasByok: true, signedIn: false }), false);
});

test("sem sessão o recurso hospedado pede entrada e mostra o selo Pro", () => {
  const anon = { cloudEnabled: true, signedIn: false, status: "idle", active: false, hasByok: false };
  assert.equal(hostedAccess(anon), "login");
  assert.equal(shouldShowProBadge(anon), true);
  assert.equal(exportShowsWatermark(anon), true);
});

test("plano grátis abre o upgrade e o assinante segue", () => {
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

test("402 de texto e áudio preserva a feature e 429 não é assinatura", async () => {
  const prev = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.endsWith("/ai/complete")) {
      return {
        ok: false,
        status: 402,
        json: async () => ({ ok: false, error: "subscription_required", feature: "hostedAi" }),
      };
    }
    if (href.endsWith("/tts/synthesize")) {
      return {
        ok: false,
        status: 429,
        json: async () => ({ ok: false, error: "quota_exceeded", feature: "tts", message: "Limite do mês." }),
      };
    }
    throw new Error(href);
  };
  try {
    const ai = await completeHostedCopy([{ role: "user", content: "oi" }], env);
    assert.equal(ai.status, 402);
    assert.equal(ai.error, "subscription_required");
    assert.equal(ai.data.feature, "hostedAi");
    const tts = await synthesizeHostedSpeech("olá", { locale: "pt-BR" }, env);
    assert.equal(tts.status, 429);
    assert.equal(tts.error, "quota_exceeded");
    assert.equal(tts.message, "Limite do mês.");
  } finally {
    globalThis.fetch = prev;
  }
});

test("a resposta hospedada vira texto e áudio", async () => {
  assert.deepEqual(
    readHostedCopy({ content: '{"title":"Um","description":"Dois","narration":"Três"}' }),
    { title: "Um", description: "Dois", narration: "Três" }
  );
  assert.equal(readHostedAudio({ audioBase64: "QUJDRA==", mime: "audio/mpeg" }), "data:audio/mpeg;base64,QUJDRA==");
  const prev = globalThis.fetch;
  let body = null;
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(init.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ title: "Título", description: "Descrição", narration: "Narração" }),
    };
  };
  try {
    const done = await completeHostedCopy([{ role: "user", content: "passo" }], env);
    assert.equal(done.copy.title, "Título");
    assert.equal(body.messages[0].content, "passo");
    assert.equal(body.locale, "pt");
  } finally {
    globalThis.fetch = prev;
  }
});

test("a marca fica no canto e diz Feito com GuiaFlow", () => {
  const paints = [];
  const ctx = {
    canvas: { width: 1280, height: 720 },
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    arcTo() {},
    closePath() {},
    fill() {},
    measureText() {
      return { width: 180 };
    },
    fillText(text, x, y) {
      paints.push({ text, x, y });
    },
  };
  drawBrandWatermark(ctx);
  assert.equal(paints.length, 1);
  assert.equal(paints[0].text, "Feito com GuiaFlow");
  assert.ok(paints[0].x > 640);
  assert.ok(paints[0].y > 600);
  assert.equal(/nuvem/i.test(paints[0].text), false);
});
