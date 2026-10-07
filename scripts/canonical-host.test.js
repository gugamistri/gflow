import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));

function legacyHostRedirect(source) {
  return (config.redirects || []).find(
    (entry) =>
      entry.source === source &&
      entry.has?.some((cond) => cond.type === "host" && cond.value === "guiaflow-seven.vercel.app")
  );
}

test("guiaflow-seven.vercel.app redireciona a raiz e os demais caminhos", () => {
  // why: com cleanUrls, /:path* não casa com / e a home antiga continua em 200
  const root = legacyHostRedirect("/");
  const paths = legacyHostRedirect("/:path*");
  assert.ok(root, "falta o redirect da raiz");
  assert.ok(paths, "falta o redirect /:path*");
  assert.equal(root.destination, "https://guiaflow.pro/");
  assert.equal(root.permanent, true);
  assert.equal(root.destination.includes("?"), false);
  assert.equal(paths.destination, "https://guiaflow.pro/:path*");
  assert.equal(paths.permanent, true);
  assert.equal(paths.destination.includes("?"), false);
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
