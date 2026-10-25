/**
 * Contatos recebidos no link permanente (passo inicial + formulário do passo final)
 * e o webhook que os envia para fora (Pro).
 * Só o dono vê (GET /shares/:slug/leads e /webhook com Bearer); CSV no navegador.
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

  function guardSlug() {
    if (getSlug()) return true;
    setWebhookMessage(t("leads.needsPublish"), true);
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
    const result = normalizeTestResult(res.data) || { ok: true, httpStatus: res.status, at: new Date().toISOString(), error: "" };
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

  function bind() {
    if (bound) return;
    bound = true;
    const e = els();
    e.close?.addEventListener("click", () => e.dialog.close());
    e.refresh?.addEventListener("click", () => {
      void load();
      void loadWebhook();
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
    window.addEventListener("ns-locale-change", () => paintWebhook());
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
    e.status.textContent = "";
    if (e.url) e.url.value = "";
    if (e.enabled) e.enabled.checked = true;
    setWebhookMessage("");
    paintWebhook();
    if (!e.dialog.open) e.dialog.showModal();
    void load();
    void loadWebhook();
  }

  bind();
  return { open };
}
