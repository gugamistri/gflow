import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { INDEXNOW_KEY, KEY_LOCATION, indexNowBody, sitemapUrls } from "./indexnow.mjs";

const root = new URL("../", import.meta.url);
const read = (name) => readFileSync(new URL(name, root), "utf8");

test("IndexNow: a chave na raiz tem só a própria chave e é servida como texto, sem indexar", () => {
  assert.match(INDEXNOW_KEY, /^[a-f0-9]{32}$/);
  assert.equal(read(`${INDEXNOW_KEY}.txt`), INDEXNOW_KEY);
  assert.equal(KEY_LOCATION, `https://guiaflow.pro/${INDEXNOW_KEY}.txt`);
  const rule = JSON.parse(read("vercel.json")).headers.find((h) => h.source === `/${INDEXNOW_KEY}.txt`);
  assert.ok(rule, "sem header para a chave");
  assert.equal(rule.headers.find((h) => h.key === "Content-Type")?.value, "text/plain; charset=utf-8");
  assert.equal(rule.headers.find((h) => h.key === "X-Robots-Tag")?.value, "noindex");
});

test("IndexNow: corpo com host, chave e URLs do sitemap; caminho relativo vira absoluto e outro host sai", () => {
  const urls = sitemapUrls(read("sitemap.xml"));
  assert.ok(urls.includes("https://guiaflow.pro/"));
  assert.ok(urls.includes("https://guiaflow.pro/exemplos/guia"));
  assert.equal(new Set(urls).size, urls.length);
  const body = indexNowBody(["/llms.txt", "https://guiaflow.pro/", "https://example.com/x", "/llms.txt"]);
  assert.deepEqual(body, {
    host: "guiaflow.pro",
    key: INDEXNOW_KEY,
    keyLocation: KEY_LOCATION,
    urlList: ["https://guiaflow.pro/llms.txt", "https://guiaflow.pro/"],
  });
});
