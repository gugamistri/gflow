// Os scripts inline do shell do /p e do /v precisam ser JS válido depois do template literal
// (um "\/" no template vira "/" e quebrava o seletor de idioma com SyntaxError).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const { renderViewPage } = require("../api/lib/view-shell.cjs");

const CASES = [
  ["permanente (/p)", { id: "abc123", name: "Tour", origin: "https://guiaflow.pro", missing: false, kind: "permanent", stepCount: 3 }],
  ["temporário (/v)", { id: "tmp456", name: "Tour", origin: "https://guiaflow.pro", missing: false, kind: "temporary" }],
  ["inexistente", { id: "nada", name: "", origin: "https://guiaflow.pro", missing: true, kind: "permanent" }],
];

function inlineScripts(html) {
  const out = [];
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1] || "";
    if (/\bsrc=/.test(attrs)) continue;
    const type = (attrs.match(/\btype="([^"]*)"/) || [])[1];
    if (type && type !== "text/javascript" && type !== "module") continue; // JSON-LD etc.
    out.push({ code: m[2], module: type === "module" });
  }
  return out;
}

for (const [name, args] of CASES) {
  test(`view-shell ${name}: todo script inline faz parse`, () => {
    const scripts = inlineScripts(renderViewPage(args));
    assert.ok(scripts.length > 0, name);
    for (const [i, { code, module }] of scripts.entries()) {
      if (module) continue; // módulos não passam no vm.Script; os deste shell são só import externo
      assert.doesNotThrow(() => new vm.Script(code, { filename: `${name}#${i}` }), `${name} script #${i}`);
    }
  });
}

test("view-shell: o seletor de idioma lê /en e /es do caminho", () => {
  const html = renderViewPage(CASES[0][1]);
  const code = inlineScripts(html).find((s) => /location\.pathname/.test(s.code)).code;
  const run = (pathname, language = "pt-BR") => {
    const documentElement = { lang: "" };
    vm.runInNewContext(code, {
      location: { search: "", pathname },
      navigator: { language },
      document: { documentElement },
      URLSearchParams,
    });
    return documentElement.lang;
  };
  assert.equal(run("/en/p/abc123"), "en");
  assert.equal(run("/es/p/abc123", "en"), "es");
  assert.equal(run("/p/abc123", "en-US"), "en");
  assert.equal(run("/p/abc123", "de"), "pt-BR");
});
