/**
 * Comentários do Team (DOM + controle). Só nasce dentro de uma sessão colaborativa (flag `collab`).
 * Texto de comentário e nome de pessoa entram sempre como texto (textContent e atributos), nunca como HTML.
 * Acessibilidade: painel não modal com foco gerenciado, Esc fecha, contagens em texto, aria-live discreto,
 * lista de menções como listbox. Celular: o painel e o popover viram bottom sheet (css/comments.css).
 */
import { FIELD_INPUT_IDS } from "./collabModel.js";
import {
  COMMENT_FIELDS, COMMENT_MAX, applyMention, commentSegments, createCommentsClient, errorKey, fieldThreads, filterMembers,
  filterThreads, groupThreads, mentionQuery, mentionedIds, newFromOthers, openCountForStep, validateDraft,
} from "./comments.js";

function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === "class") node.className = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return node;
}

const hasDom = () => typeof document !== "undefined";
let uid = 0;
const nextId = (p) => `${p}-${++uid}`;

const SVG_NS = "http://www.w3.org/2000/svg";

/** Paths Lucide-ish (stroke). Ícones via createElementNS (sem HTML cru). */
const ICO = {
  edit: ["M12 20h9", "M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"],
  trash: ["M3 6h18", "M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2", "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6", "M10 11v6", "M14 11v6"],
  reply: ["M9 14 4 9l5-5", "M20 20v-7a4 4 0 0 0-4-4H4"],
  check: ["M20 6 9 17l-5-5"],
  reopen: ["M3 12a9 9 0 0 1 15.5-6.4L21 8", "M21 3v5h-5", "M21 12a9 9 0 0 1-15.5 6.4L3 16", "M3 21v-5h5"],
  send: ["M22 2 11 13", "M22 2l-7 20-4-9-9-4Z"],
  save: ["M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z", "M17 21v-8H7v8", "M7 3v5h8"],
  x: ["M18 6 6 18", "M6 6l12 12"],
  goto: ["M7 17 17 7", "M8 7h9v9"],
  more: ["M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z", "M19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z", "M5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"],
};

function svgIco(name) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("comment-ico");
  for (const d of ICO[name] || []) {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", "currentColor");
    p.setAttribute("stroke-width", "2");
    p.setAttribute("stroke-linecap", "round");
    p.setAttribute("stroke-linejoin", "round");
    svg.append(p);
  }
  return svg;
}

function iconBtn({ label, icon, className = "", type = "button", primary = false, danger = false, onclick }) {
  const cls = ["comment-icon-btn", primary && "is-primary", danger && "is-danger", className].filter(Boolean).join(" ");
  return el("button", { type, class: cls, "aria-label": label, title: label, onclick }, svgIco(icon));
}

export function createCommentsUi(deps) {
  const {
    t, request, projectId, getProject, getSelectedIndex, setSelectedIndex, getSelfId, getMembers = () => [], refreshMembers = async () => {},
    announce = () => {}, toast = () => {}, getLocale = () => document.documentElement.lang || "pt",
  } = deps;
  const api = createCommentsClient({ request, projectId });
  const S = {
    threads: [], summary: { openThreads: 0, unread: 0, byStep: {} }, canComment: false, role: "viewer", emailMuted: false,
    loaded: false, loading: false, error: false, filter: "open", cseq: null, open: false, lapsed: false, lastList: null,
  };
  let panel = null;
  let listEl = null;
  let toggle = null;
  let toggleBadge = null;
  let popover = null;
  let popoverFor = null;
  let observer = null;
  let propsObserver = null;
  let debounce = null;
  let destroyed = false;
  let focusThread = null;
  const readTimers = new Map();
  const drafts = new Map(); // chave do composer -> texto (sobrevive ao repintar)
  const openReplies = new Set(); // conversas com a resposta aberta (sobrevive ao repintar)

  const stepIds = () => (getProject()?.steps || []).map((s) => s?.id);
  const stepN = (id) => Math.max(1, stepIds().indexOf(id) + 1);
  const selStepId = () => getProject()?.steps?.[getSelectedIndex()]?.id || null;
  const fieldName = (f) => t(`collab.field.${f}`);
  const whereText = (th) => {
    if (!th.stepId) return t("comments.where.project");
    if (th.orphaned) return t("comments.group.orphan");
    return th.fieldKey && COMMENT_FIELDS.includes(th.fieldKey)
      ? t("comments.where.field", { field: fieldName(th.fieldKey), n: stepN(th.stepId) })
      : t("comments.where.step", { n: stepN(th.stepId) });
  };
  const errText = (res) => {
    const key = errorKey(res);
    const s = t(key);
    return s && s !== key ? s : t("comments.errors.generic");
  };
  const when = (iso) => {
    try { return new Date(iso).toLocaleString(getLocale(), { dateStyle: "short", timeStyle: "short" }); } catch { return ""; }
  };
  const nameOf = (p) => (p?.former || !p?.name ? t("comments.former") : p.name);

  /* ---------- dados ---------- */
  async function refresh({ quiet = false } = {}) {
    if (destroyed || S.loading) return;
    S.loading = true;
    if (!quiet && !S.loaded) { S.error = false; paint(); }
    const res = await api.list("all");
    S.loading = false;
    if (destroyed) return;
    if (!res.ok) {
      S.error = !S.loaded;
      paint();
      return;
    }
    const d = res.data || {};
    const prev = S.loaded ? S.threads : null;
    S.threads = Array.isArray(d.threads) ? d.threads : [];
    S.summary = d.summary || S.summary;
    S.canComment = Boolean(d.canComment);
    S.role = d.role || S.role;
    S.emailMuted = Boolean(d.emailMuted);
    S.lapsed = d.role !== "viewer" && !d.canComment;
    S.cseq = d.cseq ?? S.cseq;
    S.error = false;
    S.loaded = true;
    if (prev) notifyNew(prev);
    paint();
  }

  function notifyNew(prev) {
    const fresh = newFromOthers(prev, S.threads, getSelfId());
    if (!fresh.length) return;
    announce(t("comments.live.new", { n: fresh.length }));
    if (S.open) return; // com o painel aberto o conteúdo já está na tela
    const f = fresh[fresh.length - 1];
    toast({
      text: t(f.first ? "comments.toast.thread" : "comments.toast.reply", { name: nameOf(f.comment.author), where: whereText(f.thread) }),
      actionLabel: t("comments.toast.open"),
      onAction: () => openPanel({ threadId: f.thread.id }),
    });
  }

  function onCseq(n) {
    if (destroyed || n == null) return;
    if (S.cseq === n && S.loaded) return;
    S.cseq = n;
    void refresh({ quiet: true });
  }

  /* ---------- botão da barra e selos ---------- */
  function paintToggle() {
    if (!toggle) return;
    const open = S.summary.openThreads || 0;
    toggle.setAttribute("aria-label", t("comments.openCount", { n: open }));
    toggle.title = t("comments.openCount", { n: open });
    toggleBadge.textContent = open ? String(open) : "";
    toggle.classList.toggle("has-unread", (S.summary.unread || 0) > 0);
    toggle.dataset.unread = String(S.summary.unread || 0);
  }

  function paintFilmstrip() {
    const film = document.getElementById("filmstrip");
    if (!film) return;
    film.querySelectorAll(".comment-film-badge").forEach((n) => n.remove());
    film.querySelectorAll(".film-item").forEach((item) => {
      const index = Number(item.dataset.index);
      const id = getProject()?.steps?.[index]?.id;
      const n = id ? openCountForStep(S.summary, id) : 0;
      if (!n) return;
      const unread = Number(S.summary.byStep?.[id]?.unread) || 0;
      const label = t("comments.badge.aria", { n });
      item.append(el("button", {
        type: "button",
        class: `comment-film-badge${unread ? " has-unread" : ""}`,
        title: label,
        "aria-label": label,
        onclick: (e) => {
          e.preventDefault();
          e.stopPropagation();
          setSelectedIndex(index);
          openPanel({ stepId: id });
        },
      }, el("span", { "aria-hidden": "true" }, `💬 ${n}`)));
    });
  }

  /** No palco, o passo que já tem conversa ganha um botão para abrir só ela. */
  function paintSlideOpen() {
    const frame = document.getElementById("canvas-frame");
    if (!frame) return;
    frame.querySelectorAll(".comment-slide-open").forEach((n) => n.remove());
    const sid = selStepId();
    const n = sid ? openCountForStep(S.summary, sid) : 0;
    if (!n) return;
    const label = t("comments.badge.aria", { n });
    frame.append(el("button", {
      type: "button",
      class: "comment-slide-open",
      title: label,
      "aria-label": label,
      onclick: (e) => { e.preventDefault(); e.stopPropagation(); openPanel({ stepId: sid }); },
    }, `💬 ${n}`));
  }

  /* ---------- botões nos campos ---------- */
  function paintFieldButtons() {
    const sid = selStepId();
    for (const [field, inputId] of Object.entries(FIELD_INPUT_IDS)) {
      const input = document.getElementById(inputId);
      const wrap = input ? (input.closest(".field, .prop-field, label, .props-group, .prop-row") || input.parentElement) : null;
      if (!wrap) continue;
      let btn = wrap.querySelector(`:scope > .comment-field-btn[data-field="${field}"]`);
      if (!sid) { btn?.remove(); continue; }
      const n = fieldThreads(S.threads, sid, field).filter((x) => x.status === "open").length;
      const label = n ? t("comments.field.buttonCount", { field: fieldName(field), n }) : t("comments.field.button", { field: fieldName(field) });
      if (!btn) {
        btn = el("button", { type: "button", class: "comment-field-btn", "data-field": field, "aria-haspopup": "dialog" });
        btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); openPopover(field, btn); });
        wrap.append(btn);
      }
      if (btn.getAttribute("aria-label") !== label) {
        btn.setAttribute("aria-label", label);
        btn.title = label;
      }
      const text = n ? `💬 ${n}` : "💬";
      if (btn.textContent !== text) btn.textContent = text;
      btn.classList.toggle("has-open", n > 0);
    }
  }

  /* ---------- composer ---------- */
  function composer({ key, label, onSend, onCancel = null, attach = null, rows = 3, autofocus = false, submitLabel = null }) {
    const id = nextId("comment-in");
    const wrap = el("form", { class: "comment-composer", novalidate: true });
    const ta = el("textarea", { id, "data-key": key, class: "comment-input", rows: String(rows), maxlength: String(COMMENT_MAX), placeholder: t("comments.placeholder"), "aria-label": label, autocomplete: "off" });
    ta.value = drafts.get(key) || "";
    const err = el("p", { class: "comment-error", role: "alert", hidden: true });
    const count = el("span", { class: "comment-count" });
    const sendLabel = submitLabel || t("comments.send");
    const sendIcon = submitLabel ? "save" : "send";
    const send = iconBtn({ label: sendLabel, icon: sendIcon, type: "submit", primary: true, className: "comment-send" });
    const cancelBtn = onCancel
      ? iconBtn({ label: t("comments.cancel"), icon: "x", className: "comment-cancel", onclick: () => { drafts.delete(key); onCancel(); } })
      : null;
    const list = el("ul", { class: "comment-mentions", role: "listbox", id: `${id}-mentions`, "aria-label": t("comments.mention.aria"), hidden: true });
    let options = [];
    let active = -1;
    const syncCancel = () => {
      if (!cancelBtn || !onCancel) return;
      // Figma/YouTube: X só quando há texto (ou sempre no reply/edit — onCancel já implica dismiss)
      cancelBtn.hidden = false;
    };
    const updateCount = () => {
      count.textContent = t("comments.count", { n: ta.value.length, max: COMMENT_MAX });
      syncCancel();
    };
    const closeMentions = () => { list.hidden = true; list.replaceChildren(); options = []; active = -1; ta.removeAttribute("aria-activedescendant"); ta.setAttribute("aria-expanded", "false"); };
    const choose = (m) => {
      const st = mentionQuery(ta.value, ta.selectionStart);
      if (!st) return closeMentions();
      const r = applyMention(ta.value, st, m.name, ta.selectionStart);
      ta.value = r.value;
      ta.setSelectionRange(r.caret, r.caret);
      drafts.set(key, ta.value);
      updateCount();
      closeMentions();
      ta.focus();
    };
    const showMentions = () => {
      const st = mentionQuery(ta.value, ta.selectionStart);
      if (!st) return closeMentions();
      options = filterMembers(getMembers(), st.query, getSelfId());
      if (!options.length) return closeMentions();
      list.replaceChildren(...options.map((m, i) => el("li", { role: "option", id: `${id}-opt-${i}`, "aria-selected": "false", class: "comment-mention-option", onmousedown: (e) => { e.preventDefault(); choose(m); } }, m.name)));
      list.hidden = false;
      active = 0;
      markActive();
      ta.setAttribute("aria-expanded", "true");
    };
    const markActive = () => {
      [...list.children].forEach((li, i) => li.setAttribute("aria-selected", i === active ? "true" : "false"));
      if (active >= 0) ta.setAttribute("aria-activedescendant", `${id}-opt-${active}`);
    };
    ta.setAttribute("role", "combobox");
    ta.setAttribute("aria-autocomplete", "list");
    ta.setAttribute("aria-expanded", "false");
    ta.setAttribute("aria-controls", `${id}-mentions`);
    ta.addEventListener("input", () => { drafts.set(key, ta.value); updateCount(); err.hidden = true; showMentions(); });
    ta.addEventListener("click", showMentions);
    ta.addEventListener("keydown", (e) => {
      if (!list.hidden && options.length) {
        if (e.key === "ArrowDown") { e.preventDefault(); active = (active + 1) % options.length; markActive(); return; }
        if (e.key === "ArrowUp") { e.preventDefault(); active = (active - 1 + options.length) % options.length; markActive(); return; }
        if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); choose(options[Math.max(0, active)]); return; }
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeMentions(); return; }
      }
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); wrap.requestSubmit(); }
    });
    ta.addEventListener("blur", () => setTimeout(closeMentions, 120));
    wrap.addEventListener("submit", async (e) => {
      e.preventDefault();
      const value = ta.value.trim();
      const bad = validateDraft(value);
      if (bad) { err.textContent = t(`comments.errors.${bad}`); err.hidden = false; ta.focus(); return; }
      send.disabled = true;
      send.setAttribute("aria-busy", "true");
      send.setAttribute("aria-label", t("comments.sending"));
      send.title = t("comments.sending");
      const extra = attach ? attach() : {};
      // o rascunho sai antes: o repintar que vem depois do envio não pode trazê-lo de volta
      drafts.delete(key);
      const res = await onSend({ body: value, mentions: mentionedIds(value, getMembers(), getSelfId()), ...extra });
      send.disabled = false;
      send.removeAttribute("aria-busy");
      send.setAttribute("aria-label", sendLabel);
      send.title = sendLabel;
      if (res && res.ok === false) { drafts.set(key, value); err.textContent = errText(res); err.hidden = false; updateCount(); return; }
      ta.value = "";
      updateCount();
    });
    const actions = el("div", { class: "comment-composer-actions" }, count);
    if (cancelBtn) actions.append(cancelBtn);
    actions.append(send);
    wrap.append(...(attach && attach.control ? [attach.control] : []), ta, list, err, actions);
    updateCount();
    if (autofocus) setTimeout(() => ta.focus(), 0);
    return wrap;
  }

  /* ---------- thread ---------- */
  function renderBody(body) {
    const names = (getMembers() || []).map((m) => m.name);
    const p = el("p", { class: "comment-body" });
    for (const seg of commentSegments(body, names)) {
      if (seg.type === "link") p.append(el("a", { href: seg.href, target: "_blank", rel: "noopener noreferrer nofollow", class: "comment-link" }, seg.value));
      else if (seg.type === "mention") p.append(el("strong", { class: "comment-mention" }, seg.value));
      else p.append(document.createTextNode(seg.value));
    }
    return p;
  }

  function canResolve(th) {
    if (!S.canComment) return false;
    if (S.role === "owner" || S.role === "editor") return true;
    return S.role === "commenter" && th.createdBy?.id === getSelfId();
  }

  async function act(fn, after = refresh) {
    const res = await fn();
    if (!res.ok) { toast({ text: errText(res) }); return res; }
    await after({ quiet: true });
    return res;
  }

  function renderThread(th, { compact = false } = {}) {
    const open = th.status === "open";
    const art = el("article", { class: `comment-thread${open ? "" : " is-resolved"}${th.unread ? " has-unread" : ""}`, "data-thread": th.id, "aria-label": t("comments.thread.aria", { where: whereText(th) }), tabindex: "-1" });
    const head = el("header", { class: "comment-thread-head" }, el("span", { class: "comment-where" }, whereText(th)));
    if (th.unread) head.append(el("span", { class: "comment-chip is-unread" }, t("comments.unread", { n: th.unread })));
    if (!open) head.append(el("span", { class: "comment-chip" }, t("comments.resolvedBy", { name: nameOf(th.resolvedBy) })));
    art.append(head);
    if (th.orphaned) art.append(el("p", { class: "comment-note is-orphan" }, t("comments.orphan")));
    if (th.stale) {
      art.append(el("p", { class: "comment-note is-stale", role: "note" }, el("strong", {}, t("comments.stale")),
        th.anchorText ? el("span", { class: "comment-quote" }, t("comments.staleQuote", { text: th.anchorText })) : null));
    } else if (th.anchorText && th.fieldKey) {
      art.append(el("blockquote", { class: "comment-quote" }, th.anchorText));
    }
    const list = el("ol", { class: "comment-list" });
    for (const c of th.comments) {
      const li = el("li", { class: `comment${c.deleted ? " is-deleted" : ""}`, "data-comment": c.id });
      const who = c.author?.id && c.author.id === getSelfId() ? `${nameOf(c.author)} (${t("comments.you")})` : nameOf(c.author);
      li.append(el("div", { class: "comment-meta" }, el("strong", { class: "comment-author" }, who), el("time", { datetime: c.createdAt }, when(c.createdAt)), c.editedAt ? el("span", { class: "comment-edited" }, `· ${t("comments.edited")}`) : null));
      if (c.deleted) li.append(el("p", { class: "comment-body is-removed" }, t("comments.removed")));
      else {
        li.append(renderBody(c.body));
        const bar = el("div", { class: "comment-actions" });
        if (c.canEdit && S.canComment) {
          bar.append(iconBtn({ label: t("comments.edit"), icon: "edit", className: "comment-action-edit", onclick: () => startEdit(li, c) }));
        }
        if (c.canDelete) {
          bar.append(iconBtn({
            label: t("comments.delete"), icon: "trash", danger: true, className: "comment-action-delete",
            onclick: async () => {
              if (typeof deps.confirm === "function" && !(await deps.confirm(t("comments.deleteConfirm")))) return;
              await act(() => api.remove(c.id));
            },
          }));
        }
        if (bar.children.length) li.append(bar);
      }
      list.append(li);
    }
    art.append(list);
    const foot = el("div", { class: "comment-thread-actions" });
    if (S.canComment && th.status !== "archived") {
      const holder = el("div", { class: "comment-reply-holder" });
      const openReply = (focus) => {
        openReplies.add(th.id);
        holder.append(composer({
          key: `reply:${th.id}`, label: t("comments.replyLabel"), rows: 2, autofocus: focus,
          onSend: async (v) => { const r = await act(() => api.reply(th.id, { body: v.body, mentions: v.mentions })); if (r.ok) openReplies.delete(th.id); return r; },
          onCancel: () => { openReplies.delete(th.id); holder.replaceChildren(); },
        }));
      };
      foot.append(iconBtn({
        label: t("comments.reply"), icon: "reply", className: "comment-action-reply",
        onclick: () => {
          if (holder.firstChild) { openReplies.delete(th.id); holder.replaceChildren(); return; }
          openReply(true);
        },
      }));
      if (canResolve(th)) {
        foot.append(iconBtn({
          label: open ? t("comments.resolve") : t("comments.reopen"),
          icon: open ? "check" : "reopen",
          className: open ? "comment-action-resolve" : "comment-action-reopen",
          onclick: () => act(() => (open ? api.resolve(th.id) : api.reopen(th.id))),
        }));
      }
      art.append(foot, holder);
      if (openReplies.has(th.id) || drafts.get(`reply:${th.id}`)) openReply(false);
    }
    if (!compact) scheduleRead(th, art);
    return art;
  }

  function startEdit(li, c) {
    const body = li.querySelector(".comment-body");
    const bar = li.querySelector(".comment-actions");
    if (!body) return;
    bar?.setAttribute("hidden", "");
    drafts.set(`edit:${c.id}`, c.body);
    const form = composer({
      key: `edit:${c.id}`, label: t("comments.edit"), rows: 3, autofocus: true, submitLabel: t("comments.save"),
      onSend: async (v) => { const r = await api.edit(c.id, { body: v.body, mentions: v.mentions }); if (r.ok) await refresh({ quiet: true }); return r; },
      onCancel: () => { form.remove(); body.hidden = false; bar?.removeAttribute("hidden"); },
    });
    body.hidden = true;
    body.after(form);
  }

  /** Lida de verdade só quando a conversa está visível (painel aberto ou popover). */
  function scheduleRead(th, node) {
    if (!th.unread) return;
    clearTimeout(readTimers.get(th.id));
    readTimers.set(th.id, setTimeout(async () => {
      if (destroyed || !node.isConnected) return;
      const res = await api.markRead(th.id);
      if (res.ok) {
        th.unread = 0;
        S.summary.unread = S.threads.reduce((n, x) => n + (x.unread || 0), 0);
        for (const k of Object.keys(S.summary.byStep || {})) {
          S.summary.byStep[k].unread = S.threads.filter((x) => (x.stepId || "_project") === k).reduce((n, x) => n + (x.unread || 0), 0);
        }
        node.classList.remove("has-unread");
        node.querySelector(".comment-chip.is-unread")?.remove();
        paintToggle();
        paintFilmstrip();
      }
    }, 900));
  }

  /* ---------- painel ---------- */
  function buildPanel() {
    if (panel?.isConnected) return;
    const titleId = "comments-panel-title";
    const tabs = el("div", { class: "comments-tabs", role: "group", "aria-label": t("comments.filter.aria") },
      ["open", "resolved", "mine"].map((f) => el("button", { type: "button", class: "comments-tab", "data-filter": f, onclick: () => { S.filter = f; paint(); } }, t(`comments.filter.${f}`))));
    listEl = el("div", { class: "comments-list", id: "comments-list" });
    panel = el("aside", { class: "comments-panel", id: "comments-panel", role: "dialog", "aria-modal": "false", "aria-labelledby": titleId, hidden: true },
      el("header", { class: "comments-head" },
        el("h2", { id: titleId, tabindex: "-1" }, t("comments.panelTitle")),
        el("button", { type: "button", class: "btn btn-sm btn-ghost comments-close", "aria-label": t("comments.close"), onclick: () => closePanel() }, "×")),
      tabs, listEl, el("div", { class: "comments-foot", id: "comments-foot" }));
    document.body.append(panel);
  }

  function attachControl() {
    const project = getProject();
    const select = el("select", { class: "comment-attach", "aria-label": t("comments.attach"), id: nextId("comment-attach") });
    const sid = selStepId();
    if (sid) {
      select.append(el("option", { value: "step" }, `${t("comments.attach.step")} (${t("comments.group.step", { n: stepN(sid) })})`));
      for (const f of COMMENT_FIELDS) select.append(el("option", { value: `field:${f}` }, `${fieldName(f)} (${t("comments.group.step", { n: stepN(sid) })})`));
    }
    select.append(el("option", { value: "project" }, t("comments.attach.project")));
    void project;
    const fn = () => {
      const v = select.value;
      if (v === "project") return { stepId: null };
      if (v.startsWith("field:")) return { stepId: sid, fieldKey: v.slice(6) };
      return { stepId: sid };
    };
    fn.control = el("label", { class: "comment-attach-wrap" }, el("span", {}, t("comments.attach")), select);
    return fn;
  }

  function paintPanel() {
    if (!panel || !listEl) return;
    panel.querySelectorAll(".comments-tab").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.filter === S.filter)));
    const keep = listEl.scrollTop;
    listEl.replaceChildren();
    if (!S.loaded) {
      listEl.append(S.error
        ? el("div", { class: "comments-state" }, el("p", {}, t("comments.error")), el("button", { type: "button", class: "btn btn-sm", onclick: () => { S.error = false; void refresh(); } }, t("comments.retry")))
        : el("p", { class: "comments-state" }, t("comments.loading")));
    } else {
      let shown = filterThreads(S.threads, S.filter, getSelfId());
      if (S.stepScope) shown = shown.filter((th) => th.stepId === S.stepScope);
      if (!shown.length) listEl.append(el("p", { class: "comments-state" }, t(`comments.empty.${S.filter}`)));
      const cur = selStepId();
      const groups = groupThreads(shown, stepIds());
      groups.sort((a, b) => Number(b.stepId === cur) - Number(a.stepId === cur) || 0);
      for (const g of groups) {
        const title = g.kind === "step" ? t("comments.group.step", { n: g.n }) : g.kind === "project" ? t("comments.group.project") : t("comments.group.orphan");
        const heading = el("h3", { class: "comments-group-title" }, title);
        if (g.stepId) {
          heading.append(" ", iconBtn({
            label: t("comments.goto"), icon: "goto", className: "comments-goto",
            onclick: () => { const i = stepIds().indexOf(g.stepId); if (i >= 0) setSelectedIndex(i); },
          }));
        }
        const sec = el("section", { class: `comments-group${g.stepId === cur ? " is-current" : ""}`, "aria-label": title }, heading);
        for (const th of g.threads) sec.append(renderThread(th));
        listEl.append(sec);
      }
    }
    listEl.scrollTop = keep;
    const foot = panel.querySelector("#comments-foot");
    foot.replaceChildren();
    if (S.loaded) {
      if (S.canComment) {
        const attach = attachControl();
        foot.append(el("h3", { class: "comments-new-title" }, t("comments.new")), composer({
          key: `new:${selStepId() || "p"}`, label: t("comments.newLabel"), rows: 3, attach,
          onSend: async (v) => {
            const input = { body: v.body, mentions: v.mentions, ...attach() };
            const res = await api.createThread(input);
            if (res.ok) await refresh({ quiet: true });
            return res;
          },
        }));
      } else {
        foot.append(el("p", { class: "comment-note" }, S.role === "viewer" ? t("comments.readonly.viewer") : t("comments.readonly.lapsed")));
      }
      const id = nextId("comment-mute");
      // marcado = recebe e-mails de comentários; desmarcar silencia este tour
      foot.append(el("label", { class: "comments-mute", for: id, title: t("comments.emailMutedHint") },
        el("input", { type: "checkbox", id, checked: S.emailMuted ? null : true, onchange: async (e) => {
          const muted = !e.target.checked;
          const res = await api.setPrefs(muted);
          if (res.ok) S.emailMuted = muted; else { e.target.checked = !e.target.checked; toast({ text: errText(res) }); }
        } }), el("span", {}, t("comments.emailMuted"))));
    }
    if (focusThread) {
      const node = listEl.querySelector(`[data-thread="${CSS.escape(focusThread)}"]`);
      if (node) { node.scrollIntoView({ block: "center" }); node.focus({ preventScroll: true }); node.classList.add("is-focus"); focusThread = null; }
    }
    if (S.compose) {
      const box = panel.querySelector("#comments-foot textarea");
      if (box) { box.focus(); S.compose = false; }
    }
  }

  function openPanel({ threadId = null, filter = null, stepId = null, compose = false } = {}) {
    buildPanel();
    closePopover();
    S.open = true;
    S.stepScope = stepId || null;
    S.compose = Boolean(compose);
    if (filter) S.filter = filter;
    focusThread = threadId;
    if (threadId) {
      const th = S.threads.find((x) => x.id === threadId);
      if (th && th.status === "resolved" && S.filter === "open") S.filter = "resolved";
    }
    panel.hidden = false;
    document.body.classList.add("comments-open");
    toggle?.setAttribute("aria-expanded", "true");
    paintPanel();
    if (!S.loaded) void refresh();
    else void refresh({ quiet: true });
    if (!threadId && !S.compose) panel.querySelector("#comments-panel-title")?.focus();
  }

  function closePanel() {
    if (!panel) return;
    S.open = false;
    panel.hidden = true;
    document.body.classList.remove("comments-open");
    toggle?.setAttribute("aria-expanded", "false");
    toggle?.focus();
  }

  /* ---------- popover de campo ---------- */
  function openPopover(field, button) {
    closePopover();
    const sid = selStepId();
    if (!sid) return;
    popoverFor = button;
    const fname = fieldName(field);
    const titleId = nextId("comment-pop-title");
    popover = el("div", { class: "comment-popover", role: "dialog", "aria-modal": "false", "aria-labelledby": titleId });
    const head = el("header", { class: "comment-popover-head" }, el("h3", { id: titleId }, t("comments.popover.title", { field: fname })),
      el("button", { type: "button", class: "btn btn-sm btn-ghost", "aria-label": t("comments.close"), onclick: () => closePopover() }, "×"));
    const body = el("div", { class: "comment-popover-body" });
    const paintBody = () => {
      body.replaceChildren();
      const list = fieldThreads(S.threads, sid, field);
      for (const th of list) body.append(renderThread(th, { compact: false }));
      if (S.canComment) {
        body.append(composer({
          key: `pop:${sid}:${field}`, label: t("comments.newLabel"), rows: 2, autofocus: !list.length,
          onSend: async (v) => {
            const res = await api.createThread({ body: v.body, mentions: v.mentions, stepId: sid, fieldKey: field });
            if (res.ok) await refresh({ quiet: true });
            return res;
          },
        }));
      } else body.append(el("p", { class: "comment-note" }, S.role === "viewer" ? t("comments.readonly.viewer") : t("comments.readonly.lapsed")));
    };
    popover._repaint = paintBody;
    paintBody();
    popover.append(head, body);
    document.body.append(popover);
    placePopover(button);
    setTimeout(() => document.addEventListener("pointerdown", outside, true), 0);
    const first = popover.querySelector("textarea") || popover.querySelector("button");
    first?.focus();
  }
  function outside(e) {
    if (!popover) return;
    if (popover.contains(e.target) || popoverFor?.contains(e.target)) return;
    closePopover({ refocus: false });
  }
  function placePopover(button) {
    const r = button.getBoundingClientRect();
    const w = Math.min(340, window.innerWidth - 16);
    popover.style.width = `${w}px`;
    popover.style.left = `${Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))}px`;
    popover.style.top = `${Math.min(r.bottom + 6, Math.max(8, window.innerHeight - 260))}px`;
  }
  function closePopover({ refocus = true } = {}) {
    document.removeEventListener("pointerdown", outside, true);
    popover?.remove();
    popover = null;
    if (refocus) popoverFor?.focus?.();
    popoverFor = null;
  }

  /** Repintar não pode roubar o foco nem o cursor de quem está digitando. */
  function withFocusKept(fn) {
    const a = document.activeElement;
    const inside = a && a.matches?.("textarea.comment-input") && (panel?.contains(a) || popover?.contains(a));
    const keep = inside ? { key: a.dataset.key, start: a.selectionStart, end: a.selectionEnd } : null;
    const hadFocus = Boolean(a && (panel?.contains(a) || popover?.contains(a)));
    fn();
    const root = popover && popover.contains(a) !== false && keep ? popover : null;
    if (keep) {
      const target = [popover, panel].filter(Boolean).map((r) => r.querySelector(`textarea[data-key="${CSS.escape(keep.key)}"]`)).find(Boolean);
      if (target) { target.focus({ preventScroll: true }); try { target.setSelectionRange(keep.start, keep.end); } catch { /* ignore */ } }
    } else if (hadFocus && document.activeElement === document.body) {
      (popover || panel)?.querySelector("textarea, button")?.focus({ preventScroll: true });
    }
    void root;
  }

  /* ---------- pintura geral ---------- */
  function paint() {
    if (destroyed || typeof document === "undefined") return;
    paintToggle();
    paintFilmstrip();
    paintSlideOpen();
    paintFieldButtons();
    withFocusKept(() => {
      if (S.open) paintPanel();
      if (popover?._repaint) popover._repaint();
    });
  }

  // Esc: fecha o popover; sem popover, fecha o painel. Mesmo com o foco no corpo da página (depois de repintar).
  function onEscape(e) {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    if (popover) { e.preventDefault(); closePopover(); return; }
    if (S.open) { e.preventDefault(); closePanel(); }
  }

  function start() {
    if (typeof document === "undefined") { void refresh(); return; }
    document.addEventListener("keydown", onEscape);
    const film = document.getElementById("filmstrip");
    if (film && typeof MutationObserver !== "undefined") {
      observer = new MutationObserver(() => paintFilmstrip());
      observer.observe(film, { childList: true });
    }
    const props = document.getElementById("props-panel");
    if (props && typeof MutationObserver !== "undefined") {
      propsObserver = new MutationObserver(() => { clearTimeout(debounce); debounce = setTimeout(paintFieldButtons, 120); });
      propsObserver.observe(props, { childList: true, subtree: true });
    }
    void refreshMembers();
    void refresh();
  }

  function destroy() {
    destroyed = true;
    if (typeof document === "undefined") return;
    document.removeEventListener("keydown", onEscape);
    observer?.disconnect();
    propsObserver?.disconnect();
    clearTimeout(debounce);
    for (const tm of readTimers.values()) clearTimeout(tm);
    closePopover({ refocus: false });
    panel?.remove();
    toggle?.remove();
    document.body.classList.remove("comments-open");
    document.querySelectorAll(".comment-film-badge, .comment-field-btn, .comment-slide-open").forEach((n) => n.remove());
  }

  return {
    start, destroy, refresh, onCseq, openPanel, closePanel, paint,
    onStepSelected: () => {
      if (!hasDom()) return;
      if (S.open && S.stepScope) S.stepScope = selStepId();
      paintSlideOpen();
      paintFieldButtons();
      if (S.open) paintPanel();
    },
    repaint: () => { if (!hasDom()) return; paintFilmstrip(); paintSlideOpen(); paintFieldButtons(); },
    state: () => S,
  };
}
