import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("/auth/callback sem ?code vai para /editor em vez de recarregar a própria página", () => {
  const src = readFileSync(new URL("../js/authCallback.js", import.meta.url), "utf8");
  const match = src.match(/const isCallback = (\/.+\/)\.test\(url\.pathname\);/);
  assert.ok(match, "goHome precisa reconhecer a própria página de callback");
  const re = eval(match[1]);
  for (const path of ["/auth/callback", "/auth/callback/", "/auth/callback.html"]) assert.equal(re.test(path), true, path);
  for (const path of ["/editor", "/", "/auth/callbacks"]) assert.equal(re.test(path), false, path);
  assert.match(src, /url\.origin === location\.origin && !isCallback/);
});
