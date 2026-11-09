import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { catalogs } from "./i18n.js";

const html = readFileSync(new URL("../editor.html", import.meta.url), "utf8");
const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");

test("topo e menu usam account.signIn (Entrar), não Assinar / Entrar", () => {
  assert.match(html, /id="btn-account-signin"[^>]*data-i18n="account\.signIn"/);
  assert.match(html, /id="btn-menu-account"[\s\S]*?data-i18n="account\.signIn"/);
  assert.equal(/Assinar \/ Entrar/.test(html), false);
  assert.equal(catalogs.pt["account.signIn"], "Entrar");
  assert.equal(catalogs.en["account.signIn"], "Sign in");
});

test("login tem CTA discreto para o Pro e volta pelo Já é assinante", () => {
  assert.match(html, /id="btn-account-discover-pro"[^>]*data-i18n="account\.discoverPro"/);
  assert.match(html, /data-i18n="account\.noAccount"/);
  assert.match(html, /id="btn-upgrade-login"[^>]*data-i18n="billing\.already"/);
  assert.match(app, /btn-account-discover-pro[\s\S]*?showUpgradeDialog\(\{ feature: "account" \}\)/);
});

test("botão genérico Entrar abre o login; gatilhos de feature abrem o Pro", () => {
  assert.match(
    app,
    /getElementById\("btn-account-signin"\)\?\.addEventListener\("click", \(\) => \{\s*\/\/[^\n]*\s*showAccountDialog\(\);/,
  );
  assert.equal(/btn-account-signin[\s\S]{0,180}showUpgradeDialog\(\{ feature: "account" \}\)/.test(app), false);
  // Feature / paywall triggers still go to plans
  assert.match(app, /function openFeatureGate\(feature\) \{[\s\S]*?showUpgradeDialog\(\{ feature \}\);/);
  assert.match(app, /data-local-save-open[\s\S]*?showUpgradeDialog\(\{ feature: "account" \}\)/);
  assert.match(app, /consumeProIntent[\s\S]*?showUpgradeDialog\(\{ feature: "account" \}\)/);
  assert.match(app, /cloudShareNeedsUpgrade\(\)[\s\S]*?showUpgradeDialog\(\{ feature: "permanentShare" \}\)/);
});

test("dica do magic link só aparece depois de Entrar sem senha", () => {
  assert.match(html, /id="cloud-magic-hint"[^>]*hidden/);
  assert.match(app, /cloud-magic-hint[\s\S]*?magicHint\.hidden = false/);
  assert.match(app, /function showAccountDialog[\s\S]*?magicHint\.hidden = true/);
});
