import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { catalogs } from "./i18n.js";
import {
  API_SUBTABS,
  RESERVED_SETTINGS_TABS,
  SETTINGS_TAB_ORDER,
  apiSubtabFor,
  connectionCards,
  leadProntoCardText,
  maskLast4,
  stepSettingsTab,
  visibleSettingsTabs,
} from "./settingsDialog.js";

const html = readFileSync(new URL("../editor.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../css/settings.css", import.meta.url), "utf8");

test("a aba Clientes fica reservada e Administração só entra para a equipe", () => {
  assert.deepEqual(SETTINGS_TAB_ORDER, ["account", "plan", "team", "clients", "connections", "api", "admin"]);
  assert.deepEqual(RESERVED_SETTINGS_TABS, ["clients"]);
  assert.deepEqual(visibleSettingsTabs(), ["account", "plan", "team", "connections", "api"]);
  const staff = visibleSettingsTabs({ staff: true });
  assert.equal(staff.at(-1), "admin");
  assert.equal(staff.includes("clients"), false);
  assert.equal(staff.indexOf("team") + 1, staff.indexOf("connections"));
});

test("as setas circulam só nas abas visíveis", () => {
  const tabs = visibleSettingsTabs();
  assert.equal(stepSettingsTab(tabs, "account", -1), "api");
  assert.equal(stepSettingsTab(tabs, "api", 1), "account");
  assert.equal(stepSettingsTab(tabs, "team", 1), "connections");
  const staff = visibleSettingsTabs({ staff: true });
  assert.equal(stepSettingsTab(staff, "api", 1), "admin");
  assert.equal(stepSettingsTab(staff, "admin", 1), "account");
});

test("conexões começam pelo LeadPronto da conta e o resto é por link", () => {
  const cards = connectionCards();
  assert.equal(cards[0].id, "leadpronto");
  assert.equal(cards[0].kind, "account");
  assert.equal(cards[0].sameMaker, true);
  assert.deepEqual(cards.slice(1).map((card) => card.id), ["webhook", "rd", "hubspot"]);
  assert.deepEqual(cards.slice(1).map((card) => card.kind), ["perLink", "perLink", "perLink"]);
});

test("a máscara mostra só os 4 últimos", () => {
  assert.equal(maskLast4("abcdwxyz"), "****wxyz");
  assert.equal(maskLast4("abcdwxyz").includes("abcd"), false);
  assert.equal(maskLast4("1234"), "");
  assert.equal(maskLast4(""), "");
});

test("as seções antigas da API caem em Conectar, Chaves e Apps", () => {
  assert.deepEqual(API_SUBTABS, ["connect", "keys", "apps"]);
  assert.equal(apiSubtabFor("api-connect-heading"), "connect");
  assert.equal(apiSubtabFor("api-keys-form"), "keys");
  assert.equal(apiSubtabFor("api-keys-list-heading"), "keys");
  assert.equal(apiSubtabFor("api-recent-heading"), "keys");
  assert.equal(apiSubtabFor("api-apps-heading"), "apps");
});

test("o texto do LeadPronto não carrega segredo", () => {
  const text = leadProntoCardText({ status: "connected", tenant: "Acme" });
  assert.match(text, /Acme/);
  assert.equal(/sk_|whsec|gf_live|Bearer/i.test(text), false);
  assert.equal(leadProntoCardText({ status: "disconnected" }), catalogs.en["leads.lp.disconnected"]);
});

test("o chip abre um diálogo com as abas e as ações antigas continuam no HTML", () => {
  assert.match(html, /id="btn-account-settings"/);
  assert.equal(html.includes('id="btn-account-billing"'), false);
  assert.equal(html.includes('id="btn-account-api-keys"'), false);
  assert.equal(html.includes('id="btn-account-admin"'), false);

  const start = html.indexOf('id="modal-settings"');
  const end = html.indexOf('id="modal-subscription"');
  const dialog = html.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.match(dialog, /role="tablist"/);
  for (const tab of ["account", "plan", "team", "connections", "api", "admin"]) {
    assert.match(dialog, new RegExp(`data-settings-tab="${tab}"`));
  }
  assert.equal(/data-settings-tab="clients"/.test(dialog), false);
  assert.match(dialog, /data-settings-reserved="clients"/);
  assert.match(dialog, /id="settings-tab-select"/);
  for (const sub of API_SUBTABS) assert.match(dialog, new RegExp(`data-settings-subtab="${sub}"`));
  assert.match(dialog, /id="llm-key"/);
  assert.match(dialog, /id="cartesia-key"/);
  assert.match(dialog, /id="settings-email"/);
  assert.match(dialog, /id="settings-locale"/);
  assert.match(dialog, /id="settings-appearance"/);
  assert.match(dialog, /data-conn="leadpronto"/);
  assert.ok(dialog.indexOf('data-conn="leadpronto"') < dialog.indexOf('data-conn="webhook"'));
  assert.match(dialog, /id="btn-settings-admin"/);

  const narration = html.slice(html.indexOf('id="narration-panel"'), html.indexOf('id="preview-split"'));
  assert.equal(narration.includes('id="llm-key"'), false);
  assert.equal(narration.includes('id="cartesia-key"'), false);
  assert.match(narration, /id="btn-open-browser-keys"/);

  for (const id of [
    "btn-subscription-cancel",
    "btn-subscription-resume",
    "btn-subscription-portal",
    "btn-subscription-upsell",
    "subscription-seats",
    "btn-api-key-create",
    "api-keys-list",
    "api-apps-list",
    "api-recent-list",
    "api-connect-tabs",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
});

test("no celular o diálogo é tela cheia e as abas viram seletor", () => {
  assert.match(css, /flex-wrap:\s*wrap/);
  assert.match(css, /settings-tab-select/);
  assert.match(css, /inset:\s*0 !important/);
  assert.match(css, /height:\s*100% !important/);
});

test("os textos de configurações existem em pt, en e es", () => {
  const keys = Object.keys(catalogs.pt).filter((key) => key.startsWith("settings."));
  assert.ok(keys.length >= 30);
  for (const loc of ["es", "en"]) {
    for (const key of keys) assert.equal(typeof catalogs[loc][key], "string", `${loc}:${key}`);
  }
  assert.equal(catalogs.pt["settings.menu"], "Configurações");
  assert.equal(catalogs.en["settings.tab.connections"], "Connections");
  assert.equal(catalogs.es["settings.tab.team"], "Equipo");
  const fresh = [html.slice(html.indexOf('id="modal-settings"'), html.indexOf('id="modal-subscription"')), css].join("\n");
  assert.equal(/nstech/i.test(fresh), false);
});
