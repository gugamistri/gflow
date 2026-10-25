/**
 * Contatos recebidos no link permanente (passo inicial + formulário do passo final),
 * o webhook, o RD Station Marketing e o LeadPronto que os enviam para fora (Pro).
 * O webhook e o RD são do link. O LeadPronto é da conta
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
  let lp = null;
  let lpShares = [];
  let lpAll = true;
  let lpEnabled = false;
  let lpTourPick = new Set();
  let lpBusy = false;
  let lpReady = false;
  let returnNotice = null;

  const els = () => ({
    dialog: $("modal-leads"),
    meta: $("leads-meta"),
    status: $("leads-status"),
    list: $("leads-list"),
    csv: $("btn-leads-csv"),
    refresh: $("btn-leads-refresh"),
    close: $("btn-leads-close"),
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
  });

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
    if (!node) return;
    node.textContent = text || "";
    node.classList.toggle("is-error", Boolean(error && text));
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
  }

  function paintDelivery() {
    const node = els().delivery;
    if (!node) return;
    if (!webhook) {
      node.textContent = "";
      return;
    }
    const parts = [];
    const delivery = webhook.lastDelivery;
    if (!delivery) parts.push(t("leads.webhook.none"));
    else {
      const status = delivery.httpStatus ? String(delivery.httpStatus) : delivery.error || "—";
      const date = delivery.at ? formatDate(delivery.at) : "—";
      parts.push(t(delivery.ok ? "leads.webhook.lastOk" : "leads.webhook.lastFail", { date, status }));
    }
    if (webhook.consecutiveFailures > 0) parts.push(t("leads.webhook.failures", { n: webhook.consecutiveFailures }));
    if (webhook.autoDisabled) parts.push(t("leads.webhook.autoOff"));
    node.textContent = parts.join(" ");
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
    if (!node) return;
    node.textContent = text || "";
    node.classList.toggle("is-error", Boolean(error && text));
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
  }

  function paintRdDelivery() {
    const node = els().rdDelivery;
    if (!node) return;
    if (!rd) {
      node.textContent = "";
      return;
    }
    const parts = [];
    const delivery = rd.lastDelivery;
    if (delivery) {
      const status = delivery.httpStatus ? String(delivery.httpStatus) : delivery.error || "—";
      const date = delivery.at ? formatDate(delivery.at) : "—";
      parts.push(t(delivery.ok ? "leads.rd.lastOk" : "leads.rd.lastFail", { date, status }));
    }
    if (rd.consecutiveFailures > 0) parts.push(t("leads.rd.failures", { n: rd.consecutiveFailures }));
    if (rd.autoDisabled) parts.push(t("leads.rd.autoOff"));
    node.textContent = parts.join(" ");
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

  function setLpMessage(text, error = false) {
    const node = els().lpStatus;
    if (!node) return;
    node.textContent = text || "";
    node.classList.toggle("is-error", Boolean(error && text));
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
    if (!lpLinked()) {
      node.textContent = "";
      return;
    }
    const parts = [];
    const rows = Array.isArray(lp.deliveries) ? lp.deliveries : [];
    if (!rows.length) parts.push(t("leads.lp.none"));
    for (const delivery of rows) {
      const status = delivery.httpStatus ? String(delivery.httpStatus) : delivery.error || "—";
      const date = delivery.at ? formatDate(delivery.at) : "—";
      parts.push(t(delivery.ok ? "leads.lp.lastOk" : "leads.lp.lastFail", { date, status }));
    }
    if (lp.consecutiveFailures > 0) parts.push(t("leads.lp.failures", { n: lp.consecutiveFailures }));
    if (lp.autoDisabled) parts.push(t("leads.lp.autoOff"));
    node.textContent = parts.join(" ");
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

  function noteReturn(found) {
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
    window.addEventListener("ns-locale-change", () => {
      paintWebhook();
      paintRd();
      paintLp();
    });
  }

  function open() {
    const e = els();
    if (!e.dialog) return;
    bind();
    if (!getSlug()) {
      toast?.(t("leads.needsPublish"), 4200);
      return;
    }
    leads = [];
    title = "";
    webhook = null;
    secretDraft = "";
    secretVisible = false;
    secretDirty = false;
    rd = null;
    rdKeyDraft = "";
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
    setWebhookMessage("");
    setRdMessage("");
    setLpMessage("");
    paintWebhook();
    paintRd();
    paintLp();
    if (!e.dialog.open) e.dialog.showModal();
    void load();
    void loadWebhook();
    void loadRd();
    void loadLeadPronto();
  }

  bind();
  return { open, noteReturn };
}
