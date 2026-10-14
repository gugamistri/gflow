/**
 * Diálogo "Análise do tour" (Pro 👑): lê GET /shares/:slug/analytics e desenha
import { langLabel } from "./tour-schema/i18n.js";
 * cartões, gráfico SVG (sem dependência), "Onde as pessoas param" e "De onde vieram".
 * why: contagem sem cookies e sem dados pessoais; os passos fixos (início/fim) não entram no drop-off.
 */
import { t, getLocale } from "./i18n.js";
import { cloudFetch } from "./cloudConfig.js";

export const ANALYTICS_TZ = "America/Sao_Paulo";
export const RANGE_PRESETS = [7, 30, 90, 365];

const $ = (id) => document.getElementById(id);

export function dayInTz(date = new Date(), tz = ANALYTICS_TZ) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Últimos N dias (incluindo hoje) no fuso de São Paulo. */
export function rangeForPreset(days, now = new Date()) {
  const n = RANGE_PRESETS.includes(Number(days)) ? Number(days) : 30;
  const to = dayInTz(now);
  return { from: addDays(to, -(n - 1)), to, days: n };
}

export function formatDuration(ms) {
  const total = Math.max(0, Math.round(Number(ms || 0) / 1000));
  if (!total) return "—";
  if (total < 60) return `${total} s`;
  const min = Math.floor(total / 60);
  const sec = total % 60;
  if (min < 60) return `${min} min ${String(sec).padStart(2, "0")} s`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;
}

export function percent(rate) {
  const value = Number(rate || 0);
  if (!Number.isFinite(value) || value <= 0) return "0%";
  return `${Math.round(value * 100)}%`;
}

export function formatCount(n, locale = "pt-BR") {
  return new Intl.NumberFormat(locale).format(Number(n || 0));
}

/** Rótulo da origem: chaves do servidor → texto do diálogo. */
export function sourceLabel(key, tr = t) {
  const k = String(key || "");
  if (k.startsWith("utm:")) return `UTM: ${k.slice(4)}`;
  if (k.startsWith("host:")) return k.slice(5);
  const known = ["embed", "whatsapp", "linkedin", "slack", "notion", "google", "social", "direct"];
  return known.includes(k) ? tr(`analytics.source.${k}`) : k;
}

/** Caminhos SVG das linhas de views e conclusões (viewBox width×height). */
export function chartPaths(series = [], { width = 560, height = 120, pad = 6 } = {}) {
  const list = Array.isArray(series) ? series : [];
  const max = Math.max(1, ...list.map((p) => Number(p.views) || 0));
  const n = list.length;
  const x = (i) => (n <= 1 ? width / 2 : pad + (i * (width - pad * 2)) / (n - 1));
  const y = (v) => height - pad - ((Number(v) || 0) / max) * (height - pad * 2);
  const line = (key) => list.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p[key]).toFixed(1)}`).join(" ");
  return { views: line("views"), completions: line("completions"), max };
}

/** Linhas da tabela de passos, com a fração de saída (para a barra). */
export function stepRows(steps = [], views = 0) {
  return (Array.isArray(steps) ? steps : [])
    .filter((s) => !s.removed || s.reached > 0)
    .map((s) => ({
      ...s,
      dropShare: views > 0 ? Math.min(1, (Number(s.dropOff) || 0) / views) : 0,
      reachShare: views > 0 ? Math.min(1, (Number(s.reached) || 0) / views) : 0,
    }));
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

const SVG_NS = "http://www.w3.org/2000/svg";
function svg(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function locale() {
  return { pt: "pt-BR", es: "es", en: "en" }[getLocale?.() || "pt"] || "pt-BR";
}

export function createAnalyticsDialog({ getSlug, getTitle, toast, onPaywall } = {}) {
  let days = 30;
  let bound = false;
  let ticket = 0;

  const els = () => ({
    dialog: $("modal-analytics"),
    title: $("analytics-tour"),
    status: $("analytics-status"),
    body: $("analytics-body"),
    empty: $("analytics-empty"),
    cards: $("analytics-cards"),
    split: $("analytics-split"),
    chart: $("analytics-chart"),
    steps: $("analytics-steps"),
    sources: $("analytics-sources"),
    range: $("analytics-range"),
    close: $("btn-analytics-close"),
  });

  function card(label, value, sub) {
    const box = el("div", "analytics-card");
    box.append(el("span", "analytics-card-label", label));
    box.append(el("strong", "analytics-card-value", value));
    if (sub) box.append(el("span", "analytics-card-sub", sub));
    return box;
  }

  function paintChart(series) {
    const e = els();
    e.chart.replaceChildren();
    const width = 560;
    const height = 120;
    const paths = chartPaths(series, { width, height });
    const root = svg("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", preserveAspectRatio: "none", class: "analytics-svg" });
    root.setAttribute("aria-label", t("analytics.chartAria", { max: paths.max }));
    root.append(svg("line", { x1: 0, y1: height - 6, x2: width, y2: height - 6, class: "analytics-axis" }));
    root.append(svg("path", { d: paths.views, class: "analytics-line-views", fill: "none" }));
    root.append(svg("path", { d: paths.completions, class: "analytics-line-done", fill: "none" }));
    e.chart.append(root);
    const legend = el("div", "analytics-legend");
    legend.append(el("span", "analytics-legend-views", t("analytics.views")));
    legend.append(el("span", "analytics-legend-done", t("analytics.completions")));
    if (series.length) {
      const fmt = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString(locale(), { day: "2-digit", month: "short", timeZone: "UTC" });
      legend.append(el("span", "analytics-legend-range", `${fmt(series[0].date)} – ${fmt(series[series.length - 1].date)}`));
    }
    e.chart.append(legend);
  }

  function paintSteps(data) {
    const e = els();
    e.steps.replaceChildren();
    const head = el("div", "analytics-step analytics-step-head");
    for (const key of ["analytics.colStep", "analytics.colReached", "analytics.colDrop", "analytics.colTime"]) head.append(el("span", "", t(key)));
    e.steps.append(head);
    for (const row of stepRows(data.steps, data.totals.views)) {
      const line = el("div", `analytics-step${row.removed ? " is-removed" : ""}`);
      line.setAttribute("role", "row");
      const name = el("span", "analytics-step-name");
      name.append(el("b", "", row.removed ? "–" : String(row.index + 1)));
      name.append(el("span", "", row.removed ? t("analytics.removedStep") : row.title || t("analytics.untitledStep")));
      line.append(name);
      line.append(el("span", "analytics-num", formatCount(row.reached, locale())));
      const drop = el("span", "analytics-drop");
      const bar = el("i", "analytics-drop-bar");
      bar.style.width = row.dropOff > 0 ? `max(3px, ${Math.round(row.dropShare * 100)}%)` : "0";
      drop.append(bar, el("span", "analytics-num", formatCount(row.dropOff, locale())));
      line.append(drop);
      line.append(el("span", "analytics-num", formatDuration(row.medianDwellMs)));
      e.steps.append(line);
    }
  }

  function paintSources(data) {
    const e = els();
    e.sources.replaceChildren();
    const total = Math.max(1, data.totals.views);
    for (const src of data.sources.slice(0, 8)) {
      const row = el("div", "analytics-source");
      row.append(el("span", "analytics-source-name", sourceLabel(src.key)));
      const bar = el("span", "analytics-source-bar");
      const fill = el("i", "");
      fill.style.width = `${Math.round((src.views / total) * 100)}%`;
      bar.append(fill);
      row.append(bar, el("span", "analytics-num", formatCount(src.views, locale())));
      e.sources.append(row);
    }
  }

  /** RF29: views/conclusão por idioma do texto + combinações áudio×texto e trocas. */
  function paintLangs(data) {
    const wrap = $("analytics-langs-wrap");
    const host = $("analytics-langs");
    const note = $("analytics-langs-note");
    if (!wrap || !host) return;
    const langs = data.langs || {};
    const list = langs.byText || [];
    wrap.hidden = !list.length;
    host.replaceChildren();
    if (!list.length) return;
    const total = Math.max(1, list.reduce((n, r) => n + r.views, 0));
    for (const r of list.slice(0, 10)) {
      const row = el("div", "analytics-source");
      row.append(el("span", "analytics-source-name", langLabel(r.lang)));
      const bar = el("span", "analytics-source-bar");
      const fill = el("i", "");
      fill.style.width = `${Math.round((r.views / total) * 100)}%`;
      bar.append(fill);
      const pct = Math.round((r.completionRate || 0) * 100);
      row.append(bar, el("span", "analytics-num", `${formatCount(r.views, locale())} · ${t("analytics.langsCompletion", { pct })} · ${t("analytics.langsLeads", { n: r.leads || 0 })}`));
      host.append(row);
    }
    const combos = (langs.matrix || [])
      .filter((m) => m.audio !== m.text)
      .slice(0, 4)
      .map((m) => `${m.audio === "none" ? t("analytics.langsNoAudio") : langLabel(m.audio)} → ${langLabel(m.text)}: ${m.views}`);
    const parts = [];
    if (combos.length) parts.push(t("analytics.langsMixed", { list: combos.join(" · ") }));
    if (langs.changed) parts.push(t("analytics.langsChanged", { n: langs.changed }));
    if (langs.ccOff) parts.push(t("analytics.langsCcOff", { n: langs.ccOff }));
    if (note) note.textContent = parts.join(" ");
  }

  function paint(data) {
    const e = els();
    const tt = data.totals;
    const loc = locale();
    e.cards.replaceChildren(
      card(t("analytics.views"), formatCount(tt.views, loc), t("analytics.uniqueApprox", { n: formatCount(tt.uniqueViewersApprox, loc) })),
      card(t("analytics.completions"), percent(tt.completionRate), t("analytics.completionsSub", { n: formatCount(tt.completions, loc) })),
      card(
        t("analytics.cta"),
        tt.ctaViews ? percent(tt.ctaRate) : "—",
        tt.ctaViews ? t("analytics.ctaSub", { n: formatCount(tt.ctaClicks, loc), m: formatCount(tt.ctaViews, loc) }) : t("analytics.ctaNone")
      ),
      card(t("analytics.time"), formatDuration(tt.medianTotalMs), t("analytics.timeSub"))
    );
    const split = [
      t("analytics.split", { embed: formatCount(tt.embedViews, loc), direct: formatCount(tt.directViews, loc) }),
    ];
    if (tt.opened > tt.views) split.push(t("analytics.openedOnly", { n: formatCount(tt.opened - tt.views, loc) }));
    if (tt.leadViews > 0) split.push(t("analytics.leadViews", { n: formatCount(tt.leadViews, loc) }));
    e.split.textContent = split.join(" · ");
    paintChart(data.series || []);
    paintSteps(data);
    paintSources(data);
    paintLangs(data);
  }

  async function load() {
    const slug = getSlug?.();
    const e = els();
    if (!slug) return;
    const mine = ++ticket;
    const range = rangeForPreset(days);
    e.status.textContent = t("analytics.loading");
    e.status.hidden = false;
    const res = await cloudFetch(
      `/shares/${encodeURIComponent(slug)}/analytics?from=${range.from}&to=${range.to}&tz=${encodeURIComponent(ANALYTICS_TZ)}`,
      { method: "GET" }
    );
    if (mine !== ticket) return;
    if (!res.ok) {
      e.body.hidden = true;
      e.empty.hidden = true;
      if (res.status === 402) {
        e.dialog.close();
        onPaywall?.();
        return;
      }
      e.status.textContent = res.status === 401 ? t("analytics.errAuth") : t("analytics.errLoad");
      return;
    }
    const data = res.data || {};
    if (!data.totals) {
      e.status.textContent = t("analytics.errLoad");
      return;
    }
    e.status.hidden = true;
    e.status.textContent = "";
    const empty = !data.totals.opened;
    e.empty.hidden = !empty;
    e.body.hidden = empty;
    if (!empty) paint(data);
  }

  function paintRange() {
    for (const btn of els().range?.querySelectorAll("[data-days]") || []) {
      const on = Number(btn.dataset.days) === days;
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.classList.toggle("is-active", on);
    }
  }

  function bind() {
    if (bound) return;
    bound = true;
    const e = els();
    e.close?.addEventListener("click", () => e.dialog.close());
    e.range?.addEventListener("click", (event) => {
      const btn = event.target.closest?.("[data-days]");
      if (!btn) return;
      days = Number(btn.dataset.days) || 30;
      paintRange();
      void load();
    });
  }

  function open() {
    const e = els();
    if (!e.dialog) return;
    bind();
    const slug = getSlug?.();
    if (!slug) {
      toast?.(t("analytics.needsPublish"), 4200);
      return;
    }
    e.title.textContent = String(getTitle?.() || "").trim();
    e.body.hidden = true;
    e.empty.hidden = true;
    paintRange();
    if (!e.dialog.open) e.dialog.showModal();
    void load();
  }

  return { open };
}
