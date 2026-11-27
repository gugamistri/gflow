import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { planEditorBootScreen, shouldOfferExamplePreview } from "./editorBoot.js";

test("visita nova ou recorrente abre a lista de projetos", () => {
  assert.deepEqual(planEditorBootScreen({}), { action: "library" });
  assert.deepEqual(planEditorBootScreen({ skipSavedOpen: false }), { action: "library" });
  assert.deepEqual(
    planEditorBootScreen({ skipSavedOpen: false, seeded: true, activeProjectId: "demo" }),
    { action: "library" }
  );
  assert.deepEqual(
    planEditorBootScreen({ skipSavedOpen: false, activeProjectId: "meu-tour" }),
    { action: "library" }
  );
});

test("captura da extensão durante o boot não é sobrescrita", () => {
  assert.deepEqual(planEditorBootScreen({ skipSavedOpen: true, activeProjectId: "demo" }), {
    action: "defer",
  });
});

test("só o tour de exemplo intocado oferece Ver exemplo", () => {
  assert.equal(shouldOfferExamplePreview({ stock: true, name: "Como usar o Guia" }), true);
  assert.equal(shouldOfferExamplePreview({ stock: false, name: "Como usar o Guia" }), false);
  assert.equal(shouldOfferExamplePreview({ name: "Meu tour" }), false);
  assert.equal(shouldOfferExamplePreview(null), false);
});

test("o boot do editor segue o plano e não abre o exemplo sozinho", () => {
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  assert.match(app, /import \{ planEditorBootScreen, shouldOfferExamplePreview \} from "\.\/editorBoot\.js"/);
  assert.match(app, /planEditorBootScreen\(\{[\s\S]*?skipSavedOpen:/);
  assert.match(app, /if \(plan\.action === "library"\) showLibrary\(\)/);
  assert.equal(/autoPreview:\s*seeded/.test(app), false);
  assert.equal(/if \(seeded\) \{/.test(app), false);
  assert.match(app, /data-action="watch-example"/);
  assert.match(app, /openProject\(id, \{ autoPreview: true \}\)/);
});
