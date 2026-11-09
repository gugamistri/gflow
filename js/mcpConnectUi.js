/**
 * Diálogo do assistente «Criar com meu agente de IA»: escolher, um gesto, prompt.
 * O login fica com o app.js (MCP usa a conta). Sem lista da API, os cartões ficam sem selo.
 */
import { t } from "./i18n.js";
import {
  MCP_MARK,
  MCP_PRODUCTS,
  clientGesture,
  connectedLabel,
  loadMcpClients,
  newestClient,
} from "./mcpConnect.js";
import { cloudFetch } from "./cloudConfig.js";

const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

async function copyText(text, toast) {
  try {
    await navigator.clipboard.writeText(text);
    toast?.(t("agentConnect.copied"), 2400);
    return true;
  } catch {
    toast?.(t("agentConnect.copyFail"), 3600);
    return false;
  }
}

export function createMcpConnectDialog({
  toast,
  onUpgrade,
  onSignIn,
  onOpenKeys,
  hasAgentTour,
  cloudFetch: fetchImpl = cloudFetch,
} = {}) {
  let bound = false;
  let step = 1;
  let product = "";
  let otherName = "";
  let gestureDone = false;
  let snapshot = { status: "unavailable", clients: [], pro: true, mcpUrl: "" };
  let loading = false;
  let promptKind = "guided";

  const knownClients = () => {
    const map = new Map();
    for (const client of snapshot.clients || []) {
      if (client.product !== "other" && !map.has(client.product)) map.set(client.product, client);
    }
    return map;
  };
  const otherClients = () => (snapshot.clients || []).filter((c) => c.product === "other");

  function clientOf(id = product, name = otherName) {
    if (id === "other") return otherClients().find((c) => c.displayName === name) || null;
    return knownClients().get(id) || null;
  }

  function clientTitle(id = product, name = otherName) {
    if (id === "other") return name || t("agentConnect.client.other");
    return t(`agentConnect.client.${id}`);
  }

  function setStatus(text, tone) {
    const node = $("agent-connect-status");
    if (!node) return;
    node.textContent = text || "";
    node.classList.toggle("is-error", tone === "error");
    node.classList.toggle("is-ok", tone === "ok");
  }

  function paintSteps() {
    const list = $("agent-connect-steps");
    if (!list) return;
    const keys = ["choose", "connect", "ask"];
    list.replaceChildren();
    keys.forEach((key, i) => {
      const item = el("li", i + 1 === step ? "is-current" : "", `${i + 1}. ${t(`agentConnect.step.${key}`)}`);
      if (i + 1 === step) item.setAttribute("aria-current", "step");
      list.append(item);
    });
  }

  function paintClients() {
    const host = $("agent-connect-step");
    if (!host) return;
    host.replaceChildren();
    const lead = el("p", "agent-connect-lead", t("agentConnect.chooseLead"));
    host.append(lead);
    if (hasAgentTour?.()) host.append(el("p", "agent-connect-history", t("agentConnect.history")));
    const grid = el("div", "agent-connect-grid");
    grid.setAttribute("role", "group");
    grid.setAttribute("aria-label", t("agentConnect.clientsAria"));
    const known = knownClients();
    const order = [
      ...MCP_PRODUCTS.filter((id) => known.has(id)),
      ...MCP_PRODUCTS.filter((id) => !known.has(id)),
    ];
    const cards = [
      ...order.map((id) => ({ id, name: "", client: known.get(id) || null })),
      ...otherClients().map((client) => ({ id: "other", name: client.displayName, client })),
    ];
    for (const card of cards) {
      const button = el("button", "agent-client");
      button.type = "button";
      button.dataset.product = card.id;
      if (card.name) button.dataset.otherName = card.name;
      const pressed = card.id === product && (card.id !== "other" || card.name === otherName);
      button.setAttribute("aria-pressed", pressed ? "true" : "false");
      const mark = el("span", "agent-client-mark", MCP_MARK[card.id] || "•");
      mark.setAttribute("aria-hidden", "true");
      const text = el("span", "agent-client-text");
      text.append(el("span", "agent-client-name", card.id === "other" ? card.name || t("agentConnect.client.other") : t(`agentConnect.client.${card.id}`)));
      text.append(el("span", "agent-client-hint", t(`agentConnect.client.${card.id}Hint`)));
      const status = el(
        "span",
        card.client ? "agent-client-status is-on" : "agent-client-status",
        card.client ? connectedLabel(card.client, t) : t("agentConnect.notConnected"),
      );
      button.append(mark, text, status);
      button.addEventListener("click", () => {
        product = card.id;
        otherName = card.name;
        gestureDone = Boolean(card.client);
        step = 2;
        paint();
      });
      grid.append(button);
    }
    host.append(grid);
  }

  function paintGesture() {
    const host = $("agent-connect-step");
    const gesture = clientGesture(product, snapshot.mcpUrl);
    if (!host || !gesture) return;
    host.replaceChildren();
    host.append(el("h4", "agent-connect-client-title", clientTitle()));
    host.append(el("p", "agent-connect-lead", t(`agentConnect.gesture.${product}`)));
    host.append(el("p", "fixed-hint", t("agentConnect.thenLogin")));
    host.append(el("p", "agent-connect-history", t("agentConnect.verifyHint")));
    const known = clientOf(product);
    if (known) host.append(el("p", "agent-client-status is-on", connectedLabel(known, t)));

    if (gesture.kind === "link") {
      const open = el("a", "btn btn-primary", t("agentConnect.open"));
      open.href = gesture.href;
      open.target = "_blank";
      open.rel = "noopener noreferrer";
      open.addEventListener("click", () => {
        gestureDone = true;
        paintActions();
      });
      host.append(open);
    } else {
      const pre = el("pre", "agent-connect-snippet");
      const code = el("code", "", gesture.text);
      pre.append(code);
      pre.tabIndex = 0;
      pre.setAttribute("aria-label", t("agentConnect.snippetAria"));
      const copy = el("button", "btn btn-primary", t("agentConnect.copy"));
      copy.type = "button";
      copy.addEventListener("click", () => {
        void copyText(gesture.text, toast).then((ok) => {
          if (!ok) return;
          gestureDone = true;
          paintActions();
        });
      });
      host.append(pre, copy);
    }
    if (gesture.adminHref) {
      const admin = el("a", "agent-connect-admin", t("agentConnect.gesture.claudeAdmin"));
      admin.href = gesture.adminHref;
      admin.target = "_blank";
      admin.rel = "noopener noreferrer";
      host.append(admin);
    }
  }

  function paintPrompt() {
    const host = $("agent-connect-step");
    if (!host) return;
    host.replaceChildren();
    host.append(el("h4", "agent-connect-client-title", t("agentConnect.promptTitle")));
    host.append(el("p", "agent-connect-lead", t("agentConnect.promptHint")));
    const known = clientOf(product);
    if (known) host.append(el("p", "agent-client-status is-on", connectedLabel(known, t)));
    const text = t(promptKind === "gallery" ? "agentConnect.prompt.gallery" : "agentConnect.prompt.guided");
    const area = document.createElement("textarea");
    area.className = "agent-connect-prompt";
    area.readOnly = true;
    area.value = text;
    area.setAttribute("aria-label", t("agentConnect.snippetAria"));
    const row = el("div", "agent-connect-prompt-actions");
    const copy = el("button", "btn btn-primary", t("agentConnect.copy"));
    copy.type = "button";
    copy.addEventListener("click", () => void copyText(text, toast));
    const alt = el(
      "button",
      "btn",
      t(promptKind === "gallery" ? "agentConnect.step.ask" : "agentConnect.promptGallery"),
    );
    alt.type = "button";
    if (promptKind === "gallery") alt.textContent = t("agentConnect.promptTitle");
    alt.addEventListener("click", () => {
      promptKind = promptKind === "gallery" ? "guided" : "gallery";
      paintPrompt();
      paintActions();
    });
    row.append(copy, alt);
    host.append(area, row);
  }

  function paintActions() {
    const back = $("agent-connect-back");
    const next = $("agent-connect-next");
    const verify = $("agent-connect-verify");
    if (back) back.hidden = step === 1;
    if (next) {
      next.hidden = step === 1;
      next.textContent = step === 3 ? t("agentConnect.switch") : t("agentConnect.toPrompt");
      next.disabled = step === 2 && !gestureDone && !clientOf(product);
    }
    if (verify) {
      verify.hidden = step !== 2 || (!gestureDone && !clientOf(product));
      verify.disabled = loading;
      verify.textContent = loading ? t("agentConnect.verifying") : t("agentConnect.verify");
    }
  }

  function paintBanner() {
    const upsell = $("agent-connect-upsell");
    const signIn = $("btn-agent-connect-signin");
    if (upsell) upsell.hidden = snapshot.pro !== false;
    if (signIn) signIn.hidden = snapshot.status !== "auth";
    if (snapshot.status === "auth") setStatus(t("agentConnect.auth"), "error");
    else if (snapshot.status === "error") setStatus(t("agentConnect.error"), "error");
    else if (snapshot.status === "unavailable") setStatus(t("agentConnect.unavailable"));
    else setStatus("");
  }

  function paint() {
    paintSteps();
    paintBanner();
    if (step === 1) paintClients();
    else if (step === 2) paintGesture();
    else paintPrompt();
    paintActions();
  }

  async function refresh({ announce = false } = {}) {
    loading = true;
    paintActions();
    const result = await loadMcpClients(fetchImpl);
    loading = false;
    snapshot = result;
    paint();
    if (announce && product && (snapshot.status === "ready" || snapshot.status === "pro")) {
      const ok = Boolean(clientOf(product));
      setStatus(ok ? t("agentConnect.verifyOk") : t("agentConnect.verifyWait"), ok ? "ok" : "");
    }
  }

  function go(next) {
    step = next;
    if (step === 1) product = product;
    paint();
    const focus = step === 1 ? $("agent-connect-step")?.querySelector("button") : $("agent-connect-back");
    focus?.focus();
  }

  function bind() {
    if (bound) return;
    bound = true;
    $("btn-agent-connect-close")?.addEventListener("click", () => $("modal-agent-connect")?.close());
    $("agent-connect-back")?.addEventListener("click", () => go(Math.max(1, step - 1)));
    $("agent-connect-next")?.addEventListener("click", () => {
      if (step === 3) {
        step = 1;
        paint();
        return;
      }
      if (step === 2) {
        step = 3;
        promptKind = "guided";
        paint();
      }
    });
    $("agent-connect-verify")?.addEventListener("click", () => void refresh({ announce: true }));
    $("btn-agent-connect-upgrade")?.addEventListener("click", () => {
      $("modal-agent-connect")?.close();
      onUpgrade?.();
    });
    $("btn-agent-connect-signin")?.addEventListener("click", () => {
      $("modal-agent-connect")?.close();
      onSignIn?.();
    });
    $("btn-agent-connect-keys")?.addEventListener("click", () => {
      $("modal-agent-connect")?.close();
      onOpenKeys?.();
    });
  }

  function open() {
    const dialog = $("modal-agent-connect");
    if (!dialog) return;
    bind();
    step = 1;
    product = "";
    otherName = "";
    gestureDone = false;
    promptKind = "guided";
    snapshot = { status: "unavailable", clients: [], pro: true, mcpUrl: "" };
    if (!dialog.open) dialog.showModal();
    paint();
    void refresh().then(() => {
      const newest = newestClient(snapshot.clients);
      if (newest && step === 1 && !product) {
        product = newest.product;
        otherName = newest.product === "other" ? newest.displayName : "";
        gestureDone = true;
        step = 3;
        paint();
      }
    });
  }

  function repaint() {
    if ($("modal-agent-connect")?.open) paint();
  }

  return { open, refresh, repaint };
}
