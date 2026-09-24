import assert from "node:assert/strict";
import test from "node:test";
import {
  isCartesiaKeysUrl,
  isPlausibleApiKey,
  maskApiKey,
  redactSecret,
  resolveNarration,
  synthesizeCartesia,
  ttsRequest,
} from "./cartesia.js";

const SAMPLE_KEY = "sk_car_testkeyvalue123456";

test("pt-BR e pt-PT viram locale da Sonic, e a voz Aura antiga cai no Brasil", () => {
  assert.equal(resolveNarration("pt-BR").locale, "pt-BR");
  assert.equal(resolveNarration("pt-PT").locale, "pt-PT");
  assert.equal(resolveNarration("").locale, "pt-BR");
  assert.equal(resolveNarration("aura-2-thalia-en").locale, "pt-BR");
});

test("es e en resolvem locales regionais da Sonic", () => {
  assert.equal(resolveNarration("es-ES").locale, "es-ES");
  assert.equal(resolveNarration("es-MX").locale, "es-MX");
  assert.equal(resolveNarration("en-US").locale, "en-US");
  assert.equal(resolveNarration("en-GB").locale, "en-GB");
  assert.equal(resolveNarration("en-US").voiceId, resolveNarration("pt-BR").voiceId);
});

test("chave da Cartesia começa com sk_car_", () => {
  assert.equal(isPlausibleApiKey(SAMPLE_KEY), true);
  assert.equal(isPlausibleApiKey("sk-testkeyvalue123456"), false);
  assert.equal(isPlausibleApiKey(`${SAMPLE_KEY}\nstatus`), false);
  assert.equal(maskApiKey(SAMPLE_KEY).includes("*"), true);
  assert.equal(maskApiKey(SAMPLE_KEY).includes(SAMPLE_KEY), false);
});

test("o pedido fala português e não carrega a chave", () => {
  const body = ttsRequest({ text: "Olá, este é o passo.", voiceURI: "pt-PT", rate: 1.2 });
  assert.equal(body.model_id, "sonic-3.6");
  assert.equal(body.locale, "pt-PT");
  assert.equal(body.language, undefined);
  assert.equal(body.voice.id, resolveNarration("pt-PT").voiceId);
  assert.equal(body.generation_config.speed, 1.2);
  assert.equal(JSON.stringify(body).includes(SAMPLE_KEY), false);
  assert.equal(redactSecret(`rejected ${SAMPLE_KEY}`, SAMPLE_KEY).includes(SAMPLE_KEY), false);
});

test("o pedido em inglês usa locale en-US", () => {
  const body = ttsRequest({ text: "Hello, this is the step.", voiceURI: "en-US", rate: 1 });
  assert.equal(body.locale, "en-US");
  assert.equal(body.voice.id, resolveNarration("en-US").voiceId);
});

test("a síntese no navegador manda a chave só no header", async () => {
  const seen = [];
  const result = await synthesizeCartesia({
    apiKey: SAMPLE_KEY,
    text: "Olá",
    voiceURI: "pt-BR",
    rate: 1,
    fetchImpl: async (url, options) => {
      seen.push({ url, headers: options.headers, body: options.body });
      return {
        ok: true,
        async arrayBuffer() {
          return Buffer.from("ID3fake-audio");
        },
      };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(Buffer.from(result.audioBase64, "base64").toString(), "ID3fake-audio");
  assert.equal(seen[0].headers.Authorization, `Bearer ${SAMPLE_KEY}`);
  assert.equal(seen[0].body.includes(SAMPLE_KEY), false);
});

test("o link da chave é só https://play.cartesia.ai", () => {
  assert.equal(isCartesiaKeysUrl("https://play.cartesia.ai/keys"), true);
  assert.equal(isCartesiaKeysUrl("https://play.cartesia.ai.evil.test/keys"), false);
  assert.equal(isCartesiaKeysUrl("http://play.cartesia.ai/keys"), false);
});
