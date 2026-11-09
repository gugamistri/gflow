/**
 * Assistente «Criar com meu agente de IA»: catálogo dos clientes, gestos documentados
 * e leitura tolerante de quem já conectou.
 *
 * Só `GET /api-keys` (JWT da sessão). O corpo ganha `mcpClients`. Sem esse campo,
 * o assistente segue sem o selo «conectado». Não há `GET /v1/me/mcp-clients`.
 */
import { PUBLISHED_CLOUD_BASE } from "./cloudConfig.js";

export const DEFAULT_MCP_URL = `${PUBLISHED_CLOUD_BASE}/mcp`;

/** Ids que a API normaliza. `other` não vira cartão. */
export const MCP_PRODUCTS = [
  "claude",
  "claude-code",
  "chatgpt",
  "codex",
  "cursor",
  "vscode",
  "windsurf",
  "gemini-cli",
];

const PRODUCT_SET = new Set(MCP_PRODUCTS);

/** Letra do monograma. Não é logo: as marcas não têm licença para cópia aqui. */
export const MCP_MARK = {
  claude: "C",
  "claude-code": ">",
  chatgpt: "G",
  codex: "{",
  cursor: "↗",
  vscode: "</>",
  windsurf: "~",
  "gemini-cli": "*",
};

export function mcpUrl(explicit) {
  const url = String(explicit || DEFAULT_MCP_URL).trim();
  if (!/^https:\/\/[^\s"'<>]+$/i.test(url)) return DEFAULT_MCP_URL;
  return url;
}

function claudeInstallUrl(url, admin) {
  const base = admin ? "https://claude.ai/admin-settings/connectors" : "https://claude.ai/customize/connectors";
  const q = new URLSearchParams({
    modal: "add-custom-connector",
    connectorName: "GuiaFlow",
    connectorUrl: url,
  });
  return `${base}?${q}`;
}

function cursorInstallUrl(url) {
  const config = btoa(JSON.stringify({ url }));
  const q = new URLSearchParams({ name: "guiaflow", config });
  return `https://cursor.com/link/mcp/install?${q}`;
}

function vscodeInstallUrl(url) {
  const config = JSON.stringify({ name: "guiaflow", type: "http", url });
  const deep = `vscode:mcp/install?${encodeURIComponent(config)}`;
  return `https://vscode.dev/redirect?url=${encodeURIComponent(deep)}`;
}

/**
 * Um gesto por cliente. `kind: "link"` abre uma página; `kind: "copy"` é texto para colar.
 * @returns {{ kind: "link"|"copy", href?: string, text?: string, adminHref?: string }}
 */
export function clientGesture(product, explicitUrl) {
  const url = mcpUrl(explicitUrl);
  switch (product) {
    case "claude":
      return { kind: "link", href: claudeInstallUrl(url, false), adminHref: claudeInstallUrl(url, true) };
    case "claude-code":
      return { kind: "copy", text: `claude mcp add --transport http --scope user guiaflow ${url}` };
    case "chatgpt":
      return { kind: "copy", text: url };
    case "codex":
      return { kind: "copy", text: `codex mcp add guiaflow --url ${url}\ncodex mcp login guiaflow` };
    case "cursor":
      return { kind: "link", href: cursorInstallUrl(url) };
    case "vscode":
      return { kind: "link", href: vscodeInstallUrl(url) };
    case "windsurf":
      return {
        kind: "copy",
        text: JSON.stringify({ mcpServers: { guiaflow: { serverUrl: url } } }, null, 2),
      };
    case "gemini-cli":
      return { kind: "copy", text: `gemini mcp add --transport http --scope user guiaflow ${url}` };
    case "other":
      return { kind: "copy", text: url };
    default:
      return null;
  }
}

function asIso(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const time = Date.parse(value);
  return Number.isNaN(time) ? "" : new Date(time).toISOString();
}

/** Um item de `mcpClients`. `other` fica, com o displayName cru. O resto fora da lista sai. */
export function normalizeMcpClient(raw) {
  if (!raw || typeof raw !== "object") return null;
  const product = String(raw.product || "").trim().toLowerCase();
  if (product !== "other" && !PRODUCT_SET.has(product)) return null;
  const via = raw.via === "api_key" || raw.via === "oauth" ? raw.via : "";
  const lastSeenAt = asIso(raw.lastSeenAt);
  const displayName = typeof raw.displayName === "string" ? raw.displayName.trim().slice(0, 80) : "";
  return { product, displayName, lastSeenAt, via };
}

function rowKey(item) {
  return item.product === "other" ? `other\n${item.displayName}` : item.product;
}

/** Uma linha por produto. Vários `other` permanecem se o displayName for outro. */
function dedupe(list) {
  const byKey = new Map();
  for (const item of list) {
    const key = rowKey(item);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, item);
      continue;
    }
    const prevTime = prev.lastSeenAt ? Date.parse(prev.lastSeenAt) : 0;
    const nextTime = item.lastSeenAt ? Date.parse(item.lastSeenAt) : 0;
    if (nextTime >= prevTime) byKey.set(key, { ...prev, ...item, via: item.via || prev.via });
  }
  return [...byKey.values()];
}

/**
 * Lê só `mcpClients`. null = campo ausente (sem selo). Array vazio = ninguém conectado.
 */
export function clientsFromPayload(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  if (!Array.isArray(data.mcpClients)) return null;
  return dedupe(data.mcpClients.map(normalizeMcpClient).filter(Boolean));
}

function isMissing(res) {
  return !res || res.status === 404 || res.error === "http_404" || res.error === "not_found";
}

function isAuth(res) {
  return res?.status === 401 || res?.error === "unauthorized";
}

function isPro(res) {
  return res?.status === 402 || res?.error === "subscription_required";
}

/**
 * @param {(path: string, init?: object) => Promise<{ok?: boolean, status?: number, error?: string, data?: unknown}>} cloudFetch
 */
export async function loadMcpClients(cloudFetch, { mcpUrl: explicitUrl } = {}) {
  const url = mcpUrl(explicitUrl);
  const res = await cloudFetch("/api-keys", { method: "GET", timeoutMs: 15000 });
  if (res?.stub || res?.reason === "cloud-not-configured") {
    return { status: "unavailable", clients: [], pro: true, mcpUrl: url };
  }
  if (isAuth(res)) return { status: "auth", clients: [], pro: true, mcpUrl: url };
  if (res?.ok) {
    const clients = clientsFromPayload(res.data);
    return { status: "ready", clients: clients || [], pro: true, mcpUrl: url };
  }
  if (isPro(res)) {
    return { status: "pro", clients: clientsFromPayload(res.data) || [], pro: false, mcpUrl: url };
  }
  if (isMissing(res)) return { status: "unavailable", clients: [], pro: true, mcpUrl: url };
  return { status: "error", clients: [], pro: true, mcpUrl: url };
}

/** Trecho «há 5 min» / «5 min ago». Vazio se a data não existe. */
export function formatAgo(iso, now = Date.now(), t = (k) => k) {
  const time = Date.parse(iso || "");
  if (Number.isNaN(time)) return "";
  const delta = Math.max(0, now - time);
  const min = Math.floor(delta / 60000);
  if (min < 1) return t("agentConnect.agoNow");
  if (min < 60) return t("agentConnect.agoMinutes", { n: min });
  const hours = Math.floor(min / 60);
  if (hours < 48) return t("agentConnect.agoHours", { n: hours });
  const days = Math.floor(hours / 24);
  return t("agentConnect.agoDays", { n: days });
}

/** «Conectado · usado há X», ou só «Conectado» sem data. */
export function connectedLabel(client, t, now = Date.now()) {
  if (!client) return "";
  const when = formatAgo(client.lastSeenAt, now, t);
  if (!when) return t("agentConnect.connected");
  return t("agentConnect.used", { when });
}

/** O mais recente, para abrir direto no prompt. */
export function newestClient(clients) {
  let best = null;
  let bestTime = -1;
  for (const client of clients || []) {
    const time = client.lastSeenAt ? Date.parse(client.lastSeenAt) : 0;
    if (!best || time >= bestTime) {
      best = client;
      bestTime = time;
    }
  }
  return best;
}
