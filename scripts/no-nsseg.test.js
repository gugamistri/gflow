import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIRS = ["js", "css", "extension", "data", "demo", "electron", "vendor"];
const SCAN_FILES = ["index.html", "ajuda.html", "package.json", "vercel.json", "README.md"];
const EXT = new Set([".js", ".mjs", ".css", ".html", ".json", ".md", ".txt", ".svg"]);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (EXT.has(path.extname(entry.name).toLowerCase())) out.push(full);
  }
  return out;
}

test("shipped sources do not mention nsseg", () => {
  const files = [];
  for (const dir of SCAN_DIRS) walk(path.join(ROOT, dir), files);
  for (const name of SCAN_FILES) {
    const full = path.join(ROOT, name);
    if (fs.existsSync(full)) files.push(full);
  }

  const hits = [];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    if (/nsseg/i.test(text)) hits.push(path.relative(ROOT, file));
  }

  assert.deepEqual(hits, [], `unexpected nsseg mentions:\n${hits.join("\n")}`);
});
