import assert from "node:assert/strict";
import test from "node:test";
import { csvDate, csvFileName } from "./leadsDialog.js";

test("CSV de contatos: data no fuso de Brasília e nome de arquivo seguro", () => {
  assert.equal(csvDate("2026-10-11T14:03:04.091Z"), "2026-10-11 11:03:04");
  assert.equal(csvDate(""), "");
  assert.equal(csvDate("x"), "");
  assert.equal(csvFileName("meu-tour-ab12", new Date("2026-10-11T12:00:00Z")), "contatos-meu-tour-ab12-2026-10-11.csv");
  assert.equal(csvFileName("../x?y", new Date("2026-10-11T12:00:00Z")), "contatos-xy-2026-10-11.csv");
});
