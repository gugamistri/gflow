import assert from "node:assert/strict";
import test from "node:test";
import { isRestrictedUrl } from "./tab-access.js";

const blocked = [
  "",
  "   ",
  "not a url",
  "chrome://settings",
  "chrome://settings/privacy",
  "chrome://newtab/",
  "chrome://new-tab-page/",
  "chrome-extension://abcdefghijklmnop/popup.html",
  "chrome-search://local-ntp/local-ntp.html",
  "edge://settings",
  "edge://newtab/",
  "about:blank",
  "about:newtab",
  "view-source:https://example.com/",
  "devtools://devtools/bundled/inspector.html",
  "data:text/html,hi",
  "blob:https://example.com/uuid",
  "javascript:void(0)",
  "file:///tmp/produto.html",
  "https://chromewebstore.google.com/detail/algo",
  "https://chrome.google.com/webstore/category/extensions",
  "https://microsoftedge.microsoft.com/addons/detail/algo",
];

const allowed = [
  "https://guiaflow.pro/editor",
  "https://guiaflow-seven.vercel.app/editor",
  "http://localhost:4173/",
  "http://127.0.0.1:4173/editor",
  "https://example.com/pricing",
  "https://chrome.google.com/",
  "https://www.google.com/",
];

test("páginas internas, loja e arquivos locais ficam de fora", () => {
  for (const url of blocked) {
    assert.equal(isRestrictedUrl(url), true, String(url));
  }
  assert.equal(isRestrictedUrl(null), true);
  assert.equal(isRestrictedUrl(undefined), true);
});

test("http e https de produto podem ser capturados", () => {
  for (const url of allowed) {
    assert.equal(isRestrictedUrl(url), false, url);
  }
});

test("file:// entra só com a permissão de arquivos locais", () => {
  const url = "file:///home/demo/produto.html";
  assert.equal(isRestrictedUrl(url, { fileAccess: false }), true);
  assert.equal(isRestrictedUrl(url, { fileAccess: true }), false);
});
