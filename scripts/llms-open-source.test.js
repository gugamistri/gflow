import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const llms = readFileSync(new URL("llms.txt", root), "utf8");

test("llms.txt: MIT, alternative to Arcade/Supademo/Storylane/Navattic, HTML you can host, link to the EN open-source page", () => {
  assert.match(llms, /open source \(MIT\)/i);
  assert.match(llms, /MIT-licensed alternative to Arcade, Supademo, Storylane and Navattic/);
  assert.match(llms, /export a single HTML file and host it yourself/);
  assert.match(llms, /https:\/\/guiaflow\.pro\/en\/open-source-interactive-demo/);
  assert.equal(/self-hosted|self-hostable|Docker/i.test(llms), false);
  assert.equal(/plataforma|intelig[eê]ncia|ecossistema|potencializ|\bplatform\b|\bintelligence\b|\becosystem\b|\bempower\b|\bleverage\b/i.test(llms), false);
  assert.match(readFileSync(new URL("LICENSE", root), "utf8"), /^MIT License/m);
});
