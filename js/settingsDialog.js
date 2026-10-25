/**
 * Configurações do workspace: um diálogo com abas.
 * Conta, Plano, Equipe, Conexões, API e MCP e Administração (staff).
 * A aba Clientes fica reservada e não é construída.
 */
import { cloudFetch } from "./cloudConfig.js";
import { t } from "./i18n.js";
import { leadProntoProblem, normalizeLeadPronto, readAuthorizeUrl } from "./leadPronto.js";

export const SETTINGS_TAB_ORDER = ["account", "plan", "team", "clients", "connections", "api", "admin"];
export const RESERVED_SETTINGS_TABS = ["clients"];
export const API_SUBTABS = ["connect", "keys", "apps"];
export const SETTINGS_RETURN_KEY = "gf-settings-return";

const API_SECTION_TAB = {
  "api-connect-heading": "connect",
  "api-keys-form": "keys",
  "api-keys-list-heading": "keys",
  "api-recent-heading": "keys",
  "api-apps-heading": "apps",
};

export function visibleSettingsTabs({ staff = false } = {}) {
  return SETTINGS_TAB_ORDER.filter((id) => {
    if (RESERVED_SETTINGS_TABS.includes(id)) return false;
    if (id === "admin" && !staff) return false;
    return true;
  });
}

export function stepSettingsTab(tabs, current, delta) {
  const list = tabs.length ? tabs : ["account"];
  const index = list.indexOf(current);
  const at = index < 0 ? 0 : index;
  const count = list.length;
  return list[(at + delta + count * 8) % count];
}

export function apiSubtabFor(id) {
  return API_SECTION_TAB[id] || "keys";
}

/** LeadPronto da conta primeiro; os outros destinos continuam por link. */
export function connectionCards() {
  return [
    { id: "leadpronto", kind: "account", sameMaker: true },
    { id: "webhook", kind: "perLink" },
    { id: "rd", kind: "perLink" },
    { id: "hubspot", kind: "perLink" },
  ];
}

/** Só os 4 últimos caracteres. Vazio quando não há o que mascarar. */
export function maskLast4(value) {
  const raw = String(value || "").trim();
  if (raw.length < 8) return "";
  return `****${raw.slice(-4)}`;
}

export function leadProntoCardText(lp, translate = t) {
  if (!lp || !lp.status) return translate("leads.lp.errLoad");
  if (lp.status === "config_missing") return translate("leads.lp.configMissing");
  if (lp.status === "disconnected") return translate("leads.lp.disconnected");
  const who = lp.tenant
    ? translate("leads.lp.connected", { tenant: lp.tenant })
    : translate("leads.lp.connectedPlain");
  if (lp.status === "disabled") return `${who}. ${translate("leads.lp.disabled")}`;
  if (lp.status === "connected") return who;
  return translate("leads.lp.disconnected");
}

export function takeSettingsReturn() {
  try {
    const value = sessionStorage.getItem(SETTINGS_RETURN_KEY);
    if (value) sessionStorage.removeItem(SETTINGS_RETURN_KEY);
    return value || "";
  } catch {
    return "";
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function roleKey(member) {
  const role = member?.isOwner ? "owner" : String(member?.role || "editor");
  if (role === "owner") return "collab.role.owner";
  if (role === "commenter") return "collab.role.commenter";
  if (role === "viewer") return "collab.role.viewer";
  return "collab.role.editor";
}

export function createSettingsDialog(deps = {}) {
  let bound = false;
  let adopted = false;
  let staffOn = false;
  let current = "account";
  let sub = "connect";
  let planOpened = false;
  let apiOpened = false;
  let lp = null;

  const account = () => deps.getAccount?.() || { signedIn: false, email: "" };

  function resolveTab(id) {
    const tabs = visibleSettingsTabs({ staff: staffOn });
    return tabs.includes(id) ? id : tabs[0];
  }

  function rebuildSelect() {
    const select = document.getElementById("settings-tab-select");
    if (!select) return;
    const tabs = visibleSettingsTabs({ staff: staffOn });
    select.replaceChildren();
    for (const id of tabs) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = t(`settings.tab.${id}`);
      select.append(opt);
    }
    if (tabs.includes(current)) select.value = current;
  }

  function show(tab) {
    current = resolveTab(tab);
    const tabs = visibleSettingsTabs({ staff: staffOn });
    for (const id of SETTINGS_TAB_ORDER) {
      const btn = document.getElementById(`settings-tab-${id}`);
      const panel = document.getElementById(`settings-panel-${id}`);
      const on = id === current;
      if (btn) {
        btn.hidden = !tabs.includes(id);
        btn.setAttribute("aria-selected", on ? "true" : "false");
        btn.tabIndex = on ? 0 : -1;
      }
      if (panel) panel.hidden = !on;
    }
    const select = document.getElementById("settings-tab-select");
    if (select && tabs.includes(current) && select.value !== current) select.value = current;
    paintGates();
  }

  function showSub(next) {
    sub = API_SUBTABS.includes(next) ? next : "connect";
    for (const id of API_SUBTABS) {
      const btn = document.getElementById(`settings-sub-${id}`);
      const panel = document.getElementById(`settings-api-${id}`);
      const on = id === sub;
      if (btn) {
        btn.setAttribute("aria-selected", on ? "true" : "false");
        btn.tabIndex = on ? 0 : -1;
      }
      if (panel) panel.hidden = !on;
    }
  }

  function paintGates() {
    const signed = Boolean(account().signedIn);
    document.querySelectorAll("#modal-settings [data-settings-account]").forEach((node) => {
      node.hidden = !signed;
    });
    document.querySelectorAll("#modal-settings [data-settings-signed-out]").forEach((node) => {
      node.hidden = signed;
    });
  }

  function paintAccount() {
    const who = account();
    const email = document.getElementById("settings-email");
    if (email) {
      email.textContent = who.signedIn && who.email ? who.email : t("settings.emailSignedOut");
    }
    paintGates();
    paintPeople();
  }

  function paintPeople() {
    const list = document.getElementById("settings-people");
    if (!list) return;
    const who = account();
    list.replaceChildren();
    if (!who.signedIn) return;
    const members = Array.isArray(deps.getPeople?.()) ? deps.getPeople() : [];
    const rows = [];
    const seen = new Set();
    const hasOwner = members.some((member) => member?.isOwner || member?.role === "owner");
    if (who.email && !hasOwner) {
      rows.push({ name: who.email, email: who.email, role: "owner", you: true });
      seen.add(who.email.toLowerCase());
    }
    for (const member of members) {
      const email = String(member?.email || "").trim().toLowerCase();
      if (email && seen.has(email)) continue;
      if (email) seen.add(email);
      rows.push(member);
    }
    if (!rows.length) {
      list.append(el("li", "settings-people-empty", t("settings.team.empty")));
      return;
    }
    const youEmail = String(who.email || "").trim().toLowerCase();
    for (const member of rows) {
      const name = member.name || member.email || "—";
      const email = String(member.email || "").trim().toLowerCase();
      const you = Boolean(member.you) || (youEmail && email === youEmail);
      const role = t(roleKey(member));
      const li = el("li", "settings-person");
      li.append(el("strong", "", name));
      li.append(el("span", "settings-person-role", you ? `${role} · ${t("settings.team.you")}` : role));
      list.append(li);
    }
  }

  function paintLp() {
    const status = document.getElementById("settings-lp-status");
    const connect = document.getElementById("btn-settings-lp-connect");
    const remove = document.getElementById("btn-settings-lp-disconnect");
    const linked = lp?.status === "connected" || lp?.status === "disabled";
    if (connect) {
      connect.hidden = Boolean(linked);
      connect.disabled = lp?.status === "config_missing";
    }
    if (remove) remove.hidden = !linked;
    if (status) status.textContent = account().signedIn ? leadProntoCardText(lp) : "";
  }

  async function loadConnections() {
    if (!account().signedIn) {
      lp = null;
      paintLp();
      return;
    }
    const status = document.getElementById("settings-lp-status");
    if (status) status.textContent = t("settings.conn.loading");
    const res = await cloudFetch("/integrations/leadpronto", {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (res?.stub) {
      lp = { status: "disconnected", tenant: "" };
      paintLp();
      return;
    }
    if (!res?.ok) {
      const problem = leadProntoProblem(res);
      lp = null;
      paintLp();
      if (status) {
        status.textContent = problem === "paywall"
          ? t("settings.conn.pro")
          : t(problem === "auth" ? "leads.lp.errAuth" : "leads.lp.errLoad");
      }
      if (problem === "paywall") deps.onUpgrade?.();
      return;
    }
    lp = normalizeLeadPronto(res.data) || { status: "disconnected", tenant: "" };
    paintLp();
  }

  async function connectLp() {
    const status = document.getElementById("settings-lp-status");
    if (status) status.textContent = t("leads.lp.opening");
    const res = await cloudFetch("/integrations/leadpronto/start", {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "manual",
    });
    const url = readAuthorizeUrl(res?.data);
    if (!res?.ok || !url) {
      const problem = leadProntoProblem(res);
      if (problem === "paywall") deps.onUpgrade?.();
      if (status) {
        status.textContent = t(
          problem === "auth" ? "leads.lp.errAuth"
            : problem === "config" ? "leads.lp.configMissing"
              : problem === "paywall" ? "settings.conn.pro"
                : "leads.lp.errConnect"
        );
      }
      return;
    }
    try {
      sessionStorage.setItem(SETTINGS_RETURN_KEY, "connections");
    } catch {
      /* a volta do OAuth ainda abre o editor */
    }
    location.assign(url);
  }

  async function disconnectLp() {
    if (!window.confirm(t("leads.lp.confirmRemove"))) return;
    const res = await cloudFetch("/integrations/leadpronto", { method: "DELETE" });
    if (!res?.ok && res?.status !== 404) {
      const problem = leadProntoProblem(res);
      if (problem === "paywall") deps.onUpgrade?.();
      deps.toast?.(t(problem === "auth" ? "leads.lp.errAuth" : "leads.lp.errRemove"), 4200);
      return;
    }
    lp = { status: "disconnected", tenant: "" };
    paintLp();
    deps.toast?.(t("leads.lp.removed"), 3000);
  }

  function adoptPlan() {
    const host = document.getElementById("settings-plan-host");
    const body = document.querySelector("#modal-subscription .subscription-dialog");
    if (!host || !body || host.dataset.adopted === "1") return;
    host.dataset.adopted = "1";
    const head = body.querySelector(".account-dialog-head");
    host.append(...[...body.childNodes].filter((node) => node !== head));
    const seats = document.getElementById("subscription-seats");
    const seatsHost = document.getElementById("settings-seats-host");
    if (seats && seatsHost) seatsHost.append(seats);
  }

  function adoptApi() {
    const host = document.getElementById("settings-api-header");
    const body = document.querySelector("#modal-api-keys .api-keys-dialog");
    if (!host || !body || host.dataset.adopted === "1") return;
    host.dataset.adopted = "1";
    const section = (id) => body.querySelector(`[aria-labelledby="${id}"]`);
    for (const node of [
      body.querySelector(".api-keys-lead"),
      document.getElementById("api-keys-status"),
      document.getElementById("api-keys-upsell"),
      document.getElementById("api-key-fresh"),
    ]) {
      if (node) host.append(node);
    }
    const connect = section("api-connect-heading");
    if (connect) document.getElementById("settings-api-connect")?.append(connect);
    const keysPanel = document.getElementById("settings-api-keys");
    for (const node of [
      document.getElementById("api-keys-form"),
      section("api-keys-list-heading"),
      section("api-recent-heading"),
    ]) {
      if (node && keysPanel) keysPanel.append(node);
    }
    const apps = section("api-apps-heading");
    if (apps) document.getElementById("settings-api-apps")?.append(apps);
  }

  function adopt() {
    if (adopted) return;
    adopted = true;
    adoptPlan();
    adoptApi();
  }

  function activate(tab, { focus = "", focusTab = false } = {}) {
    show(tab);
    paintPeople();
    const signed = Boolean(account().signedIn);
    if (signed && (current === "plan" || current === "team") && !planOpened) {
      planOpened = true;
      deps.onOpenPlan?.();
    }
    if (signed && current === "api" && !apiOpened) {
      apiOpened = true;
      deps.onOpenApi?.();
    }
    if (current === "connections") void loadConnections();
    if (focusTab) document.getElementById(`settings-tab-${current}`)?.focus();
    if (focus) {
      const fold = document.getElementById(focus === "cartesia-key" ? "settings-tts" : "settings-llm");
      if (fold) fold.open = true;
      document.getElementById(focus)?.focus();
    }
  }

  function close() {
    const dialog = document.getElementById("modal-settings");
    if (dialog?.open) dialog.close();
  }

  function open(tab = "account", opts = {}) {
    bind();
    adopt();
    const dialog = document.getElementById("modal-settings");
    if (!dialog) return;
    document.getElementById("account-chip")?.removeAttribute("open");
    document.getElementById("prefs-panel")?.removeAttribute("open");
    paintAccount();
    rebuildSelect();
    if (!dialog.open) dialog.showModal();
    activate(tab, opts);
  }

  function setStaff(on) {
    staffOn = Boolean(on);
    rebuildSelect();
    if (document.getElementById("modal-settings")?.open) show(current);
  }

  function bind() {
    if (bound) return;
    const dialog = document.getElementById("modal-settings");
    if (!dialog) return;
    bound = true;
    document.getElementById("btn-settings-close")?.addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener("close", () => {
      planOpened = false;
      apiOpened = false;
      deps.onCloseApi?.();
    });
    dialog.addEventListener("cancel", () => {
      planOpened = false;
      apiOpened = false;
    });
    const tablist = document.getElementById("settings-tabs");
    tablist?.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-settings-tab]");
      if (!btn || !tablist.contains(btn) || btn.hidden) return;
      activate(btn.dataset.settingsTab, { focusTab: true });
    });
    tablist?.addEventListener("keydown", (event) => {
      const key = event.key;
      if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"].includes(key)) return;
      const btn = event.target.closest("[role='tab']");
      if (!btn || !tablist.contains(btn)) return;
      event.preventDefault();
      const tabs = visibleSettingsTabs({ staff: staffOn });
      let next = current;
      if (key === "Home") next = tabs[0];
      else if (key === "End") next = tabs[tabs.length - 1];
      else next = stepSettingsTab(tabs, current, key === "ArrowRight" || key === "ArrowDown" ? 1 : -1);
      activate(next, { focusTab: true });
    });
    document.getElementById("settings-tab-select")?.addEventListener("change", (event) => {
      activate(event.target.value);
    });
    const sublist = document.getElementById("settings-api-tabs");
    sublist?.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-settings-subtab]");
      if (!btn || !sublist.contains(btn)) return;
      showSub(btn.dataset.settingsSubtab);
      btn.focus();
    });
    sublist?.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      const btn = event.target.closest("[role='tab']");
      if (!btn || !sublist.contains(btn)) return;
      event.preventDefault();
      event.stopPropagation();
      const delta = event.key === "ArrowRight" ? 1 : -1;
      const next = stepSettingsTab(API_SUBTABS, sub, delta);
      showSub(next);
      document.getElementById(`settings-sub-${next}`)?.focus();
    });
    document.getElementById("btn-settings-admin")?.addEventListener("click", () => deps.onAdmin?.());
    document.getElementById("btn-settings-lp-connect")?.addEventListener("click", () => void connectLp());
    document.getElementById("btn-settings-lp-disconnect")?.addEventListener("click", () => void disconnectLp());
    document.querySelectorAll("#modal-settings [data-settings-signin]").forEach((btn) => {
      btn.addEventListener("click", () => {
        close();
        deps.onSignIn?.();
      });
    });
    document.getElementById("btn-account-settings")?.addEventListener("click", () => open("account"));
    document.getElementById("btn-open-browser-keys")?.addEventListener("click", () => {
      document.getElementById("prefs-panel")?.removeAttribute("open");
      open("account", { focus: "llm-key" });
    });
    document.addEventListener("gf-open-browser-keys", (event) => {
      event.preventDefault();
      open("account", { focus: "llm-key" });
    });
    window.addEventListener("ns-locale-change", () => {
      rebuildSelect();
      paintAccount();
      paintLp();
    });
    rebuildSelect();
    showSub("connect");
  }

  if (typeof document !== "undefined") bind();

  return { open, close, setStaff, paintAccount };
}
