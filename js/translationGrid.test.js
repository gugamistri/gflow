import test from "node:test";
import assert from "node:assert/strict";
import { gridRows, rowPending } from "./translationGrid.js";
import { addLang, setTranslation } from "./tour-schema/i18n.js";

test("grid rows pin start and end, pending per language", () => {
  const p = {
    steps: [{ id: "a", popover: { title: "Um" } }, { id: "b", popover: { title: "Dois" }, caption: "Fala" }],
    startStep: { enabled: true, title: "Oi" },
    endStep: { enabled: true, title: "Fim" },
  };
  addLang(p, "en");
  const rows = gridRows(p);
  assert.deepEqual(rows.map((r) => r.key), ["start:start", "step:a", "step:b", "end:end"]);
  assert.equal(rowPending(p, rows[1], "en"), true);
  setTranslation(p, { id: "a", field: "title", lang: "en", text: "One" });
  assert.equal(rowPending(p, rows[1], "en"), false);
});
