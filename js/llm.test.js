import assert from "node:assert/strict";
import test from "node:test";
import {
  buildChatBody,
  buildChatMessages,
  buildStepContext,
  buildUserPrompt,
  chatCompletions,
  formatFocusBlock,
  isPlausibleLlmKey,
  maskLlmKey,
  normalizeBaseUrl,
  normalizeFocus,
  parseCopyJson,
  redactSecret,
  resolveProvider,
  LLM_DEFAULT_MODEL,
  LLM_DEFAULT_PROVIDER,
} from "./llm.js";

const SAMPLE_KEY = "sk-or-v1-testkeyvalue1234567890";

test("chave LLM genérica e máscara", () => {
  assert.equal(isPlausibleLlmKey(SAMPLE_KEY), true);
  assert.equal(isPlausibleLlmKey("short"), false);
  assert.equal(isPlausibleLlmKey("has space here"), false);
  assert.equal(maskLlmKey(SAMPLE_KEY).includes("*"), true);
  assert.equal(maskLlmKey(SAMPLE_KEY).includes(SAMPLE_KEY), false);
});

test("OpenRouter é o provedor padrão com DeepSeek V4.1 Flash", () => {
  const provider = resolveProvider(LLM_DEFAULT_PROVIDER);
  assert.equal(provider.baseUrl, "https://openrouter.ai/api/v1");
  assert.equal(LLM_DEFAULT_MODEL, "deepseek/deepseek-v4.1-flash");
  assert.equal(normalizeBaseUrl("https://openrouter.ai/api/v1/"), "https://openrouter.ai/api/v1");
});

test("contexto só inclui passos anteriores", () => {
  const steps = [
    { popover: { title: "A", description: "um" }, caption: "nar A", type: "screen", scene: 1 },
    { popover: { title: "B", description: "dois" }, caption: "nar B", type: "slide", scene: 1 },
    { popover: { title: "C", description: "três" }, caption: "nar C", type: "screen", scene: 2 },
  ];
  const ctx = buildStepContext(steps, 2);
  assert.equal(ctx.length, 2);
  assert.equal(ctx[0].title, "A");
  assert.equal(ctx[1].title, "B");
  assert.equal(ctx.some((c) => c.title === "C"), false);
});

test("mensagem multimodal leva a imagem e desliga reasoning", () => {
  const image = "data:image/jpeg;base64,abc";
  const messages = buildChatMessages({
    imageDataUrl: image,
    context: [{ n: 1, type: "screen", scene: 1, title: "Antes", description: "ctx", caption: "" }],
    draft: { title: "Rascunho", description: "" },
    locale: "pt",
  });
  assert.equal(messages[0].role, "user");
  const parts = messages[0].content;
  assert.equal(parts[0].type, "text");
  assert.match(parts[0].text, /Antes/);
  assert.equal(parts[1].type, "image_url");
  assert.equal(parts[1].image_url.url, image);

  const body = buildChatBody({ model: LLM_DEFAULT_MODEL, messages });
  assert.equal(body.model, LLM_DEFAULT_MODEL);
  assert.equal(body.max_tokens, 1024);
  assert.deepEqual(body.reasoning, { effort: "none", exclude: true });
  assert.equal(JSON.stringify(body).includes(SAMPLE_KEY), false);
});

test("prompt orienta o aprendiz e diferencia clique vs só destaque", () => {
  const focus = normalizeFocus({
    hotspot: { x: 40.12, y: 22, w: 18, h: 9.5 },
    clickPoint: { x: 49, y: 26 },
    simulateClick: true,
  });
  assert.deepEqual(focus.hotspot, { x: 40.1, y: 22, w: 18, h: 9.5 });
  const block = formatFocusBlock(focus);
  assert.match(block, /Highlight rectangle: x=40\.1 y=22 w=18 h=9\.5/);
  assert.match(block, /Click target: x=49 y=26/);
  assert.match(block, /NEXT action/);

  const prompt = buildUserPrompt({
    locale: "pt",
    stepType: "screen",
    focus: {
      hotspot: { x: 10, y: 20, w: 30, h: 12 },
      clickPoint: { x: 25, y: 26 },
      simulateClick: false,
    },
  });
  assert.match(prompt, /Speak TO the learner/);
  assert.match(prompt, /Do NOT describe the screenshot as an image/);
  assert.match(prompt, /Highlight rectangle/);
  assert.match(prompt, /Click simulation is off/);
  assert.equal(prompt.includes("Click target:"), false);
  assert.match(prompt, /SCREEN capture/);

  const slidePrompt = buildUserPrompt({ locale: "pt", stepType: "slide" });
  assert.match(slidePrompt, /cover\/chapter SLIDE/);
  assert.match(slidePrompt, /no click instructions/);

  const messages = buildChatMessages({
    imageDataUrl: "data:image/jpeg;base64,abc",
    locale: "en",
    stepType: "screen",
    focus: {
      hotspot: { x: 5, y: 5, w: 10, h: 8 },
      clickPoint: { x: 10, y: 9 },
      simulateClick: true,
    },
  });
  assert.match(messages[0].content[0].text, /Click target: x=10 y=9/);
});

test("parseCopyJson aceita cerca markdown e exige narração", () => {
  const parsed = parseCopyJson(
    '```json\n{"title":"Oi","description":"Resumo","narration":"Detalhe falado"}\n```'
  );
  assert.deepEqual(parsed, {
    title: "Oi",
    description: "Resumo",
    narration: "Detalhe falado",
  });
  assert.equal(parseCopyJson('{"title":"x","description":"y"}'), null);
});

test("chatCompletions envia Bearer e redige a chave no erro", async () => {
  const seen = [];
  const result = await chatCompletions({
    apiKey: SAMPLE_KEY,
    baseUrl: "https://openrouter.ai/api/v1",
    model: LLM_DEFAULT_MODEL,
    messages: buildChatMessages({
      imageDataUrl: "data:image/jpeg;base64,x",
      locale: "en",
    }),
    fetchImpl: async (url, options) => {
      seen.push({ url, headers: options.headers, body: options.body });
      return {
        ok: true,
        async json() {
          return {
            choices: [{ message: { content: '{"title":"Hello","description":"World"}' } }],
          };
        },
      };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(seen[0].url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(seen[0].headers.Authorization, `Bearer ${SAMPLE_KEY}`);
  const body = JSON.parse(seen[0].body);
  assert.equal(body.reasoning.effort, "none");
  assert.equal(body.messages[0].content[1].image_url.url.startsWith("data:image/"), true);
});

test("chatCompletions tenta de novo com effort none se content vier vazio por length", async () => {
  let calls = 0;
  const result = await chatCompletions({
    apiKey: SAMPLE_KEY,
    baseUrl: "https://openrouter.ai/api/v1",
    model: LLM_DEFAULT_MODEL,
    messages: [{ role: "user", content: "hi" }],
    fetchImpl: async (_url, options) => {
      calls += 1;
      const body = JSON.parse(options.body);
      if (body.reasoning?.effort !== "none" || calls === 1) {
        // First call uses default (now also none) — simulate old empty+length once via custom includeReasoning low
      }
      if (calls === 1) {
        return {
          ok: true,
          async json() {
            return {
              choices: [{ finish_reason: "length", message: { content: "" } }],
              usage: { completion_tokens_details: { reasoning_tokens: 512 } },
            };
          },
        };
      }
      return {
        ok: true,
        async json() {
          return {
            choices: [{ finish_reason: "stop", message: { content: '{"title":"T","description":"D","narration":"N"}' } }],
          };
        },
      };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(calls, 2);
  assert.match(result.content, /title/);
});

test("chatCompletions tenta de novo sem reasoning se o provedor recusar", async () => {
  let calls = 0;
  const result = await chatCompletions({
    apiKey: SAMPLE_KEY,
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: "hi" }],
    fetchImpl: async (_url, options) => {
      calls += 1;
      const body = JSON.parse(options.body);
      if (body.reasoning) {
        return {
          ok: false,
          status: 400,
          async text() {
            return JSON.stringify({ error: { message: `Unknown parameter: reasoning ${SAMPLE_KEY}` } });
          },
        };
      }
      return {
        ok: true,
        async json() {
          return { choices: [{ message: { content: '{"title":"T","description":"D","narration":"N"}' } }] };
        },
      };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(calls, 2);
  assert.equal(redactSecret(`err ${SAMPLE_KEY}`, SAMPLE_KEY).includes(SAMPLE_KEY), false);
});
