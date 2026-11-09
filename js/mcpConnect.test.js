import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { catalogs } from "./i18n.js";
import {
  MCP_PRODUCTS,
  clientGesture,
  clientsFromPayload,
  connectedLabel,
  formatAgo,
  loadMcpClients,
  newestClient,
  normalizeMcpClient,
} from "./mcpConnect.js";

const html = readFileSync(new URL("../editor.html", import.meta.url), "utf8");
const URL_MCP = "https://app.guiaflow.pro/mcp";
const now = Date.parse("2026-11-09T12:00:00.000Z");

test("o cartão fica depois de Novo projeto e Criar com ajuda, e o diálogo existe", () => {
  const library = html.slice(html.indexOf('id="library-board"'), html.indexOf('id="library-grid"'));
  const order = ["btn-new-project", "btn-assistant", "btn-agent-connect"].map((id) => library.indexOf(`id="${id}"`));
  assert.ok(order.every((n) => n > 0));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.match(html, /id="btn-agent-connect-from-new"/);
  assert.ok(html.indexOf('id="btn-agent-connect-from-new"') > html.indexOf("data-assistant-from-new"));
  assert.match(html, /id="modal-agent-connect"/);
  assert.match(html, /id="agent-connect-verify"/);
  assert.equal(html.includes("agent-client-logo"), false);
});

test("textos do assistente existem em pt, en e es", () => {
  const keys = Object.keys(catalogs.pt).filter((k) => k.startsWith("agentConnect."));
  assert.ok(keys.length > 20);
  for (const loc of ["en", "es"]) {
    for (const key of keys) assert.equal(typeof catalogs[loc][key], "string", `${loc} ${key}`);
  }
  assert.match(catalogs.pt["agentConnect.used"], /Conectado · usado \{when\}/);
  assert.match(catalogs.pt["agentConnect.prompt.guided"], /dryRun true/);
  assert.match(catalogs.en["agentConnect.title"], /Connect Claude, Codex, Cursor/);
});

test("gesto de cada cliente usa o link ou o comando documentado", () => {
  const claude = clientGesture("claude", URL_MCP);
  assert.equal(claude.kind, "link");
  assert.match(claude.href, /^https:\/\/claude\.ai\/customize\/connectors\?/);
  assert.match(claude.href, /connectorName=GuiaFlow/);
  assert.match(decodeURIComponent(claude.href), new RegExp(URL_MCP));
  assert.match(claude.adminHref, /admin-settings\/connectors/);

  const code = clientGesture("claude-code", URL_MCP);
  assert.match(code.text, new RegExp(`^claude mcp add --transport http --scope user guiaflow ${URL_MCP}$`));

  assert.equal(clientGesture("chatgpt", URL_MCP).text, URL_MCP);

  const codex = clientGesture("codex", URL_MCP);
  assert.match(codex.text, new RegExp(`codex mcp add guiaflow --url ${URL_MCP}`));
  assert.match(codex.text, /codex mcp login guiaflow/);

  const cursor = clientGesture("cursor", URL_MCP);
  assert.match(cursor.href, /^https:\/\/cursor\.com\/link\/mcp\/install\?/);
  const config = new URL(cursor.href).searchParams.get("config");
  assert.deepEqual(JSON.parse(Buffer.from(config, "base64").toString()), { url: URL_MCP });

  const vscode = clientGesture("vscode", URL_MCP);
  assert.match(vscode.href, /^https:\/\/vscode\.dev\/redirect\?url=/);
  const inner = decodeURIComponent(new URL(vscode.href).searchParams.get("url"));
  assert.match(inner, /^vscode:mcp\/install\?/);
  assert.deepEqual(JSON.parse(decodeURIComponent(inner.slice("vscode:mcp/install?".length))), {
    name: "guiaflow",
    type: "http",
    url: URL_MCP,
  });

  const wind = JSON.parse(clientGesture("windsurf", URL_MCP).text);
  assert.equal(wind.mcpServers.guiaflow.serverUrl, URL_MCP);
  assert.match(clientGesture("gemini-cli", URL_MCP).text, new RegExp(`^gemini mcp add --transport http --scope user guiaflow ${URL_MCP}$`));
  assert.equal(clientGesture("other", URL_MCP).text, URL_MCP);
});

test("normaliza produto, via e data; other guarda o nome cru", () => {
  assert.equal(normalizeMcpClient({ product: "other", displayName: "  Goose  ", via: "oauth" }).displayName, "Goose");
  assert.equal(normalizeMcpClient({ product: "nope" }), null);
  assert.equal(normalizeMcpClient({ product: "Cursor" }).product, "cursor");
  assert.deepEqual(normalizeMcpClient({ product: "cursor", via: "oauth", lastSeenAt: "2026-11-09T11:00:00.000Z", displayName: "Cursor" }), {
    product: "cursor",
    via: "oauth",
    lastSeenAt: "2026-11-09T11:00:00.000Z",
    displayName: "Cursor",
  });
  const gemini = normalizeMcpClient({ product: "gemini-cli", via: "api_key", lastUsedAt: "2026-11-01T00:00:00.000Z" });
  assert.equal(gemini.via, "api_key");
  assert.equal(gemini.lastSeenAt, "");
});

test("lê só mcpClients; campo ausente não vira selo; other repete pelo nome", () => {
  const one = { product: "claude", via: "oauth", displayName: "Claude", lastSeenAt: "2026-11-09T10:00:00.000Z" };
  assert.equal(clientsFromPayload({ mcpClients: [one] })[0].product, "claude");
  assert.equal(clientsFromPayload({ clients: [one] }), null);
  assert.equal(clientsFromPayload({ apps: [{ product: "cursor", lastSeenAt: "2026-11-09T11:00:00.000Z" }], keys: [] }), null);
  assert.equal(clientsFromPayload({ foo: 1 }), null);
  assert.equal(clientsFromPayload(null), null);
  const merged = clientsFromPayload({
    mcpClients: [
      { product: "cursor", lastSeenAt: "2026-11-09T08:00:00.000Z", via: "oauth", displayName: "Cursor" },
      { product: "cursor", lastSeenAt: "2026-11-09T11:00:00.000Z", via: "api_key", displayName: "Cursor" },
      { product: "other", displayName: "Goose", lastSeenAt: "2026-11-09T09:00:00.000Z", via: "oauth" },
      { product: "other", displayName: "Zed", lastSeenAt: "2026-11-09T09:30:00.000Z", via: "api_key" },
      { product: "nope", displayName: "X" },
    ],
  });
  assert.equal(merged.length, 3);
  assert.equal(merged.find((c) => c.product === "cursor").lastSeenAt, "2026-11-09T11:00:00.000Z");
  assert.equal(merged.find((c) => c.product === "cursor").via, "api_key");
  assert.deepEqual(
    merged.filter((c) => c.product === "other").map((c) => c.displayName),
    ["Goose", "Zed"],
  );
});

test("rótulo «Conectado · usado há X»", () => {
  const t = (k, v) => catalogs.pt[k].replace("{n}", v?.n ?? "").replace("{when}", v?.when ?? "");
  assert.equal(formatAgo("2026-11-09T11:59:40.000Z", now, t), "há instantes");
  assert.equal(formatAgo("2026-11-09T11:30:00.000Z", now, t), "há 30 min");
  assert.equal(formatAgo("2026-11-09T09:00:00.000Z", now, t), "há 3 h");
  assert.equal(formatAgo("2026-11-01T12:00:00.000Z", now, t), "há 8 dias");
  assert.equal(formatAgo("", now, t), "");
  const client = { product: "cursor", lastSeenAt: "2026-11-09T11:30:00.000Z" };
  assert.equal(connectedLabel(client, t, now), "Conectado · usado há 30 min");
  assert.equal(connectedLabel({ product: "cursor", lastSeenAt: "" }, t, now), "Conectado");
  assert.equal(newestClient([{ product: "claude", lastSeenAt: "2026-11-01T00:00:00.000Z" }, client]).product, "cursor");
});

function fakeFetch(routes) {
  const calls = [];
  const fetch = async (path) => {
    calls.push(path);
    const hit = routes[path];
    if (!hit) return { ok: false, status: 404, error: "http_404", data: null };
    return hit;
  };
  return { fetch, calls };
}

test("consulta só GET /api-keys; sem mcpClients não há selo", async () => {
  const ready = fakeFetch({
    "/api-keys": {
      ok: true,
      status: 200,
      data: { mcpClients: [{ product: "vscode", via: "oauth", displayName: "VS Code", lastSeenAt: "2026-11-09T11:00:00.000Z" }] },
    },
  });
  const first = await loadMcpClients(ready.fetch);
  assert.deepEqual(ready.calls, ["/api-keys"]);
  assert.equal(first.clients[0].product, "vscode");

  const noField = fakeFetch({
    "/api-keys": { ok: true, status: 200, data: { apps: [{ product: "codex", lastSeenAt: "2026-11-09T10:00:00.000Z" }], keys: [] } },
  });
  const second = await loadMcpClients(noField.fetch);
  assert.equal(second.status, "ready");
  assert.deepEqual(second.clients, []);

  const none = fakeFetch({});
  assert.equal((await loadMcpClients(none.fetch)).status, "unavailable");
  assert.deepEqual(none.calls, ["/api-keys"]);

  const auth = fakeFetch({ "/api-keys": { ok: false, status: 401, error: "unauthorized" } });
  assert.equal((await loadMcpClients(auth.fetch)).status, "auth");

  const pro = fakeFetch({
    "/api-keys": {
      ok: false,
      status: 402,
      error: "subscription_required",
      data: { mcpClients: [{ product: "cursor", via: "oauth", displayName: "Cursor", lastSeenAt: "2026-11-09T11:00:00.000Z" }] },
    },
  });
  const gated = await loadMcpClients(pro.fetch);
  assert.equal(gated.status, "pro");
  assert.equal(gated.pro, false);
  assert.equal(gated.clients[0].product, "cursor");

  assert.equal((await loadMcpClients(async () => ({ ok: false, stub: true, reason: "cloud-not-configured" }))).status, "unavailable");
  assert.equal(MCP_PRODUCTS.includes("gemini-cli"), true);
  assert.match(catalogs.pt["agentConnect.verifyWait"], /ao menos uma vez/);
  assert.match(catalogs.pt["agentConnect.verifyHint"], /10 minutos/);
  assert.match(catalogs.en["agentConnect.verifyWait"], /at least once/);
  assert.match(catalogs.es["agentConnect.verifyHint"], /10 minutos/);
});
