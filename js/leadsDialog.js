/**
 * Contatos do link permanente e os conectores Webhook, RD Station, HubSpot e LeadPronto.
 * A lista fica na aba Contatos; os conectores, na aba Envio automático do mesmo diálogo.
 * Webhook, RD Station e HubSpot são do link. O LeadPronto é da conta
 * (GET/PUT/DELETE /integrations/leadpronto). CSV no navegador.
 */
import { t, getLocale } from "./i18n.js";
import { cloudFetch } from "./cloudConfig.js";
import { formatLeadPhone, leadPhoneE164, leadsToCsv } from "./fixedSteps.js";
import {
  WEBHOOK_HELP,
  generateWebhookSecret,
  isWebhookSecret,
  normalizeTestResult,
  normalizeWebhook,
  planWebhookSave,
  webhookProblem,
} from "./leadWebhook.js";
import {
  RD_HELP,
  normalizeRdStation,
  planRdSave,
  rdProblem,
} from "./rdStation.js";
import {
  HUBSPOT_FIELDS,
  HUBSPOT_HELP,
  authorizeUrlOf,
  hubspotConnectMode,
  hubspotProblem,
  normalizeHubspot,
  normalizeTestResult as normalizeHubspotTest,
  planHubspotSave,
  readHubspotView,
} from "./hubspot.js";
import {
  LP_HELP,
  leadProntoProblem,
  leadProntoReturnKey,
  normalizeLeadPronto,
  normalizeShareList,
  planLeadProntoSave,
  readAuthorizeUrl,
} from "./leadPronto.js";

const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso || "");
  const locale = { pt: "pt-BR", es: "es", en: "en" }[getLocale?.() || "pt"] || "pt-BR";
  return date.toLocaleString(locale, { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
}

function formatPhone(stored) {
  return formatLeadPhone(stored);
}

/** Data do CSV no fuso America/Sao_Paulo ("2026-10-11 11:03:04"), que o Excel reconhece. */
export function csvDate(iso) {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo", hour12: false });
}

export function csvFileName(slug, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  return `contatos-${String(slug || "tour").replace(/[^a-z0-9-]/gi, "")}-${day}.csv`;
}

/** Ordem fixa dos cartões de Envio automático: LeadPronto primeiro, depois os do link. */
export const DELIVERY_ORDER = ["lp", "webhook", "rd", "hubspot"];

/** Destinos com rota de teste própria. O LeadPronto não tem (só GET/PUT/DELETE). */
export const DELIVERY_TESTABLE = ["webhook", "rd", "hubspot"];

/** Qual <section> cada destino abre na sub-tela de detalhe. */
const DELIVERY_SECTION = {
  lp: "leads-lp",
  webhook: "leads-webhook",
  rd: "leads-rd",
  hubspot: "leads-hubspot",
};

const DELIVERY_COPY = Object.fromEntries(DELIVERY_ORDER.map((id) => [id, {
  ok: `leads.${id}.lastOk`,
  fail: `leads.${id}.lastFail`,
  failures: `leads.${id}.failures`,
  autoOff: `leads.${id}.autoOff`,
}]));

const DELIVERY_STATE_KEYS = {
  on: "leads.delivery.stateOn",
  off: "leads.delivery.stateOff",
  fail: "leads.delivery.stateFail",
};

/**
 * Estado do cartão. "fail" (falhando) vence "on" (conectado);
 * "off" (desligado) cobre também o destino ainda não configurado.
 */
export function deliveryState({ configured, enabled, failures = 0, autoDisabled = false } = {}) {
  if (autoDisabled || failures > 0) return "fail";
  return configured && enabled ? "on" : "off";
}

export function createLeadsDialog({ getSlug, toast, onPaywall } = {}) {
  let leads = [];
  let title = "";
  let bound = false;
  let loading = false;
  let webhook = null;
  let secretDraft = "";
  let secretVisible = false;
  let secretDirty = false;
  let webhookBusy = false;
  let rd = null;
  let rdKeyDraft = "";
  let rdBusy = false;
  let hubspot = null;
  let hubspotBusy = false;
  let hubspotDirty = new Set();
  let hubspotReturn = null;
  let hubspotOauth = false;
  let hubspotTokenOpen = false;
  let lp = null;
  let lpShares = [];
  let lpAll = true;
  let lpEnabled = false;
  let lpTourPick = new Set();
  let lpBusy = false;
  let lpReady = false;
  let returnNotice = null;

  const els = () => ({
    dialog: $("modal-results"),
    meta: $("leads-meta"),
    status: $("leads-status"),
    list: $("leads-list"),
    csv: $("btn-leads-csv"),
    refresh: $("btn-leads-refresh"),
    close: $("btn-results-close"),
    url: $("leads-webhook-url"),
    enabled: $("leads-webhook-enabled"),
    secret: $("leads-webhook-secret"),
    reveal: $("btn-leads-webhook-reveal"),
    copy: $("btn-leads-webhook-copy"),
    remove: $("btn-leads-webhook-remove"),
    help: $("leads-webhook-help"),
    whStatus: $("leads-webhook-status"),
    delivery: $("leads-webhook-delivery"),
    save: $("btn-leads-webhook-save"),
    test: $("btn-leads-webhook-test"),
    rotate: $("btn-leads-webhook-rotate"),
    rdKey: $("leads-rd-key"),
    rdEnabled: $("leads-rd-enabled"),
    rdHint: $("leads-rd-key-hint"),
    rdHelp: $("leads-rd-help"),
    rdStatus: $("leads-rd-status"),
    rdDelivery: $("leads-rd-delivery"),
    rdSave: $("btn-leads-rd-save"),
    rdTest: $("btn-leads-rd-test"),
    rdRemove: $("btn-leads-rd-remove"),
    hsAccount: $("leads-hubspot-account"),
    hsEnabled: $("leads-hubspot-enabled"),
    hsDelivery: $("leads-hubspot-delivery"),
    hsStatus: $("leads-hubspot-status"),
    hsConnect: $("btn-leads-hubspot-connect"),
    hsUseToken: $("btn-leads-hubspot-use-token"),
    hsToken: $("leads-hubspot-token"),
    hsTokenBlock: $("leads-hubspot-token-block"),
    hsSave: $("btn-leads-hubspot-save"),
    hsTest: $("btn-leads-hubspot-test"),
    hsRemove: $("btn-leads-hubspot-remove"),
    hsHelp: $("leads-hubspot-help"),
    lpAccount: $("leads-lp-account"),
    lpControls: $("leads-lp-controls"),
    lpEnabled: $("leads-lp-enabled"),
    lpAll: $("leads-lp-all"),
    lpTours: $("leads-lp-tours"),
    lpHint: $("leads-lp-hint"),
    lpHelp: $("leads-lp-help"),
    lpStatus: $("leads-lp-status"),
    lpDelivery: $("leads-lp-delivery"),
    lpConnect: $("btn-leads-lp-connect"),
    lpSave: $("btn-leads-lp-save"),
    lpRemove: $("btn-leads-lp-disconnect"),
    deliveryList: $("delivery-list"),
    deliveryDetail: $("delivery-detail"),
    deliveryBack: $("btn-delivery-back"),
    map: Object.fromEntries(HUBSPOT_FIELDS.map((key) => [key, document.querySelector(`[data-hubspot-field="${key}"]`)])),
  });

  /** Nó de um cartão: `delivery-<parte>-<destino>` (state, level, delivery, status). */
  function cardNode(id, part) {
    return $(`delivery-${part}-${id}`);
  }

  /** LeadPronto é conexão da conta; webhook, RD Station e HubSpot são deste link. */
  function cardLevelKey(id) {
    return id === "lp" ? "leads.delivery.levelAccount" : "leads.delivery.levelLink";
  }

  /** Estado do servidor de cada destino — a mesma fonte de verdade das seções de detalhe. */
  function deliverySnapshot(id) {
    if (id === "lp") {
      return {
        configured: lpLinked(),
        enabled: Boolean(lpEnabled),
        failures: lp?.consecutiveFailures || 0,
        autoDisabled: Boolean(lp?.autoDisabled),
        busy: lpBusy,
      };
    }
    if (id === "webhook") {
      return {
        configured: Boolean(webhook?.url),
        enabled: Boolean(webhook?.enabled),
        failures: webhook?.consecutiveFailures || 0,
        autoDisabled: Boolean(webhook?.autoDisabled),
        busy: webhookBusy,
      };
    }
    if (id === "rd") {
      return {
        configured: Boolean(rd?.hasKey),
        enabled: Boolean(rd?.enabled),
        failures: rd?.consecutiveFailures || 0,
        autoDisabled: Boolean(rd?.autoDisabled),
        busy: rdBusy,
      };
    }
    return {
      configured: Boolean(hubspot?.connected),
      enabled: Boolean(hubspot?.enabled),
      failures: hubspot?.consecutiveFailures || 0,
      autoDisabled: Boolean(hubspot?.autoDisabled),
      busy: hubspotBusy,
    };
  }

  /** Repinta os cartões: estado, nível de conexão e últimas entregas. */
  function paintCards() {
    for (const id of DELIVERY_ORDER) {
      const snapshot = deliverySnapshot(id);
      const state = deliveryState(snapshot);
      const stateNode = cardNode(id, "state");
      if (stateNode) {
        stateNode.textContent = t(DELIVERY_STATE_KEYS[state]);
        stateNode.classList.toggle("is-on", state === "on");
        stateNode.classList.toggle("is-off", state === "off");
        stateNode.classList.toggle("is-fail", state === "fail");
      }
      const levelNode = cardNode(id, "level");
      if (levelNode) levelNode.textContent = t(cardLevelKey(id));
      const deliveryNode = cardNode(id, "delivery");
      if (deliveryNode) deliveryNode.textContent = deliveryParts(id).slice(0, 2).join(" ");
      const testBtn = $(`btn-delivery-test-${id}`);
      if (testBtn) testBtn.disabled = snapshot.busy;
    }
  }

  /** Espelha a mensagem da seção no rodapé do cartão (visível na lista). */
  function setCardStatus(id, text, error = false) {
    const node = cardNode(id, "status");
    if (!node) return;
    node.textContent = text || "";
    node.classList.toggle("is-error", Boolean(error && text));
  }

  let deliveryView = "list";
  let deliveryDetailId = "";

  /** Lista de cartões x sub-tela de detalhe com uma seção (e só uma) visível. */
  function paintDeliveryView() {
    const e = els();
    const inDetail = deliveryView === "detail";
    if (e.deliveryList) e.deliveryList.hidden = inDetail;
    if (e.deliveryDetail) e.deliveryDetail.hidden = !inDetail;
    for (const id of DELIVERY_ORDER) {
      const section = $(DELIVERY_SECTION[id]);
      if (section) section.hidden = !(inDetail && id === deliveryDetailId);
      const open = $(`btn-delivery-open-${id}`);
      if (open) open.setAttribute("aria-expanded", String(inDetail && id === deliveryDetailId));
    }
  }

  function showDeliveryDetail(id) {
    if (!DELIVERY_SECTION[id] || !els().deliveryDetail) return;
    deliveryView = "detail";
    deliveryDetailId = id;
    paintDeliveryView();
    els().deliveryBack?.focus?.();
  }

  function backToDeliveryList() {
    const from = deliveryDetailId;
    deliveryView = "list";
    paintDeliveryView();
    $(`btn-delivery-open-${from}`)?.focus?.();
  }

  function sourceLabel(source) {
    return source === "contact" ? t("leads.sourceContact") : t("leads.sourceStart");
  }

  function paint() {
    const e = els();
    e.list.replaceChildren();
    e.csv.disabled = !leads.length;
    e.meta.textContent = leads.length || title ? t("leads.meta", { n: leads.length, title: title || "" }) : "";
    if (!leads.length) {
      if (!loading && !e.status.textContent) e.status.textContent = t("leads.empty");
      return;
    }
    for (const lead of leads) {
      const row = el("div", "leads-row");
      row.setAttribute("role", "listitem");
      const head = el("div", "leads-row-head");
      head.append(el("strong", "leads-name", lead.name || lead.email || formatPhone(lead.phone) || "—"));
      head.append(el("span", `leads-source leads-source-${lead.source === "contact" ? "contact" : "start"}`, sourceLabel(lead.source)));
      head.append(el("time", "leads-date", formatDate(lead.createdAt)));
      const del = el("button", "btn btn-icon leads-delete", "×");
      del.type = "button";
      del.title = t("leads.delete");
      del.setAttribute("aria-label", `${t("leads.delete")}: ${lead.name || lead.email || ""}`);
      del.addEventListener("click", () => void remove(lead));
      head.append(del);
      row.append(head);
      const contact = el("div", "leads-contact");
      if (lead.email) {
        const a = el("a", "", lead.email);
        a.href = `mailto:${lead.email}`;
        contact.append(a);
      }
      if (lead.phone) {
        const a = el("a", "", formatPhone(lead.phone));
        a.href = `https://wa.me/${leadPhoneE164(lead.phone).slice(1)}`;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        contact.append(a);
      }
      if (contact.childElementCount) row.append(contact);
      if (lead.message) row.append(el("p", "leads-message", lead.message));
      const consent = el("p", "leads-consent", lead.consent ? t("leads.consentAt", { date: formatDate(lead.consentAt || lead.createdAt) }) : "");
      if (lead.consentText) consent.title = lead.consentText;
      row.append(consent);
      if (lead.source === "contact" && lead.delivered === false) row.append(el("p", "leads-undelivered", t("leads.undelivered")));
      e.list.append(row);
    }
  }

  function setWebhookMessage(text, error = false) {
    const node = els().whStatus;
    if (node) {
      node.textContent = text || "";
      node.classList.toggle("is-error", Boolean(error && text));
    }
    setCardStatus("webhook", text, error);
  }

  function paintWebhook() {
    const e = els();
    if (!e.secret) return;
    e.secret.value = secretDraft;
    e.secret.type = secretVisible ? "text" : "password";
    e.secret.placeholder = !secretDraft && webhook?.secretLast4 ? `whsec_…${webhook.secretLast4}` : "whsec_…";
    if (e.reveal) e.reveal.textContent = t(secretVisible ? "leads.webhook.hide" : "leads.webhook.reveal");
    if (e.copy) e.copy.hidden = !secretDraft;
    if (e.remove) e.remove.hidden = !webhook;
    if (e.help) e.help.href = WEBHOOK_HELP[getLocale()] || WEBHOOK_HELP.pt;
    for (const btn of [e.save, e.test, e.rotate, e.remove, e.reveal]) {
      if (btn) btn.disabled = webhookBusy;
    }
    paintDelivery();
    paintCards();
  }

  /** Linhas de "últimas entregas" de um destino ([] quando ainda não há nada a mostrar). */
  function deliveryParts(id) {
    const copy = DELIVERY_COPY[id];
    if (id === "webhook") {
      if (!webhook) return [];
      const parts = [];
      const delivery = webhook.lastDelivery;
      if (!delivery) parts.push(t("leads.webhook.none"));
      else parts.push(t(delivery.ok ? copy.ok : copy.fail, deliveryLine(delivery)));
      if (webhook.consecutiveFailures > 0) parts.push(t(copy.failures, { n: webhook.consecutiveFailures }));
      if (webhook.autoDisabled) parts.push(t(copy.autoOff));
      return parts;
    }
    if (id === "rd") {
      if (!rd) return [];
      const parts = [];
      const delivery = rd.lastDelivery;
      if (delivery) parts.push(t(delivery.ok ? copy.ok : copy.fail, deliveryLine(delivery)));
      if (rd.consecutiveFailures > 0) parts.push(t(copy.failures, { n: rd.consecutiveFailures }));
      if (rd.autoDisabled) parts.push(t(copy.autoOff));
      return parts;
    }
    if (id === "hubspot") {
      if (!hubspot) return [];
      const parts = [];
      for (const delivery of (hubspot.deliveries || []).slice(0, 3)) {
        parts.push(t(delivery.ok ? copy.ok : copy.fail, deliveryLine(delivery)));
      }
      if (hubspot.consecutiveFailures > 0) parts.push(t(copy.failures, { n: hubspot.consecutiveFailures }));
      if (hubspot.autoDisabled) parts.push(t(copy.autoOff));
      return parts;
    }
    if (!lpLinked()) return [];
    const parts = [];
    const rows = Array.isArray(lp.deliveries) ? lp.deliveries : [];
    if (!rows.length) parts.push(t("leads.lp.none"));
    for (const delivery of rows) parts.push(t(delivery.ok ? copy.ok : copy.fail, deliveryLine(delivery)));
    if (lp.consecutiveFailures > 0) parts.push(t(copy.failures, { n: lp.consecutiveFailures }));
    if (lp.autoDisabled) parts.push(t(copy.autoOff));
    return parts;
  }

  function deliveryLine(delivery) {
    const status = delivery.httpStatus ? String(delivery.httpStatus) : delivery.error || "—";
    return { date: delivery.at ? formatDate(delivery.at) : "—", status };
  }

  function paintDelivery() {
    const node = els().delivery;
    if (!node) return;
    node.textContent = deliveryParts("webhook").join(" ");
  }

  function applyWebhook(next, { secret } = {}) {
    webhook = next;
    if (secret) {
      secretDraft = secret;
      secretVisible = true;
      secretDirty = false;
    } else if (!secretDirty) {
      secretDraft = "";
      secretVisible = false;
    }
    const e = els();
    if (e.url && next?.url) e.url.value = next.url;
    if (e.enabled) e.enabled.checked = next ? next.enabled : true;
    paintWebhook();
  }

  function webhookPath(extra = "") {
    return `/shares/${encodeURIComponent(getSlug())}/webhook${extra}`;
  }

  function guardSlug(setMessage = setWebhookMessage) {
    if (getSlug()) return true;
    setMessage(t("leads.needsPublish"), true);
    return false;
  }

  function handleProblem(res, fallbackKey) {
    const problem = webhookProblem(res);
    if (problem === "paywall") {
      els().dialog?.close();
      onPaywall?.();
      return true;
    }
    const key = problem === "auth" ? "leads.webhook.errAuth"
      : problem === "private" ? "leads.webhook.errPrivate"
        : problem === "url" ? "leads.webhook.errUrl"
          : problem === "secret" ? "leads.webhook.errSecret"
            : fallbackKey;
    setWebhookMessage(t(key), true);
    return true;
  }

  async function load() {
    const slug = getSlug();
    const e = els();
    if (!slug) return;
    loading = true;
    e.status.textContent = t("leads.loading");
    paint();
    const res = await cloudFetch(`/shares/${encodeURIComponent(slug)}/leads`, { method: "GET" });
    loading = false;
    if (!res.ok) {
      leads = [];
      e.status.textContent = res.status === 401 ? t("leads.errAuth") : t("leads.errLoad");
      paint();
      return;
    }
    leads = Array.isArray(res.data?.leads) ? res.data.leads : [];
    title = String(res.data?.title || "");
    e.status.textContent = leads.length ? "" : t("leads.empty");
    paint();
  }

  async function loadWebhook() {
    if (!getSlug() || !els().url) return;
    const res = await cloudFetch(webhookPath(), { method: "GET" });
    if (!res.ok && res.status !== 404) {
      handleProblem(res, "leads.webhook.errLoad");
      return;
    }
    const next = res.ok ? normalizeWebhook(res.data) : null;
    secretDirty = false;
    secretDraft = "";
    secretVisible = false;
    webhook = next;
    const e = els();
    if (e.url) e.url.value = next?.url || "";
    if (e.enabled) e.enabled.checked = next ? next.enabled : true;
    paintWebhook();
  }

  async function remove(lead) {
    if (!window.confirm(t("leads.confirmDelete", { who: lead.name || lead.email || formatPhone(lead.phone) || "" }))) return;
    const res = await cloudFetch(`/shares/${encodeURIComponent(getSlug())}/leads/${encodeURIComponent(lead.id)}`, { method: "DELETE" });
    if (!res.ok) {
      toast?.(t("leads.errDelete"), 4200);
      return;
    }
    leads = leads.filter((item) => item.id !== lead.id);
    els().status.textContent = leads.length ? "" : t("leads.empty");
    paint();
    toast?.(t("leads.deleted"), 3000);
  }

  function downloadCsv() {
    if (!leads.length) return;
    const rows = leads.map((lead) => ({ ...lead, createdAt: csvDate(lead.createdAt), consentAt: csvDate(lead.consentAt) }));
    const csv = leadsToCsv(rows, {
      createdAt: t("leads.col.date"),
      source: t("leads.col.source"),
      name: t("fixed.lead.name"),
      email: t("fixed.lead.email"),
      phone: t("leads.col.phone"),
      phoneFormatted: t("leads.col.phoneFormatted"),
      message: t("fixed.contact.message"),
      consent: t("leads.col.consent"),
      consentAt: t("leads.col.consentAt"),
      consentText: t("leads.col.consentText"),
      lang: t("leads.col.lang"),
      yes: t("leads.yes"),
      no: t("leads.no"),
      source_start: t("leads.sourceStart"),
      source_contact: t("leads.sourceContact"),
    });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = csvFileName(getSlug());
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function readForm() {
    const e = els();
    return {
      url: e.url?.value || "",
      enabled: Boolean(e.enabled?.checked),
      secret: secretDraft,
      secretDirty,
      events: webhook?.events,
    };
  }

  async function submitWebhook({ rotateSecret = false } = {}) {
    if (webhookBusy) return;
    const plan = planWebhookSave({ ...readForm(), rotateSecret });
    if (plan.error === "secret") {
      setWebhookMessage(t("leads.webhook.errSecret"), true);
      return;
    }
    if (plan.error) {
      setWebhookMessage(t(plan.error === "private" ? "leads.webhook.errPrivate" : "leads.webhook.errUrl"), true);
      return;
    }
    if (!guardSlug()) return;
    webhookBusy = true;
    paintWebhook();
    setWebhookMessage(t("leads.webhook.saving"));
    const res = await cloudFetch(webhookPath(), { method: "PUT", body: JSON.stringify(plan.body) });
    webhookBusy = false;
    if (!res.ok) {
      paintWebhook();
      handleProblem(res, "leads.webhook.errSave");
      return;
    }
    let next = normalizeWebhook(res.data) || {
      ...(webhook || {}),
      url: plan.body.url,
      enabled: plan.body.enabled,
      events: plan.body.events,
      hasSecret: true,
      lastDelivery: webhook?.lastDelivery || null,
      consecutiveFailures: webhook?.consecutiveFailures || 0,
      autoDisabled: false,
      secretLast4: webhook?.secretLast4 || "",
      status: "",
    };
    let secret = next.secret || "";
    if (rotateSecret && !secret) {
      const revealed = await cloudFetch(webhookPath("?reveal=1"), { method: "GET" });
      const again = normalizeWebhook(revealed.data);
      secret = again?.secret || "";
      if (again) next = { ...next, ...again, secret: "" };
    }
    const shown = secret || (!rotateSecret ? plan.body.secret || "" : "");
    applyWebhook({ ...next, secret: "" }, shown ? { secret: shown } : {});
    setWebhookMessage(t(rotateSecret ? "leads.webhook.rotated" : "leads.webhook.saved"));
    toast?.(t(rotateSecret ? "leads.webhook.rotated" : "leads.webhook.saved"), 3200);
  }

  async function revealSecret() {
    if (secretVisible) {
      secretVisible = false;
      paintWebhook();
      return;
    }
    if (secretDirty && secretDraft) {
      secretVisible = true;
      paintWebhook();
      return;
    }
    if (!guardSlug() || webhookBusy) return;
    webhookBusy = true;
    paintWebhook();
    const res = await cloudFetch(webhookPath("?reveal=1"), { method: "GET" });
    webhookBusy = false;
    const next = normalizeWebhook(res.data);
    if (!res.ok || !next?.secret || !isWebhookSecret(next.secret)) {
      paintWebhook();
      if (res.ok) setWebhookMessage(t("leads.webhook.revealFail"), true);
      else handleProblem(res, "leads.webhook.revealFail");
      return;
    }
    webhook = { ...next, secret: "" };
    secretDraft = next.secret;
    secretVisible = true;
    secretDirty = false;
    paintWebhook();
  }

  async function sendTest() {
    if (!guardSlug() || webhookBusy) return;
    if (!webhook?.url) {
      setWebhookMessage(t("leads.webhook.needsSave"), true);
      return;
    }
    webhookBusy = true;
    paintWebhook();
    setWebhookMessage(t("leads.webhook.sending"));
    const res = await cloudFetch(webhookPath("/test"), { method: "POST", body: "{}" });
    webhookBusy = false;
    paintWebhook();
    if (!res.ok) {
      handleProblem(res, "leads.webhook.errTest");
      return;
    }
    const result = normalizeTestResult(res.data) || { ok: true, httpStatus: res.status, at: "", error: "" };
    if (!result.at) result.at = new Date().toISOString();
    webhook = {
      ...(webhook || {}),
      lastDelivery: result,
      consecutiveFailures: result.ok ? 0 : (webhook?.consecutiveFailures || 0) + 1,
    };
    paintDelivery();
    paintCards();
    const status = result.httpStatus ? String(result.httpStatus) : result.error || "—";
    setWebhookMessage(t(result.ok ? "leads.webhook.testOk" : "leads.webhook.testFail", { status }), !result.ok);
  }

  async function removeWebhook() {
    if (!guardSlug() || !webhook || webhookBusy) return;
    if (!window.confirm(t("leads.webhook.confirmRemove"))) return;
    webhookBusy = true;
    paintWebhook();
    const res = await cloudFetch(webhookPath(), { method: "DELETE" });
    webhookBusy = false;
    if (!res.ok && res.status !== 404) {
      paintWebhook();
      handleProblem(res, "leads.webhook.errRemove");
      return;
    }
    webhook = null;
    secretDraft = "";
    secretVisible = false;
    secretDirty = false;
    const e = els();
    if (e.url) e.url.value = "";
    if (e.enabled) e.enabled.checked = true;
    paintWebhook();
    setWebhookMessage(t("leads.webhook.removed"));
    toast?.(t("leads.webhook.removed"), 3000);
  }

  async function pasteSecret() {
    try {
      const text = String(await navigator.clipboard.readText() || "").trim();
      if (!isWebhookSecret(text)) {
        setWebhookMessage(t("leads.webhook.errSecret"), true);
        return;
      }
      secretDraft = text;
      secretDirty = true;
      secretVisible = true;
      paintWebhook();
      setWebhookMessage(t("leads.webhook.pasted"));
    } catch {
      setWebhookMessage(t("leads.webhook.pasteFail"), true);
      els().secret?.focus();
    }
  }

  async function copySecret() {
    if (!secretDraft) return;
    try {
      await navigator.clipboard.writeText(secretDraft);
      setWebhookMessage(t("leads.webhook.copied"));
      toast?.(t("leads.webhook.copied"), 2400);
    } catch {
      setWebhookMessage(t("leads.webhook.copyFail"), true);
    }
  }

  function setRdMessage(text, error = false) {
    const node = els().rdStatus;
    if (node) {
      node.textContent = text || "";
      node.classList.toggle("is-error", Boolean(error && text));
    }
    setCardStatus("rd", text, error);
  }

  function paintRd() {
    const e = els();
    if (!e.rdKey) return;
    e.rdKey.value = rdKeyDraft;
    e.rdKey.placeholder = rd?.keyLast4 ? `····${rd.keyLast4}` : "";
    if (e.rdHint) {
      e.rdHint.textContent = rd?.keyLast4 && !rdKeyDraft
        ? t("leads.rd.keySaved", { last4: rd.keyLast4 })
        : t("leads.rd.keyHint");
    }
    if (e.rdRemove) e.rdRemove.hidden = !rd?.hasKey;
    if (e.rdHelp) e.rdHelp.href = RD_HELP[getLocale()] || RD_HELP.pt;
    for (const btn of [e.rdSave, e.rdTest, e.rdRemove]) {
      if (btn) btn.disabled = rdBusy;
    }
    paintRdDelivery();
    paintCards();
  }

  function paintRdDelivery() {
    const node = els().rdDelivery;
    if (!node) return;
    node.textContent = deliveryParts("rd").join(" ");
  }

  function rdPath(extra = "") {
    return `/shares/${encodeURIComponent(getSlug())}/rd-station${extra}`;
  }

  function handleRdProblem(res, fallbackKey) {
    const problem = rdProblem(res);
    if (problem === "paywall") {
      els().dialog?.close();
      onPaywall?.();
      return true;
    }
    const key = problem === "auth" ? "leads.rd.errAuth"
      : problem === "key" ? "leads.rd.errKey"
        : fallbackKey;
    setRdMessage(t(key), true);
    return true;
  }

  async function loadRd() {
    if (!getSlug() || !els().rdKey) return;
    const res = await cloudFetch(rdPath(), { method: "GET" });
    if (!res.ok && res.status !== 404) {
      handleRdProblem(res, "leads.rd.errLoad");
      return;
    }
    rd = res.ok ? normalizeRdStation(res.data) : null;
    rdKeyDraft = "";
    const e = els();
    if (e.rdEnabled) e.rdEnabled.checked = rd ? rd.enabled : true;
    setRdMessage("");
    paintRd();
  }

  async function submitRd() {
    if (rdBusy) return;
    const e = els();
    const plan = planRdSave({
      apiKey: rdKeyDraft,
      enabled: Boolean(e.rdEnabled?.checked),
      connected: Boolean(rd?.hasKey),
    });
    if (plan.error) {
      setRdMessage(t(plan.error === "key" ? "leads.rd.errKey" : "leads.rd.errRequired"), true);
      return;
    }
    if (!guardSlug(setRdMessage)) return;
    rdBusy = true;
    paintRd();
    setRdMessage(t("leads.rd.saving"));
    const res = await cloudFetch(rdPath(), { method: "PUT", body: JSON.stringify(plan.body) });
    rdBusy = false;
    if (!res.ok) {
      paintRd();
      handleRdProblem(res, "leads.rd.errSave");
      return;
    }
    const sentTail = plan.body.apiKey ? plan.body.apiKey.slice(-4) : "";
    const next = normalizeRdStation(res.data) || {
      ...(rd || {}),
      enabled: plan.body.enabled,
      hasKey: true,
      keyLast4: sentTail || rd?.keyLast4 || "",
      lastDelivery: rd?.lastDelivery || null,
      consecutiveFailures: rd?.consecutiveFailures || 0,
      autoDisabled: false,
      status: "",
    };
    if (sentTail && !next.keyLast4) next.keyLast4 = sentTail;
    next.hasKey = Boolean(next.keyLast4 || next.hasKey);
    rd = next;
    rdKeyDraft = "";
    if (e.rdEnabled) e.rdEnabled.checked = next.enabled;
    paintRd();
    setRdMessage(t("leads.rd.saved"));
    toast?.(t("leads.rd.saved"), 3200);
  }

  async function sendRdTest() {
    if (!guardSlug(setRdMessage) || rdBusy) return;
    if (!rd?.hasKey) {
      setRdMessage(t("leads.rd.needsSave"), true);
      return;
    }
    rdBusy = true;
    paintRd();
    setRdMessage(t("leads.rd.sending"));
    const res = await cloudFetch(rdPath("/test"), { method: "POST", body: "{}" });
    rdBusy = false;
    paintRd();
    if (!res.ok) {
      handleRdProblem(res, "leads.rd.errTest");
      return;
    }
    const result = normalizeTestResult(res.data) || { ok: true, httpStatus: res.status, at: "", error: "" };
    if (result.error === "owner_not_pro") {
      handleRdProblem({ ok: false, status: 402, error: "owner_not_pro" }, "leads.rd.errTest");
      return;
    }
    if (!result.at) result.at = new Date().toISOString();
    const fromBody = normalizeRdStation(res.data);
    rd = {
      ...(rd || {}),
      ...(fromBody || {}),
      lastDelivery: fromBody?.lastDelivery || result,
      consecutiveFailures: result.ok ? 0 : (rd?.consecutiveFailures || 0) + 1,
    };
    paintRd();
    const status = result.httpStatus ? String(result.httpStatus) : result.error || "—";
    setRdMessage(t(result.ok ? "leads.rd.testOk" : "leads.rd.testFail", { status }), !result.ok);
  }

  async function removeRd() {
    if (!guardSlug(setRdMessage) || !rd?.hasKey || rdBusy) return;
    if (!window.confirm(t("leads.rd.confirmRemove"))) return;
    rdBusy = true;
    paintRd();
    const res = await cloudFetch(rdPath(), { method: "DELETE" });
    rdBusy = false;
    if (!res.ok && res.status !== 404) {
      paintRd();
      handleRdProblem(res, "leads.rd.errRemove");
      return;
    }
    rd = null;
    rdKeyDraft = "";
    const e = els();
    if (e.rdEnabled) e.rdEnabled.checked = true;
    paintRd();
    setRdMessage(t("leads.rd.removed"));
    toast?.(t("leads.rd.removed"), 3000);
  }

  function setHubspotMessage(text, error = false) {
    const node = els().hsStatus;
    if (node) {
      node.textContent = text || "";
      node.classList.toggle("is-error", Boolean(error && text));
    }
    setCardStatus("hubspot", text, error);
  }

  function mappingValues() {
    const map = els().map || {};
    const values = {};
    for (const key of HUBSPOT_FIELDS) values[key] = map[key]?.value || "";
    return values;
  }

  function paintHubspot() {
    const e = els();
    if (!e.hsConnect && !e.hsToken) return;
    for (const key of HUBSPOT_FIELDS) {
      const input = e.map?.[key];
      if (!input || hubspotDirty.has(key)) continue;
      input.value = hubspot?.mapping?.[key] ?? "";
    }
    const mode = hubspotConnectMode({
      oauthAvailable: hubspotOauth,
      method: hubspot?.method || "",
      tokenOpen: hubspotTokenOpen,
    });
    if (e.hsConnect) {
      e.hsConnect.hidden = !mode.showConnect;
      e.hsConnect.textContent = t(hubspot?.connected && hubspot?.method === "oauth" ? "leads.hubspot.reconnect" : "leads.hubspot.connect");
      e.hsConnect.classList.toggle("btn-primary", mode.showConnect && !mode.showToken);
    }
    if (e.hsUseToken) {
      e.hsUseToken.hidden = !mode.showTokenChoice;
      e.hsUseToken.textContent = t("leads.hubspot.useToken");
    }
    if (e.hsTokenBlock) e.hsTokenBlock.hidden = !mode.showToken;
    if (e.hsSave) e.hsSave.classList.toggle("btn-primary", !mode.showConnect || mode.showToken);
    if (e.hsRemove) e.hsRemove.hidden = !hubspot?.connected;
    if (e.hsHelp) e.hsHelp.href = HUBSPOT_HELP[getLocale()] || HUBSPOT_HELP.pt;
    for (const btn of [e.hsConnect, e.hsUseToken, e.hsSave, e.hsTest, e.hsRemove]) {
      if (btn) btn.disabled = hubspotBusy;
    }
    paintHubspotAccount();
    paintHubspotDelivery();
    paintCards();
  }

  function paintHubspotAccount() {
    const node = els().hsAccount;
    if (!node) return;
    if (!hubspot?.connected) {
      node.textContent = t("leads.hubspot.disconnected");
      return;
    }
    const parts = [];
    if (hubspot.method === "oauth") parts.push(t("leads.hubspot.methodOAuth"));
    else if (hubspot.tokenLast4 || hubspot.method === "private_app") {
      parts.push(t("leads.hubspot.token", { last4: hubspot.tokenLast4 || "····" }));
    } else parts.push(t("leads.hubspot.connected"));
    if (hubspot.account) parts.push(t("leads.hubspot.account", { account: hubspot.account }));
    if (hubspot.scopes?.length) parts.push(t("leads.hubspot.scopes", { scopes: hubspot.scopes.join(", ") }));
    node.textContent = parts.join(" ");
  }

  function paintHubspotDelivery() {
    const node = els().hsDelivery;
    if (!node) return;
    node.textContent = deliveryParts("hubspot").join(" ");
  }

  function hubspotPath(extra = "") {
    return `/shares/${encodeURIComponent(getSlug())}/hubspot${extra}`;
  }

  function showHubspotReturn() {
    if (!hubspotReturn) return;
    const notice = hubspotReturn;
    hubspotReturn = null;
    setHubspotMessage(t(notice.key, notice.vars), notice.error);
  }

  function handleHubspotProblem(res, fallbackKey) {
    const problem = hubspotProblem(res);
    if (problem === "paywall") {
      els().dialog?.close();
      onPaywall?.();
      return true;
    }
    const key = problem === "auth" ? "leads.hubspot.errAuth"
      : problem === "config" ? "leads.hubspot.errConfig"
        : problem === "token" ? "leads.hubspot.errToken"
          : fallbackKey;
    setHubspotMessage(t(key), true);
    return true;
  }

  function clearHubspotToken() {
    const input = els().hsToken;
    if (input) input.value = "";
  }

  async function loadHubspot() {
    if (!getSlug() || (!els().hsConnect && !els().hsToken)) return;
    const res = await cloudFetch(hubspotPath(), { method: "GET" });
    if (!res.ok && res.status !== 404) {
      if (!hubspotReturn) handleHubspotProblem(res, "leads.hubspot.errLoad");
      else showHubspotReturn();
      return;
    }
    const view = readHubspotView(res.data);
    hubspot = res.ok ? view.hubspot : null;
    hubspotOauth = view.oauthAvailable;
    hubspotDirty = new Set();
    clearHubspotToken();
    const enabled = els().hsEnabled;
    if (enabled) enabled.checked = hubspot ? hubspot.enabled : true;
    paintHubspot();
    if (hubspotReturn) showHubspotReturn();
    else setHubspotMessage("");
  }

  async function connectHubspot() {
    if (!guardSlug(setHubspotMessage) || hubspotBusy) return;
    hubspotBusy = true;
    paintHubspot();
    setHubspotMessage(t("leads.hubspot.opening"));
    const res = await cloudFetch(hubspotPath("/authorize"), { method: "GET" });
    const url = res.ok ? authorizeUrlOf(res.data) : "";
    hubspotBusy = false;
    paintHubspot();
    if (!res.ok || !url) {
      if (!res.ok) handleHubspotProblem(res, "leads.hubspot.errConnect");
      else setHubspotMessage(t("leads.hubspot.errConnect"), true);
      return;
    }
    const popup = window.open(url, "_blank");
    try {
      if (popup) popup.opener = null;
    } catch {
      /* o navegador já isolou a janela */
    }
    if (!popup) location.assign(url);
  }

  async function submitHubspot() {
    if (hubspotBusy) return;
    if (!guardSlug(setHubspotMessage)) return;
    const typed = String(els().hsToken?.value || "");
    const plan = planHubspotSave({
      enabled: Boolean(els().hsEnabled?.checked),
      values: mappingValues(),
      baseMapping: hubspot?.mapping,
      dirtyKeys: hubspotDirty,
      token: typed,
      requireToken: !hubspot?.connected && hubspotOauth !== true,
    });
    if (plan.error) {
      setHubspotMessage(t(plan.error === "token" ? "leads.hubspot.errToken" : "leads.hubspot.errTokenRequired"), true);
      return;
    }
    const sentLast4 = plan.body.token ? plan.body.token.slice(-4) : "";
    hubspotBusy = true;
    paintHubspot();
    setHubspotMessage(t("leads.hubspot.saving"));
    const res = await cloudFetch(hubspotPath(), { method: "PUT", body: JSON.stringify(plan.body) });
    hubspotBusy = false;
    if (!res.ok) {
      paintHubspot();
      handleHubspotProblem(res, "leads.hubspot.errSave");
      return;
    }
    const view = readHubspotView(res.data);
    if (view.oauthAvailable || Object.prototype.hasOwnProperty.call(res.data || {}, "oauthAvailable")
      || (res.data?.hubspot && Object.prototype.hasOwnProperty.call(res.data.hubspot, "oauthAvailable"))) {
      hubspotOauth = view.oauthAvailable;
    }
    const next = view.hubspot || {
      ...(hubspot || {}),
      connected: Boolean(hubspot?.connected),
      enabled: plan.body.enabled,
      mapping: plan.body.mapping ? { ...(hubspot?.mapping || {}), ...plan.body.mapping } : hubspot?.mapping || null,
      autoDisabled: false,
    };
    if (sentLast4) {
      next.method = next.method || "private_app";
      next.connected = true;
      if (!next.tokenLast4) next.tokenLast4 = sentLast4;
    }
    hubspot = next;
    hubspotDirty = new Set();
    if (sentLast4) hubspotTokenOpen = true;
    clearHubspotToken();
    const enabled = els().hsEnabled;
    if (enabled) enabled.checked = next.enabled;
    paintHubspot();
    setHubspotMessage(t("leads.hubspot.saved"));
    toast?.(t("leads.hubspot.saved"), 3200);
  }

  async function sendHubspotTest() {
    if (!guardSlug(setHubspotMessage) || hubspotBusy) return;
    if (!hubspot?.connected) {
      setHubspotMessage(t("leads.hubspot.needsConnect"), true);
      return;
    }
    hubspotBusy = true;
    paintHubspot();
    setHubspotMessage(t("leads.hubspot.sending"));
    const res = await cloudFetch(hubspotPath("/test"), { method: "POST", body: "{}" });
    hubspotBusy = false;
    paintHubspot();
    if (!res.ok) {
      handleHubspotProblem(res, "leads.hubspot.errTest");
      return;
    }
    const result = normalizeHubspotTest(res.data) || { ok: true, httpStatus: res.status, at: "", error: "" };
    if (result.error === "owner_not_pro") {
      handleHubspotProblem({ ok: false, status: 402, error: "owner_not_pro" }, "leads.hubspot.errTest");
      return;
    }
    if (!result.at) result.at = new Date().toISOString();
    const fromBody = normalizeHubspot(res.data);
    const deliveries = [result, ...((fromBody?.deliveries || hubspot?.deliveries || []).filter((item) => item !== result))].slice(0, 8);
    hubspot = {
      ...(hubspot || {}),
      ...(fromBody || {}),
      deliveries,
      lastDelivery: result,
      consecutiveFailures: result.ok ? 0 : (hubspot?.consecutiveFailures || 0) + 1,
    };
    paintHubspot();
    const status = result.httpStatus ? String(result.httpStatus) : result.error || "—";
    setHubspotMessage(t(result.ok ? "leads.hubspot.testOk" : "leads.hubspot.testFail", { status }), !result.ok);
  }

  async function removeHubspot() {
    if (!guardSlug(setHubspotMessage) || !hubspot?.connected || hubspotBusy) return;
    if (!window.confirm(t("leads.hubspot.confirmRemove"))) return;
    hubspotBusy = true;
    paintHubspot();
    const res = await cloudFetch(hubspotPath(), { method: "DELETE" });
    hubspotBusy = false;
    if (!res.ok && res.status !== 404) {
      paintHubspot();
      handleHubspotProblem(res, "leads.hubspot.errRemove");
      return;
    }
    hubspot = null;
    hubspotDirty = new Set();
    hubspotTokenOpen = false;
    clearHubspotToken();
    paintHubspot();
    setHubspotMessage(t("leads.hubspot.removed"));
    toast?.(t("leads.hubspot.removed"), 3000);
  }

  function setLpMessage(text, error = false) {
    const node = els().lpStatus;
    if (node) {
      node.textContent = text || "";
      node.classList.toggle("is-error", Boolean(error && text));
    }
    setCardStatus("lp", text, error);
  }

  function lpLinked() {
    return lp?.status === "connected" || lp?.status === "disabled";
  }

  function tourOptions() {
    const map = new Map();
    for (const item of lpShares) map.set(item.slug, item.title || item.slug);
    const current = String(getSlug() || "").trim().toLowerCase();
    if (current && !map.has(current)) map.set(current, current);
    if (Array.isArray(lp?.tours)) {
      for (const slug of lp.tours) if (!map.has(slug)) map.set(slug, slug);
    }
    return [...map.entries()].map(([slug, title]) => ({ slug, title }));
  }

  function paintLpTours() {
    const node = els().lpTours;
    if (!node) return;
    const show = lpLinked() && !lpAll;
    node.hidden = !show;
    node.replaceChildren();
    if (!show) return;
    for (const tour of tourOptions()) {
      const label = el("label", "fixed-check");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = tour.slug;
      input.checked = lpTourPick.has(tour.slug);
      const span = el("span", "", tour.title && tour.title !== tour.slug ? `${tour.title} (${tour.slug})` : tour.slug);
      label.append(input, span);
      node.append(label);
    }
  }

  function paintLpAccount() {
    const node = els().lpAccount;
    if (!node) return;
    if (!lp) {
      node.textContent = "";
      return;
    }
    if (lp.status === "config_missing") {
      node.textContent = t("leads.lp.configMissing");
      return;
    }
    if (lp.status === "disconnected") {
      node.textContent = lpReady ? t("leads.lp.disconnected") : "";
      return;
    }
    if (lpLinked()) {
      const who = lp.tenant ? t("leads.lp.connected", { tenant: lp.tenant }) : t("leads.lp.connectedPlain");
      node.textContent = lp.status === "disabled" ? `${who}. ${t("leads.lp.disabled")}` : who;
      return;
    }
    node.textContent = "";
  }

  function paintLpDelivery() {
    const node = els().lpDelivery;
    if (!node) return;
    node.textContent = deliveryParts("lp").join(" ");
  }

  function paintLp() {
    const e = els();
    if (!e.lpConnect) return;
    const linked = lpLinked();
    const missing = lp?.status === "config_missing";
    e.lpConnect.hidden = linked;
    e.lpConnect.disabled = lpBusy || !lpReady || missing;
    if (e.lpSave) e.lpSave.hidden = !linked;
    if (e.lpRemove) e.lpRemove.hidden = !linked;
    if (e.lpControls) e.lpControls.hidden = !linked;
    if (e.lpEnabled) {
      e.lpEnabled.checked = lpEnabled;
      e.lpEnabled.disabled = lpBusy;
    }
    if (e.lpAll) {
      e.lpAll.checked = lpAll;
      e.lpAll.disabled = lpBusy;
    }
    if (e.lpHelp) e.lpHelp.href = LP_HELP[getLocale()] || LP_HELP.pt;
    for (const btn of [e.lpSave, e.lpRemove]) {
      if (btn) btn.disabled = lpBusy;
    }
    if (e.lpHint) e.lpHint.hidden = !lpAll || !lpLinked();
    paintLpTours();
    paintLpAccount();
    paintLpDelivery();
    paintCards();
  }

  function handleLpProblem(res, fallbackKey) {
    const problem = leadProntoProblem(res);
    if (problem === "paywall") {
      els().dialog?.close();
      onPaywall?.();
      return true;
    }
    if (problem === "config") {
      lp = {
        status: "config_missing",
        tenant: "",
        enabled: false,
        tours: null,
        consecutiveFailures: 0,
        autoDisabled: false,
        deliveries: [],
      };
      lpReady = true;
      paintLp();
      setLpMessage(t("leads.lp.configMissing"), true);
      return true;
    }
    const key = problem === "auth" ? "leads.lp.errAuth"
      : problem === "tours" ? "leads.lp.errTours"
        : fallbackKey;
    setLpMessage(t(key), true);
    return true;
  }

  function showReturnNotice(notice) {
    if (!notice) return;
    if (notice.kind === "connected") setLpMessage(t("leads.lp.connectedToast"));
    else setLpMessage(t(leadProntoReturnKey(notice.reason)), true);
    els().lpStatus?.scrollIntoView?.({ block: "nearest" });
  }

  function applyLp(next) {
    lp = next;
    lpReady = true;
    lpAll = !next || next.tours == null;
    lpTourPick = new Set(Array.isArray(next?.tours) ? next.tours : []);
    lpEnabled = Boolean(next?.enabled);
    paintLp();
  }

  async function loadLeadPronto() {
    const e = els();
    if (!e.lpConnect) return;
    const notice = returnNotice;
    const [res, mine] = await Promise.all([
      cloudFetch("/integrations/leadpronto", { method: "GET", headers: { Accept: "application/json" } }),
      cloudFetch("/shares/mine", { method: "GET" }),
    ]);
    if (mine.ok) lpShares = normalizeShareList(mine.data);
    if (res.stub) {
      applyLp({
        status: "disconnected",
        tenant: "",
        enabled: false,
        tours: null,
        consecutiveFailures: 0,
        autoDisabled: false,
        deliveries: [],
      });
      showReturnNotice(notice);
      returnNotice = null;
      return;
    }
    if (!res.ok) {
      lpReady = true;
      paintLp();
      handleLpProblem(res, "leads.lp.errLoad");
      showReturnNotice(notice);
      returnNotice = null;
      return;
    }
    const next = normalizeLeadPronto(res.data);
    if (!next) {
      lpReady = true;
      paintLp();
      setLpMessage(t("leads.lp.errLoad"), true);
      showReturnNotice(notice);
      returnNotice = null;
      return;
    }
    applyLp(next);
    setLpMessage("");
    showReturnNotice(notice);
    returnNotice = null;
  }

  async function connectLeadPronto() {
    if (lpBusy || !lpReady || lp?.status === "config_missing") return;
    lpBusy = true;
    paintLp();
    setLpMessage(t("leads.lp.opening"));
    const res = await cloudFetch("/integrations/leadpronto/start", {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "manual",
    });
    const url = readAuthorizeUrl(res.data);
    if (!res.ok || !url) {
      lpBusy = false;
      paintLp();
      if (!handleLpProblem(res, "leads.lp.errConnect")) setLpMessage(t("leads.lp.errConnect"), true);
      return;
    }
    window.location.assign(url);
  }

  async function submitLp() {
    if (lpBusy || !lpLinked()) return;
    const plan = planLeadProntoSave({
      enabled: lpEnabled,
      allTours: lpAll,
      tours: [...lpTourPick],
    });
    if (plan.error) {
      setLpMessage(t("leads.lp.errTours"), true);
      return;
    }
    lpBusy = true;
    paintLp();
    setLpMessage(t("leads.lp.saving"));
    const res = await cloudFetch("/integrations/leadpronto", { method: "PUT", body: JSON.stringify(plan.body) });
    lpBusy = false;
    if (!res.ok) {
      paintLp();
      handleLpProblem(res, "leads.lp.errSave");
      return;
    }
    const next = normalizeLeadPronto(res.data);
    if (next) applyLp(next);
    else await loadLeadPronto();
    if (!els().lpStatus?.classList.contains("is-error")) setLpMessage(t("leads.lp.saved"));
    toast?.(t("leads.lp.saved"), 3200);
  }

  async function removeLp() {
    if (lpBusy || !lpLinked()) return;
    if (!window.confirm(t("leads.lp.confirmRemove"))) return;
    lpBusy = true;
    paintLp();
    const res = await cloudFetch("/integrations/leadpronto", { method: "DELETE" });
    lpBusy = false;
    if (!res.ok && res.status !== 404) {
      paintLp();
      handleLpProblem(res, "leads.lp.errRemove");
      return;
    }
    applyLp({
      status: "disconnected",
      tenant: "",
      enabled: false,
      tours: null,
      consecutiveFailures: 0,
      autoDisabled: false,
      deliveries: [],
    });
    setLpMessage(t("leads.lp.removed"));
    toast?.(t("leads.lp.removed"), 3000);
  }

  function noteLeadProntoReturn(found) {
    if (found?.kind === "connected" || found?.kind === "error") returnNotice = found;
  }

  function bind() {
    if (bound) return;
    bound = true;
    const e = els();
    e.close?.addEventListener("click", () => e.dialog.close());
    e.refresh?.addEventListener("click", () => {
      void load();
      void loadWebhook();
      void loadRd();
      void loadHubspot();
      void loadLeadPronto();
    });
    e.csv?.addEventListener("click", downloadCsv);
    e.secret?.addEventListener("input", () => {
      secretDraft = e.secret.value.trim();
      secretDirty = true;
      if (e.copy) e.copy.hidden = !secretDraft;
    });
    $("btn-leads-webhook-generate")?.addEventListener("click", () => {
      secretDraft = generateWebhookSecret();
      secretDirty = true;
      secretVisible = true;
      paintWebhook();
      setWebhookMessage(t("leads.webhook.generated"));
    });
    $("btn-leads-webhook-paste")?.addEventListener("click", () => void pasteSecret());
    e.reveal?.addEventListener("click", () => void revealSecret());
    e.rotate?.addEventListener("click", () => {
      if (!window.confirm(t("leads.webhook.confirmRotate"))) return;
      void submitWebhook({ rotateSecret: true });
    });
    e.copy?.addEventListener("click", () => void copySecret());
    e.save?.addEventListener("click", () => void submitWebhook());
    e.test?.addEventListener("click", () => void sendTest());
    e.remove?.addEventListener("click", () => void removeWebhook());
    e.rdKey?.addEventListener("input", () => {
      rdKeyDraft = e.rdKey.value.trim();
      if (e.rdHint && rd?.keyLast4) {
        e.rdHint.textContent = rdKeyDraft ? t("leads.rd.keyHint") : t("leads.rd.keySaved", { last4: rd.keyLast4 });
      }
    });
    e.rdSave?.addEventListener("click", () => void submitRd());
    e.rdTest?.addEventListener("click", () => void sendRdTest());
    e.rdRemove?.addEventListener("click", () => void removeRd());
    e.hsConnect?.addEventListener("click", () => void connectHubspot());
    e.hsUseToken?.addEventListener("click", () => {
      hubspotTokenOpen = true;
      paintHubspot();
      els().hsToken?.focus?.();
    });
    e.hsSave?.addEventListener("click", () => void submitHubspot());
    e.hsTest?.addEventListener("click", () => void sendHubspotTest());
    e.hsRemove?.addEventListener("click", () => void removeHubspot());
    e.lpConnect?.addEventListener("click", () => void connectLeadPronto());
    e.lpSave?.addEventListener("click", () => void submitLp());
    e.lpRemove?.addEventListener("click", () => void removeLp());
    e.lpEnabled?.addEventListener("change", () => {
      lpEnabled = Boolean(e.lpEnabled.checked);
    });
    e.lpAll?.addEventListener("change", () => {
      lpAll = Boolean(e.lpAll.checked);
      if (!lpAll && lpTourPick.size === 0) {
        const current = String(getSlug() || "").trim().toLowerCase();
        if (current) lpTourPick.add(current);
      }
      paintLp();
    });
    e.lpTours?.addEventListener("change", (ev) => {
      const input = ev.target;
      if (!(input instanceof HTMLInputElement) || input.type !== "checkbox") return;
      if (input.checked) lpTourPick.add(input.value);
      else lpTourPick.delete(input.value);
    });
    for (const key of HUBSPOT_FIELDS) {
      e.map?.[key]?.addEventListener("input", () => hubspotDirty.add(key));
    }
    for (const id of DELIVERY_ORDER) {
      $(`btn-delivery-open-${id}`)?.addEventListener("click", () => showDeliveryDetail(id));
    }
    e.deliveryBack?.addEventListener("click", backToDeliveryList);
    const cardTests = { webhook: sendTest, rd: sendRdTest, hubspot: sendHubspotTest };
    for (const id of DELIVERY_TESTABLE) {
      $(`btn-delivery-test-${id}`)?.addEventListener("click", () => void cardTests[id]());
    }
    window.addEventListener("ns-locale-change", () => {
      paintWebhook();
      paintRd();
      paintHubspot();
      paintLp();
    });
  }

  function open() {
    const e = els();
    if (!e.dialog) return false;
    bind();
    if (!getSlug()) {
      toast?.(t("leads.needsPublish"), 4200);
      return false;
    }
    leads = [];
    title = "";
    webhook = null;
    secretDraft = "";
    secretVisible = false;
    secretDirty = false;
    rd = null;
    rdKeyDraft = "";
    hubspot = null;
    hubspotDirty = new Set();
    hubspotOauth = false;
    hubspotTokenOpen = false;
    clearHubspotToken();
    lp = null;
    lpShares = [];
    lpAll = true;
    lpEnabled = false;
    lpTourPick = new Set();
    lpBusy = false;
    lpReady = false;
    e.status.textContent = "";
    if (e.url) e.url.value = "";
    if (e.enabled) e.enabled.checked = true;
    if (e.rdEnabled) e.rdEnabled.checked = true;
    if (e.hsEnabled) e.hsEnabled.checked = true;
    setWebhookMessage("");
    setRdMessage("");
    setHubspotMessage("");
    setLpMessage("");
    deliveryView = "list";
    deliveryDetailId = "";
    paintDeliveryView();
    paintWebhook();
    paintRd();
    paintHubspot();
    paintLp();
    if (!e.dialog.open) e.dialog.showModal();
    void load();
    void loadWebhook();
    void loadRd();
    void loadHubspot();
    void loadLeadPronto();
    return true;
  }

  function noteHubspotReturn(notice) {
    hubspotReturn = notice || null;
  }

  bind();
  return { open, noteHubspotReturn, noteLeadProntoReturn };
}
