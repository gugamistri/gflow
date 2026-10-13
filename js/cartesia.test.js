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
  narrationLanguage,
  voiceForLanguage,
  voicesForLanguage,
  DEFAULT_VOICE_BY_LANGUAGE,
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
  assert.notEqual(resolveNarration("en-US").voiceId, resolveNarration("pt-BR").voiceId);
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
  assert.equal(body.language, "pt");
  assert.equal(body.locale, undefined);
  assert.equal(body.voice.id, resolveNarration("pt-PT").voiceId);
  assert.equal(body.generation_config.speed, 1.2);
  assert.equal(JSON.stringify(body).includes(SAMPLE_KEY), false);
  assert.equal(redactSecret(`rejected ${SAMPLE_KEY}`, SAMPLE_KEY).includes(SAMPLE_KEY), false);
});

test("o pedido em inglês manda language en e voz nativa inglesa", () => {
  const body = ttsRequest({ text: "Hello, this is the step.", voiceURI: "en-US", rate: 1 });
  assert.equal(body.language, "en");
  assert.equal(body.voice.id, DEFAULT_VOICE_BY_LANGUAGE.en);
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

test("cada idioma tem voz nativa padrão e o seletor filtra por idioma", () => {
  assert.equal(DEFAULT_VOICE_BY_LANGUAGE.pt, "c9611be8-aae9-4a93-bb1c-98dd6b7d52a4");
  assert.equal(DEFAULT_VOICE_BY_LANGUAGE.en, "a33f7a4c-100f-41cf-a1fd-5822e8fc253f");
  assert.equal(DEFAULT_VOICE_BY_LANGUAGE.es, "3597a26f-80ef-4bd5-8101-9699bc764917");
  assert.equal(narrationLanguage("en-GB"), "en");
  assert.equal(narrationLanguage("es-MX"), "es");
  assert.equal(narrationLanguage(""), "pt");
  for (const lang of ["pt", "en", "es"]) {
    assert.ok(voicesForLanguage(lang).length >= 3);
  }
});

test("voz escolhida vale só no idioma dela; voz pt não vaza para inglês", () => {
  const theo = "79f8b5fb-2cc8-479a-80df-29f7a7cf1a3e";
  assert.equal(voiceForLanguage("en", theo), theo);
  assert.equal(voiceForLanguage("en", DEFAULT_VOICE_BY_LANGUAGE.pt), DEFAULT_VOICE_BY_LANGUAGE.en);
  assert.equal(voiceForLanguage("es", "nope"), DEFAULT_VOICE_BY_LANGUAGE.es);
  const body = ttsRequest({ text: "Hi", voiceURI: "en-US", voiceId: theo });
  assert.equal(body.voice.id, theo);
  assert.equal(body.language, "en");
  const fixed = ttsRequest({ text: "Hi", voiceURI: "en-US", voiceId: DEFAULT_VOICE_BY_LANGUAGE.pt });
  assert.equal(fixed.voice.id, DEFAULT_VOICE_BY_LANGUAGE.en);
});
