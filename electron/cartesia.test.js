const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createKeyStore } = require("./cartesia-store.js");
const { synthesize } = require("./cartesia-tts.js");

const SAMPLE_KEY = "sk_car_testkeyvalue123456";

test("a chave cifrada não fica em texto puro no arquivo", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cartesia-key-"));
  const store = createKeyStore({
    directory,
    encrypt: (value) => Buffer.from(String(value).split("").reverse().join("")),
    decrypt: (buf) => Buffer.from(buf).toString("utf8").split("").reverse().join(""),
  });
  store.save(SAMPLE_KEY);
  const raw = fs.readFileSync(store.file);
  assert.equal(raw.includes(Buffer.from(SAMPLE_KEY)), false);
  assert.equal(store.read(), SAMPLE_KEY);
  assert.equal(store.configured(), true);
  store.clear();
  assert.equal(store.configured(), false);
  fs.rmSync(directory, { recursive: true, force: true });
});

test("a síntese manda a chave só no header e devolve o mp3", async () => {
  const seen = [];
  const result = await synthesize({
    apiKey: SAMPLE_KEY,
    body: { model_id: "sonic-3.6", transcript: "Olá", locale: "pt-BR" },
    redact: (text, secret) => String(text).split(secret).join("****"),
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
  assert.equal(seen[0].url, "https://api.cartesia.ai/tts/bytes");
});
