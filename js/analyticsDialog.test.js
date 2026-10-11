import assert from "node:assert/strict";
import test from "node:test";
import { chartPaths, formatDuration, percent, rangeForPreset, sourceLabel, stepRows } from "./analyticsDialog.js";

test("rangeForPreset: dias em America/Sao_Paulo, incluindo hoje", () => {
  // 01:30 UTC de 12/10 ainda é 11/10 em São Paulo
  const now = new Date("2026-10-12T01:30:00Z");
  assert.deepEqual(rangeForPreset(7, now), { from: "2026-10-05", to: "2026-10-11", days: 7 });
  assert.equal(rangeForPreset(365, now).from, "2025-10-12");
  assert.equal(rangeForPreset(999, now).days, 30);
});

test("formatação de tempo e porcentagem", () => {
  assert.equal(formatDuration(0), "—");
  assert.equal(formatDuration(42_000), "42 s");
  assert.equal(formatDuration(65_000), "1 min 05 s");
  assert.equal(formatDuration(3_720_000), "1 h 02 min");
  assert.equal(percent(1 / 3), "33%");
  assert.equal(percent(0), "0%");
});

test("sourceLabel e chartPaths", () => {
  const tr = (k) => `[${k}]`;
  assert.equal(sourceLabel("embed", tr), "[analytics.source.embed]");
  assert.equal(sourceLabel("utm:news", tr), "UTM: news");
  assert.equal(sourceLabel("host:blog.x.com", tr), "blog.x.com");
  const p = chartPaths([{ views: 0, completions: 0 }, { views: 4, completions: 2 }], { width: 100, height: 50, pad: 0 });
  assert.equal(p.max, 4);
  assert.equal(p.views, "M0.0 50.0 L100.0 0.0");
  assert.equal(p.completions, "M0.0 50.0 L100.0 25.0");
});

test("stepRows: fração de saída e passos removidos sem visitas somem", () => {
  const rows = stepRows(
    [
      { index: 0, stepId: "a", reached: 4, dropOff: 1 },
      { index: 1, stepId: "b", reached: 3, dropOff: 3 },
      { index: 5, stepId: "x", reached: 0, dropOff: 0, removed: true },
    ],
    4
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[1].dropShare, 0.75);
});
