/**
 * "Chaves de API" no menu da conta: cria chave (mostrada uma vez), revoga, lista apps
 * conectados via OAuth e os últimos usos. Também ensina a conectar Cursor/Claude ao MCP.
 * Só a sessão do editor fala com /api-keys; a chave nunca é guardada no navegador.
 */
import { t, getLocale } from "./i18n.js";
import { cloudFetch, PUBLISHED_CLOUD_BASE } from "./cloudConfig.js";

const $ = (id) => document.getElementById(id);

export const DEFAULT_MCP_URL = `${PUBLISHED_CLOUD_BASE}/mcp`;
export const KEY_PLACEHOLDER = "gf_live_xxxxxxxx";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * Trechos prontos para colar. Sem chave: login pelo navegador (OAuth).
 * Com chave: cabeçalho Authorization (para ferramentas sem OAuth ou automações).
 */
export function connectSnippets(mcpUrl = DEFAULT_MCP_URL, key = "") {
  const url = String(mcpUrl || DEFAULT_MCP_URL);
  const bearer = key ? `Bearer ${key}` : "";
  const cursorServer = bearer ? { url, headers: { Authorization: bearer } } : { url };
  const vscodeServer = bearer ? { type: "http", url, headers: { Authorization: bearer } } : { type: "http", url };
  return {
    cursor: JSON.stringify({ mcpServers: { guiaflow: cursorServer } }, null, 2),
    claudeCode: bearer
      ? `claude mcp add --transport http guiaflow ${url} --header "Authorization: ${bearer}"`
      : `claude mcp add --transport http guiaflow ${url}`,
    claudeAi: url,
    vscode: JSON.stringify({ servers: { guiaflow: vscodeServer } }, null, 2),
    curl: `curl -H "Authorization: Bearer ${key || KEY_PLACEHOLDER}" ${url.replace(/\/mcp$/, "")}/v1/tours`,
  };
}

/** Marca discreta "criado por agente" para tours que vieram da API/MCP (payload.createdBy). */
export function agentTagInfo(p) {
  const by = p?.createdBy;
  if (!by || by.kind !== "agent") return null;
  const client = typeof by.client === "string" ? by.client.trim().slice(0, 60) : "";
  return { client };
}

export const CONNECT_TARGETS = ["cursor", "claudeCode", "claudeAi", "vscode", "curl"];

function formatDate(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const locale = { pt: "pt-BR", es: "es", en: "en" }[getLocale?.() || "pt"] || "pt-BR";
  return date.toLocaleString(locale, { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
}

export function scopeLabel(id) {
  const key = `apiKeys.scope.${id}`;
  const label = t(key);
  return label && label !== key ? label : id;
}

async function copyText(text, toast) {
  try {
    await navigator.clipboard.writeText(text);
    toast?.(t("apiKeys.copied"), 2400);
  } catch {
    toast?.(t("apiKeys.copyFail"), 3600);
  }
}

export function createApiKeysDialog({ toast, onUpgrade } = {}) {
  let bound = false;
  let state = null;
  let target = "cursor";
  let freshKey = "";

  const els = () => ({
    dialog: $("modal-api-keys"),
    close: $("btn-api-keys-close"),
    status: $("api-keys-status"),
    upsell: $("api-keys-upsell"),
    upsellBtn: $("btn-api-keys-upgrade"),
    form: $("api-keys-form"),
    name: $("api-key-name"),
    scopes: $("api-key-scopes"),
    expiry: $("api-key-expiry"),
    create: $("btn-api-key-create"),
    fresh: $("api-key-fresh"),
    freshValue: $("api-key-fresh-value"),
    freshCopy: $("btn-api-key-copy"),
    keys: $("api-keys-list"),
    apps: $("api-apps-list"),
    recent: $("api-recent-list"),
    tabs: $("api-connect-tabs"),
    snippet: $("api-connect-snippet"),
    hint: $("api-connect-hint"),
    snippetCopy: $("btn-api-connect-copy"),
  });

  function paintConnect() {
    const e = els();
    if (!e.snippet) return;
    const snippets = connectSnippets(state?.mcpUrl || DEFAULT_MCP_URL, freshKey);
    e.snippet.value = snippets[target];
    e.hint.textContent = t(`apiKeys.connect.hint.${target}${freshKey && target !== "claudeAi" ? "Key" : ""}`);
    e.tabs?.querySelectorAll("[data-target]").forEach((tab) => {
      const on = tab.dataset.target === target;
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.tabIndex = on ? 0 : -1;
    });
  }

  function paintScopes() {
    const e = els();
    e.scopes.replaceChildren();
    for (const scope of state?.scopes || []) {
      const label = el("label", "api-key-scope");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.value = scope.id;
      box.checked = scope.default !== false;
      label.append(box, el("span", "", scopeLabel(scope.id)), el("code", "", scope.id));
      e.scopes.append(label);
    }
    e.expiry.replaceChildren();
    for (const days of state?.ttlDays || [30, 90, 365]) {
      const opt = el("option", "", t("apiKeys.days", { n: days }));
      opt.value = String(days);
      opt.selected = days === (state?.defaultTtlDays || 90);
      e.expiry.append(opt);
    }
  }

  function emptyRow(text) {
    return el("p", "api-keys-empty", text);
  }

  function paintLists() {
    const e = els();
    e.keys.replaceChildren();
    const keys = state?.keys || [];
    if (!keys.length) e.keys.append(emptyRow(t("apiKeys.noKeys")));
    for (const key of keys) {
      const row = el("div", "api-keys-row");
      row.setAttribute("role", "listitem");
      const head = el("div", "api-keys-row-head");
      head.append(el("strong", "", key.name), el("code", "api-keys-last4", `gf_live_…${key.last4}`));
      if (key.status === "expired") head.append(el("span", "api-keys-badge is-off", t("apiKeys.expired")));
      const revoke = el("button", "btn btn-sm api-keys-revoke", t("apiKeys.revoke"));
      revoke.type = "button";
      revoke.addEventListener("click", () => void revokeKey(key));
      head.append(revoke);
      row.append(head);
      row.append(
        el(
          "p",
          "api-keys-meta",
          [
            (key.scopes || []).map(scopeLabel).join(" · "),
            t("apiKeys.expires", { date: formatDate(key.expiresAt) }),
            key.lastUsedAt ? t("apiKeys.lastUsed", { date: formatDate(key.lastUsedAt) }) : t("apiKeys.neverUsed"),
          ].join(" — "),
        ),
      );
      e.keys.append(row);
    }

    e.apps.replaceChildren();
    const apps = state?.apps || [];
    if (!apps.length) e.apps.append(emptyRow(t("apiKeys.noApps")));
    for (const app of apps) {
      const row = el("div", "api-keys-row");
      row.setAttribute("role", "listitem");
      const head = el("div", "api-keys-row-head");
      head.append(el("strong", "", app.name || "MCP"));
      const revoke = el("button", "btn btn-sm api-keys-revoke", t("apiKeys.disconnect"));
      revoke.type = "button";
      revoke.addEventListener("click", () => void revokeApp(app));
      head.append(revoke);
      row.append(head);
      row.append(
        el(
          "p",
          "api-keys-meta",
          [
            (app.scopes || []).map(scopeLabel).join(" · "),
            t("apiKeys.connectedAt", { date: formatDate(app.createdAt) }),
            app.lastUsedAt ? t("apiKeys.lastUsed", { date: formatDate(app.lastUsedAt) }) : t("apiKeys.neverUsed"),
          ].join(" — "),
        ),
      );
      e.apps.append(row);
    }

    e.recent.replaceChildren();
    const recent = state?.recent || [];
    if (!recent.length) e.recent.append(emptyRow(t("apiKeys.noRecent")));
    for (const item of recent) {
      const row = el("div", "api-recent-row");
      row.setAttribute("role", "listitem");
      row.append(
        el("time", "", formatDate(item.at)),
        el("span", "api-recent-client", item.client || ""),
        el("code", "", item.action || ""),
        el("span", `api-recent-status${Number(item.status) >= 400 ? " is-error" : ""}`, String(item.status || "")),
      );
      e.recent.append(row);
    }
  }

  function paint() {
    const e = els();
    const canCreate = Boolean(state?.canCreate);
    e.upsell.hidden = !state || canCreate;
    e.form.hidden = !canCreate;
    e.fresh.hidden = !freshKey;
    if (freshKey) e.freshValue.value = freshKey;
    paintLists();
    paintConnect();
  }

  async function load() {
    const e = els();
    e.status.textContent = t("apiKeys.loading");
    const res = await cloudFetch("/api-keys", { method: "GET", timeoutMs: 15000 });
    if (!res.ok) {
      e.status.textContent = res.status === 401 ? t("apiKeys.errAuth") : t("apiKeys.errLoad");
      return;
    }
    state = res.data || {};
    e.status.textContent = "";
    paintScopes();
    paint();
  }

  async function createKey(event) {
    event?.preventDefault?.();
    const e = els();
    const name = e.name.value.trim();
    if (!name) {
      e.name.focus();
      e.status.textContent = t("apiKeys.needName");
      return;
    }
    const scopes = [...e.scopes.querySelectorAll("input:checked")].map((box) => box.value);
    if (!scopes.length) {
      e.status.textContent = t("apiKeys.needScope");
      return;
    }
    e.create.disabled = true;
    const res = await cloudFetch("/api-keys", {
      method: "POST",
      body: JSON.stringify({ name, scopes, expiresInDays: Number(e.expiry.value) }),
      timeoutMs: 15000,
    });
    e.create.disabled = false;
    if (!res.ok) {
      e.status.textContent = res.error === "key_limit" ? t("apiKeys.errLimit") : res.status === 402 || res.status === 403 ? t("apiKeys.errPro") : t("apiKeys.errCreate");
      return;
    }
    freshKey = String(res.data?.key || "");
    e.name.value = "";
    e.status.textContent = "";
    state.keys = [res.data.apiKey, ...(state.keys || [])].filter(Boolean);
    paint();
    e.freshValue.focus();
    e.freshValue.select();
  }

  async function revokeKey(key) {
    if (!window.confirm(t("apiKeys.confirmRevoke", { name: key.name }))) return;
    const res = await cloudFetch(`/api-keys/${encodeURIComponent(key.id)}`, { method: "DELETE" });
    if (!res.ok) {
      toast?.(t("apiKeys.errRevoke"), 4200);
      return;
    }
    state.keys = (state.keys || []).filter((k) => k.id !== key.id);
    paint();
    toast?.(t("apiKeys.revoked"), 3000);
  }

  async function revokeApp(app) {
    if (!window.confirm(t("apiKeys.confirmDisconnect", { name: app.name || "MCP" }))) return;
    const res = await cloudFetch(`/api-keys/apps/${encodeURIComponent(app.id)}`, { method: "DELETE" });
    if (!res.ok) {
      toast?.(t("apiKeys.errRevoke"), 4200);
      return;
    }
    state.apps = (state.apps || []).filter((a) => a.id !== app.id);
    paint();
    toast?.(t("apiKeys.disconnected"), 3000);
  }

  function bind() {
    if (bound) return;
    bound = true;
    const e = els();
    e.close?.addEventListener("click", () => e.dialog.close());
    e.dialog?.addEventListener("close", () => {
      // why: a chave só aparece uma vez; ao fechar, some da tela e da memória.
      freshKey = "";
      if (e.freshValue) e.freshValue.value = "";
    });
    e.form?.addEventListener("submit", createKey);
    e.freshCopy?.addEventListener("click", () => void copyText(freshKey, toast));
    e.snippetCopy?.addEventListener("click", () => void copyText(e.snippet.value, toast));
    e.upsellBtn?.addEventListener("click", () => {
      e.dialog?.close();
      document.getElementById("modal-settings")?.close();
      onUpgrade?.();
    });
    e.tabs?.addEventListener("click", (event) => {
      const tab = event.target.closest("[data-target]");
      if (!tab) return;
      target = tab.dataset.target;
      paintConnect();
    });
    e.tabs?.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      const i = CONNECT_TARGETS.indexOf(target);
      const step = event.key === "ArrowRight" ? 1 : -1;
      target = CONNECT_TARGETS[(i + step + CONNECT_TARGETS.length) % CONNECT_TARGETS.length];
      paintConnect();
      e.tabs.querySelector(`[data-target="${target}"]`)?.focus();
    });
  }

  function dismissFresh() {
    freshKey = "";
    const e = els();
    if (e.fresh) e.fresh.hidden = true;
    if (e.freshValue) e.freshValue.value = "";
  }

  function open() {
    const e = els();
    const hosted = Boolean(document.getElementById("settings-panel-api")?.contains(document.getElementById("api-connect-tabs")));
    if (!e.dialog && !hosted) return;
    bind();
    state = null;
    freshKey = "";
    if (e.upsell) e.upsell.hidden = true;
    if (e.form) e.form.hidden = true;
    if (e.fresh) e.fresh.hidden = true;
    if (e.freshValue) e.freshValue.value = "";
    paintConnect();
    if (!hosted && e.dialog && !e.dialog.open) e.dialog.showModal();
    void load();
  }

  return { open, dismissFresh };
}
