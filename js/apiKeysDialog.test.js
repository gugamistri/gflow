import assert from "node:assert/strict";
import test from "node:test";
import { agentTagInfo, connectSnippets, CONNECT_TARGETS, DEFAULT_MCP_URL } from "./apiKeysDialog.js";
import { catalogs } from "./i18n.js";

test("connectSnippets sem chave usa OAuth (só a URL do MCP)", () => {
  const s = connectSnippets();
  assert.equal(DEFAULT_MCP_URL, "https://app.guiaflow.pro/mcp");
  assert.deepEqual(JSON.parse(s.cursor), { mcpServers: { guiaflow: { url: DEFAULT_MCP_URL } } });
  assert.equal(s.claudeCode, "claude mcp add --transport http guiaflow https://app.guiaflow.pro/mcp");
  assert.equal(s.claudeAi, DEFAULT_MCP_URL);
  assert.deepEqual(JSON.parse(s.vscode), { servers: { guiaflow: { type: "http", url: DEFAULT_MCP_URL } } });
  assert.equal(s.curl, `curl -H "Authorization: Bearer gf_live_xxxxxxxx" https://app.guiaflow.pro/v1/tours`);
  assert.doesNotMatch(s.cursor, /Authorization/);
});

test("connectSnippets com chave põe o cabeçalho Authorization", () => {
  const key = "gf_live_abc123";
  const s = connectSnippets("https://app.guiaflow.pro/mcp", key);
  assert.equal(JSON.parse(s.cursor).mcpServers.guiaflow.headers.Authorization, `Bearer ${key}`);
  assert.equal(JSON.parse(s.vscode).servers.guiaflow.headers.Authorization, `Bearer ${key}`);
  assert.match(s.claudeCode, /--header "Authorization: Bearer gf_live_abc123"$/);
  assert.equal(s.claudeAi, "https://app.guiaflow.pro/mcp", "claude.ai só aceita OAuth: nunca leva a chave");
  assert.match(s.curl, /Bearer gf_live_abc123/);
});

test("agentTagInfo só marca tours criados por agente", () => {
  assert.equal(agentTagInfo(null), null);
  assert.equal(agentTagInfo({}), null);
  assert.equal(agentTagInfo({ createdBy: { kind: "user" } }), null);
  assert.deepEqual(agentTagInfo({ createdBy: { kind: "agent", client: " Cursor " } }), { client: "Cursor" });
  assert.deepEqual(agentTagInfo({ createdBy: { kind: "agent" } }), { client: "" });
});

test("textos das chaves de API existem nos três idiomas", () => {
  const keys = Object.keys(catalogs.pt).filter((k) => k.startsWith("apiKeys.") || k.startsWith("agent."));
  assert.ok(keys.length > 40);
  for (const target of CONNECT_TARGETS) assert.ok(keys.includes(`apiKeys.connect.hint.${target}`), target);
  for (const loc of ["es", "en"]) {
    for (const key of keys) assert.equal(typeof catalogs[loc][key], "string", `${loc}:${key}`);
  }
});
