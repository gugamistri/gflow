import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MENU_HOME,
  MOVED_SINCE,
  MOVED_UNTIL,
  compareVersions,
  duplicateActions,
  movedHintsActive,
  movedTarget,
} from "./menuRoutes.js";
import { RELEASE_NOTES_VERSION } from "./releaseNotes.js";

test("compara versões x.y.z", () => {
  assert.equal(compareVersions("0.3.1", "0.3.1"), 0);
  assert.equal(compareVersions("0.3.1", "0.3.3"), -1);
  assert.equal(compareVersions("0.4.0", "0.3.9"), 1);
  assert.equal(compareVersions("1", "0.9.9"), 1);
  assert.equal(compareVersions("0.10.0", "0.9.0"), 1);
});

test("avisos de mudança valem por duas versões (0.3.1 e 0.4.0)", () => {
  assert.equal(MOVED_SINCE, "0.3.1");
  assert.equal(MOVED_UNTIL, "0.4.1");
  assert.equal(movedHintsActive("0.3.0"), false);
  assert.equal(movedHintsActive("0.3.1"), true);
  assert.equal(movedHintsActive("0.4.0"), true);
  assert.equal(movedHintsActive("0.4.1"), false);
  assert.equal(movedHintsActive(""), false);
  assert.equal(movedHintsActive(RELEASE_NOTES_VERSION), true, "a versão atual mostra os avisos");
});

test("destinos antigos levam ao lugar novo", () => {
  assert.deepEqual(movedTarget("project", "new"), { menu: "app", action: "new" });
  assert.deepEqual(movedTarget("project", "open"), { menu: "app", action: "projects" });
  assert.deepEqual(movedTarget("project", "import"), { menu: "app", action: "import" });
  assert.deepEqual(movedTarget("project", "projects"), { menu: "app", action: "projects" });
  assert.deepEqual(movedTarget("app", "open"), { menu: "app", action: "projects" });
  assert.deepEqual(movedTarget("app", "results"), { menu: "publish", action: "results" });
  assert.deepEqual(movedTarget("account", "help"), { menu: "app", action: "help" });
  assert.equal(movedTarget("project", "rename"), null);
});

test("nenhuma ação em dois menus", () => {
  assert.deepEqual(duplicateActions(MENU_HOME), []);
  assert.deepEqual(duplicateActions({ a: ["x", "y"], b: ["y"] }), ["y"]);
});
