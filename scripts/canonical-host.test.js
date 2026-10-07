import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));

test("guiaflow-seven.vercel.app redireciona em definitivo para guiaflow.pro", () => {
  const redirects = config.redirects || [];
  const rule = redirects.find((entry) =>
    entry.has?.some((cond) => cond.type === "host" && cond.value === "guiaflow-seven.vercel.app")
  );
  assert.ok(rule, "falta o redirect condicionado ao host antigo");
  assert.equal(rule.source, "/:path*");
  assert.equal(rule.destination, "https://guiaflow.pro/:path*");
  assert.equal(rule.permanent, true);
  assert.equal(rule.destination.includes("?"), false);
});

test("o redirect não pega guiaflow.pro e o rewrite /v continua", () => {
  const redirects = config.redirects || [];
  for (const rule of redirects) {
    const hosts = (rule.has || []).filter((cond) => cond.type === "host").map((cond) => cond.value);
    assert.ok(hosts.length > 0, "redirect sem host pegaria o domínio canônico");
    assert.equal(hosts.includes("guiaflow.pro"), false);
  }
  const rewrites = config.rewrites || [];
  assert.ok(
    rewrites.some((rule) => rule.source === "/v/:id" && rule.destination === "/api/v/:id")
  );
  assert.ok(rewrites.some((rule) => rule.source === "/a/:version/:path*"));
});
