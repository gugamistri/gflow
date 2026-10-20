/**
 * Interface da colaboração (DOM). Sem lógica de rede: o controlador chama estes métodos.
 * Tudo nasce escondido e só aparece com a flag `collab` ligada e um projeto colaborativo aberto.
 * Acessibilidade: nome em texto (nunca só cor), `aria-live="polite"` para entrou/saiu, foco gerenciado
 * nos diálogos, rótulos traduzidos. Celular: diálogos viram bottom sheet (ver css/collab.css).
 */
import { AVATAR_TEXT, diffPresence, fieldEditors, groupByStep, visibleAvatars } from "./collabPresence.js";
import { canvasIdsForField, FIELD_INPUT_IDS, fieldForDomTarget } from "./collabModel.js";

function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return node;
}

export function createCollabUi({ t, announceTarget = null, getStepIdAt = () => null, isCompact = () => false } = {}) {
  let mounted = false;
  let root = null;
  let live = null;
  let toasts = null;
  let statusEl = null;
  let banner = null;
  let stack = null;
  let lockBanner = null;
  let removedBanner = null;
  let people = [];
  let prevPeople = [];
  let locks = new Map(); // stepId → { userId, name, color }
  let filmObserver = null;
  const flashTimers = new Map();

  const avatar = (p, { size = "md", title = "" } = {}) =>
    el("span", { class: `collab-avatar collab-avatar-${size}${p.idle ? " is-idle" : ""}`, style: `background:${p.color};color:${AVATAR_TEXT}`, title: title || p.name, "aria-hidden": "true" }, p.initials);

  function mount() {
    if (mounted) return;
    mounted = true;
    root = el("div", { class: "collab-root", id: "collab-root" });
    live = el("div", { class: "collab-sr-only", id: "collab-live", "aria-live": "polite", "aria-atomic": "true", role: "status" });
    toasts = el("div", { class: "collab-toasts", id: "collab-toasts", "aria-live": "polite" });
    statusEl = el("span", { class: "collab-status", id: "collab-status", hidden: true });
    stack = el("button", { type: "button", class: "collab-stack", id: "collab-stack", "aria-haspopup": "dialog", hidden: true });
    banner = el("div", { class: "collab-banner", id: "collab-banner", role: "status", hidden: true });
    root.append(live, toasts);
    document.body.append(root);
    const actions = document.getElementById("topbar-actions-editor");
    const share = actions?.querySelector(".export-panel");
    if (actions) {
      const bar = el("div", { class: "collab-topbar", id: "collab-topbar" }, statusEl, stack);
      if (share && share.parentNode === actions) actions.insertBefore(bar, share);
      else actions.prepend(bar);
    }
    // fora do grid do editor (senão vira uma célula): logo acima da área de edição
    const view = document.getElementById("view-editor");
    if (view?.parentNode) view.parentNode.insertBefore(banner, view);
    else document.body.prepend(banner);
    const film = document.getElementById("filmstrip");
    if (film && typeof MutationObserver !== "undefined") {
      filmObserver = new MutationObserver(() => paintFilmstrip());
      filmObserver.observe(film, { childList: true });
    }
  }

  function unmount() {
    filmObserver?.disconnect();
    filmObserver = null;
    document.getElementById("collab-topbar")?.remove();
    root?.remove();
    banner?.remove();
    lockBanner?.remove();
    removedBanner?.remove();
    clearFieldMarks();
    document.querySelectorAll(".collab-film-avatars").forEach((n) => n.remove());
    document.body.classList.remove("collab-on", "collab-readonly");
    document.getElementById("props-body")?.removeAttribute("inert");
    mounted = false;
    people = [];
    prevPeople = [];
    locks = new Map();
  }

  function announce(text) {
    if (!live || !text) return;
    live.textContent = "";
    // why: limpar antes garante que o leitor de tela releia a mesma frase
    setTimeout(() => { live.textContent = text; }, 30);
  }

  /* ---------- presença ---------- */

  function setPeople(next, { selfName = "" } = {}) {
    prevPeople = people;
    people = next;
    const { joined, left } = diffPresence(prevPeople, people);
    for (const p of joined) announce(t("collab.live.joined", { name: p.name }));
    for (const p of left) announce(t("collab.live.left", { name: p.name }));
    paintStack(selfName);
    paintFilmstrip();
  }

  function paintStack(selfName) {
    if (!stack) return;
    stack.hidden = false;
    stack.replaceChildren();
    const { shown, more } = visibleAvatars(people, 4);
    const label = people.length
      ? `${t("collab.presence.aria")}: ${people.map((p) => p.name).join(", ")}`
      : `${t("collab.presence.aria")}: ${t("collab.presence.none")}`;
    stack.setAttribute("aria-label", label);
    stack.title = label;
    stack.append(el("span", { class: "collab-avatar collab-avatar-md collab-avatar-self", "aria-hidden": "true", title: t("collab.you") }, (selfName || t("collab.you")).slice(0, 1).toUpperCase()));
    for (const p of shown) stack.append(avatar(p));
    if (more) stack.append(el("span", { class: "collab-avatar collab-avatar-md collab-avatar-more", "aria-hidden": "true" }, `+${more}`));
  }

  function paintFilmstrip() {
    const film = document.getElementById("filmstrip");
    if (!film) return;
    const byStep = groupByStep(people);
    film.querySelectorAll(".collab-film-avatars").forEach((n) => n.remove());
    film.querySelectorAll(".film-item").forEach((item) => {
      item.classList.remove("collab-locked");
      const id = getStepIdAt(Number(item.dataset.index));
      if (!id) return;
      const here = byStep.get(id) || [];
      const lock = locks.get(id);
      if (lock) item.classList.add("collab-locked");
      if (!here.length && !lock) return;
      const { shown, more } = visibleAvatars(here, 2);
      const wrap = el("span", { class: "collab-film-avatars" });
      for (const p of shown) {
        const what = p.field ? t(`collab.editing.${p.field}`) : t("collab.viewing");
        wrap.append(avatar(p, { size: "sm", title: `${p.name} — ${what}` }));
      }
      if (more) wrap.append(el("span", { class: "collab-avatar collab-avatar-sm collab-avatar-more", "aria-hidden": "true" }, `+${more}`));
      if (lock) wrap.append(el("span", { class: "collab-lock-dot", title: t("collab.lock.badge", { name: lock.name }), style: `background:${lock.color}` }));
      const sr = [...shown.map((p) => t("collab.presence.on", { name: p.name, n: Number(item.dataset.index) + 1 }))];
      if (sr.length) wrap.append(el("span", { class: "collab-sr-only" }, sr.join(". ")));
      item.append(wrap);
    });
  }

  /* ---------- locks e indicador de campo ---------- */

  function clearFieldMarks() {
    document.querySelectorAll(".collab-field-remote, .collab-live-edit, .collab-live-host").forEach((n) => {
      n.classList.remove("collab-field-remote", "collab-live-edit", "collab-live-host");
      if (n.classList.contains("collab-updated")) return;
      n.removeAttribute("data-collab-by");
      if (!n.classList.contains("collab-field-flash")) n.style.removeProperty("--collab-color");
    });
  }

  function isShown(node) {
    return Boolean(node && !node.hidden && !node.closest?.("[hidden]"));
  }

  function markEditing(node, person, cls) {
    node.classList.add(cls);
    node.setAttribute("data-collab-by", person.name);
    node.style.setProperty("--collab-color", person.color);
  }

  function wrapperFor(inputId) {
    const input = document.getElementById(inputId);
    return input ? input.closest(".field, .prop-field, label, .props-group, .prop-row") || input.parentElement : null;
  }

  /** Borda na cor da pessoa + nome, no inspetor e no texto do palco, enquanto outro edita aquele campo neste passo. */
  function paintFieldMarks(stepId) {
    clearFieldMarks();
    if (!stepId) return;
    for (const p of fieldEditors(people, stepId)) {
      if (p.field === "sceneLabels") {
        for (const node of sceneNodes(sceneNumberOfKicker())) markEditing(node, p, "collab-live-edit");
        continue;
      }
      const inputId = FIELD_INPUT_IDS[p.field];
      const wrap = inputId ? wrapperFor(inputId) : null;
      if (wrap) markEditing(wrap, p, "collab-field-remote");
      for (const cid of canvasIdsForField(p.field)) {
        const node = document.getElementById(cid);
        if (!isShown(node)) continue;
        markEditing(node, p, "collab-live-edit");
        const host = node.closest?.("#editor-popover, #canvas-slide, #canvas-caption");
        if (host && host !== node) markEditing(host, p, "collab-live-host");
      }
    }
  }

  function setLocks(map) {
    locks = map;
    paintFilmstrip();
  }

  /** Passo travado por outra pessoa: faixa no painel + campos somente leitura (inert). */
  function paintLockBanner(stepId, opts) {
    const { holder, canTakeOver, onTakeOver } = opts || {};
    const body = document.getElementById("props-body");
    lockBanner?.remove();
    lockBanner = null;
    const readOnlyAll = document.body.classList.contains("collab-readonly");
    if (!holder || !stepId) {
      if (body && !readOnlyAll) body.removeAttribute("inert");
      return;
    }
    if (body) body.setAttribute("inert", "");
    lockBanner = el("div", { class: "collab-lock-banner", role: "status" },
      el("span", { class: "collab-avatar collab-avatar-sm", style: `background:${holder.color};color:${AVATAR_TEXT}`, "aria-hidden": "true" }, holder.initials || "?"),
      el("span", { class: "collab-lock-text" }, t("collab.lock.editing", { name: holder.name })),
      canTakeOver
        ? el("button", { type: "button", class: "btn btn-sm", onclick: () => onTakeOver?.() }, t("collab.lock.takeover"))
        : el("span", { class: "collab-lock-hint" }, t("collab.lock.takeoverWait")));
    const panel = document.getElementById("props-panel");
    panel?.insertBefore(lockBanner, document.getElementById("props-rail") || panel.firstChild);
  }

  /* ---------- papéis, status, banner ---------- */

  function applyPermissions(perms, { readOnlyText = "" } = {}) {
    document.body.classList.add("collab-on");
    document.body.classList.toggle("collab-readonly", !perms.canEdit);
    document.body.classList.toggle("collab-guest", !perms.seeBilling);
    const body = document.getElementById("props-body");
    if (body) {
      if (!perms.canEdit) body.setAttribute("inert", "");
      else if (!lockBanner) body.removeAttribute("inert");
    }
    if (banner) {
      banner.hidden = !readOnlyText;
      banner.textContent = readOnlyText || "";
    }
    for (const sel of ["#btn-share-publish", "#btn-share-revoke", "#btn-share-republish", "#btn-results", "#btn-share-embed", "#btn-account-billing"]) {
      document.querySelectorAll(sel).forEach((n) => {
        if (!perms.canPublish && !sel.includes("billing")) n.toggleAttribute("data-collab-hidden", true);
        else if (!perms.seeBilling && sel.includes("billing")) n.toggleAttribute("data-collab-hidden", true);
        else n.removeAttribute("data-collab-hidden");
      });
    }
    document.querySelectorAll("#btn-new-project, .library-create-card").forEach((n) => n.toggleAttribute("data-collab-hidden", !perms.canCreateProject));
  }

  function setStatus({ online = true, pending = 0, syncing = false } = {}) {
    if (!statusEl) return;
    let text = "";
    let kind = "";
    if (!online) {
      text = pending ? `${t("collab.status.offline")} · ${t("collab.status.pending", { n: pending })}` : t("collab.status.offline");
      kind = "offline";
    } else if (syncing || pending) {
      text = pending ? t("collab.status.pending", { n: pending }) : t("collab.status.syncing");
      kind = "syncing";
    } else {
      // tudo confirmado pelo servidor: salvo na nuvem do projeto (vale para convidado sem plano próprio)
      text = t("collab.status.saved");
      kind = "saved";
    }
    statusEl.hidden = !text;
    statusEl.textContent = text;
    statusEl.dataset.kind = kind;
    statusEl.setAttribute("role", "status");
  }

  /* ---------- toasts e avisos ---------- */

  function toast({ text, actionLabel = "", onAction = null, ms = 6000 }) {
    if (!toasts) return () => {};
    const item = el("div", { class: "collab-toast", role: "status" }, el("span", { class: "collab-toast-text" }, text));
    const close = () => item.remove();
    if (actionLabel && onAction) {
      item.append(el("button", { type: "button", class: "collab-toast-action", onclick: () => { onAction(); close(); } }, actionLabel));
    }
    toasts.append(item);
    while (toasts.children.length > 3) toasts.firstChild.remove();
    const timer = setTimeout(close, ms);
    item.addEventListener("remove", () => clearTimeout(timer));
    return close;
  }

  function sceneNumberOfKicker() {
    const kicker = document.getElementById("canvas-slide-kicker");
    return kicker?.dataset?.scene ? [kicker.dataset.scene] : [];
  }

  /** Rótulo da cena no filmstrip e, se for a cena deste slide, o kicker. */
  function sceneNodes(sceneNumbers) {
    const nodes = [];
    for (const n of sceneNumbers || []) {
      const label = document.querySelector(`.film-scene[data-scene="${CSS.escape(String(n))}"] .film-scene-label`);
      if (label) nodes.push(label);
      const kicker = document.getElementById("canvas-slide-kicker");
      if (kicker && String(kicker.dataset.scene) === String(n) && isShown(kicker)) nodes.push(kicker);
    }
    return nodes;
  }

  function flashNodes(nodes, { color = "", name = "" } = {}) {
    for (const node of nodes) {
      if (!node) continue;
      if (color) node.style.setProperty("--collab-color", color);
      if (name) node.setAttribute("data-collab-by", name);
      node.classList.add("collab-field-flash", "collab-updated");
      const key = node.id || node;
      clearTimeout(flashTimers.get(key));
      flashTimers.set(key, setTimeout(() => {
        node.classList.remove("collab-field-flash", "collab-updated");
        if (!node.classList.contains("collab-live-edit") && !node.classList.contains("collab-field-remote") && !node.classList.contains("collab-live-host")) {
          node.removeAttribute("data-collab-by");
          node.style.removeProperty("--collab-color");
        }
      }, 2200));
    }
  }

  /** Pulso curto no campo (inspetor e texto do palco) quando o valor chega de outra pessoa. */
  function flashField(inputId, { color = "", name = "" } = {}) {
    const field = fieldForDomTarget({ id: inputId });
    const nodes = [];
    const wrap = inputId ? wrapperFor(inputId) : null;
    if (wrap) nodes.push(wrap);
    for (const cid of canvasIdsForField(field)) {
      const node = document.getElementById(cid);
      if (isShown(node)) nodes.push(node);
    }
    flashNodes(nodes, { color, name });
  }

  /** Faixa inline no campo em foco: "Ana alterou este campo — Ver versão dela · Manter a minha". */
  function showInlineConflict({ key, inputId, name, onTheirs, onMine }) {
    const wrap = wrapperFor(inputId);
    if (!wrap) return null;
    wrap.querySelectorAll(`.collab-conflict[data-key="${CSS.escape(key)}"]`).forEach((n) => n.remove());
    const node = el("div", { class: "collab-conflict", role: "alert", "data-key": key },
      el("span", { class: "collab-conflict-text" }, t("collab.conflict.inline", { name })),
      el("button", { type: "button", class: "btn btn-sm", onclick: () => { node.remove(); onTheirs(); } }, t("collab.conflict.seeTheirs")),
      el("button", { type: "button", class: "btn btn-sm btn-primary", onclick: () => { node.remove(); onMine(); } }, t("collab.conflict.keepMine")));
    wrap.append(node);
    return () => node.remove();
  }

  /** Texto longo (legenda/texto): duas versões lado a lado (empilhadas no celular). */
  function showConflictDialog({ name, mine, theirs, onTheirs, onMine }) {
    const dlg = el("dialog", { class: "studio-modal collab-dialog collab-conflict-dialog", "aria-labelledby": "collab-conflict-title" });
    const finish = (fn) => { dlg.close(); dlg.remove(); fn(); };
    dlg.append(
      el("h3", { id: "collab-conflict-title" }, t("collab.conflict.title")),
      el("div", { class: "collab-conflict-cols" },
        el("section", {}, el("h4", {}, t("collab.conflict.mine")), el("p", { class: "collab-conflict-text-box" }, String(mine ?? ""))),
        el("section", {}, el("h4", {}, t("collab.conflict.theirs", { name })), el("p", { class: "collab-conflict-text-box" }, String(theirs ?? "")))),
      el("div", { class: "collab-dialog-actions" },
        el("button", { type: "button", class: "btn", onclick: () => finish(onTheirs) }, t("collab.conflict.useTheirs")),
        el("button", { type: "button", class: "btn btn-primary", onclick: () => finish(onMine) }, t("collab.conflict.useMine"))));
    document.body.append(dlg);
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); });
    dlg.showModal();
    return () => { try { dlg.close(); } catch { /* ignore */ } dlg.remove(); };
  }

  /** "Este passo foi removido por Ana" + Restaurar (recria com o conteúdo do usuário e id novo). */
  function showStepRemoved({ name, onRestore }) {
    removedBanner?.remove();
    removedBanner = el("div", { class: "collab-removed-banner", role: "alert" },
      el("span", {}, t("collab.step.removed", { name })),
      el("button", { type: "button", class: "btn btn-sm btn-primary", onclick: () => { removedBanner?.remove(); removedBanner = null; onRestore(); } }, t("collab.step.restore")),
      el("button", { type: "button", class: "btn btn-sm btn-ghost", "aria-label": t("collab.members.close"), onclick: () => { removedBanner?.remove(); removedBanner = null; } }, "×"));
    document.getElementById("props-panel")?.insertBefore(removedBanner, document.getElementById("props-rail") || null);
  }

  /** Diálogo genérico (paywall, acesso perdido): título, texto, botões. */
  function showMessage({ title, text, actions = [] }) {
    const dlg = el("dialog", { class: "studio-modal collab-dialog", "aria-labelledby": "collab-msg-title" });
    const close = () => { try { dlg.close(); } catch { /* ignore */ } dlg.remove(); };
    dlg.append(
      el("h3", { id: "collab-msg-title" }, title),
      el("p", {}, text),
      el("div", { class: "collab-dialog-actions" },
        actions.map((a) => el("button", { type: "button", class: `btn${a.primary ? " btn-primary" : ""}`, onclick: () => { close(); a.onClick?.(); } }, a.label))));
    document.body.append(dlg);
    dlg.showModal();
    return close;
  }

  /** Membros e convites (dono convida; todos veem quem está; não-dono sai). */
  function openMembers({ members = [], invites = [], you, perms, onInvite, onRole, onRemove, onLeave, onRevoke, canRoleEdit = false, host = null }) {
    document.getElementById("collab-members-dialog")?.remove();
    const dlg = host || el("dialog", { class: "studio-modal collab-dialog collab-members-dialog", id: "collab-members-dialog", "aria-labelledby": "collab-members-title" });
    if (host) host.replaceChildren();
    const close = host ? () => {} : () => { try { dlg.close(); } catch { /* ignore */ } dlg.remove(); };
    const list = el("ul", { class: "collab-members-list" });
    for (const m of members) {
      const p = { color: m.color, initials: m.initials, idle: false, name: m.name };
      const row = el("li", { class: "collab-member" }, avatar(p, { size: "md" }),
        el("span", { class: "collab-member-name" }, m.name, m.userId === you?.userId ? ` (${t("collab.you")})` : "", m.email ? el("small", {}, m.email) : null));
      if (perms.canManageMembers && !m.isOwner && canRoleEdit) {
        const sel = el("select", { "aria-label": t("collab.invite.role"), onchange: (e) => onRole(m, e.target.value) },
          ["editor", "commenter", "viewer"].map((r) => el("option", { value: r, selected: r === m.role }, t(`collab.role.${r}`))));
        row.append(sel, el("button", { type: "button", class: "btn btn-sm btn-ghost", onclick: () => onRemove(m) }, t("collab.members.remove")));
      } else row.append(el("span", { class: "collab-role-chip" }, t(`collab.role.${m.role}`)));
      list.append(row);
    }
    dlg.append(el("h3", { id: "collab-members-title" }, t("collab.members.title")), list);
    if (perms.canInvite) {
      const status = el("p", { class: "collab-invite-status", role: "status" });
      const email = el("input", { type: "email", id: "collab-invite-email", autocomplete: "off", required: true, placeholder: "ana@empresa.com" });
      const role = el("select", { id: "collab-invite-role", "aria-label": t("collab.invite.role") }, ["editor", "commenter", "viewer"].map((r) => el("option", { value: r }, t(`collab.role.${r}`))));
      const send = el("button", { type: "submit", class: "btn btn-primary" }, t("collab.invite.send"));
      const form = el("form", { class: "collab-invite-form", novalidate: true }, el("h4", {}, t("collab.invite.title")),
        el("label", { for: "collab-invite-email" }, t("collab.invite.email")), email, role, send, status);
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        send.disabled = true;
        send.textContent = t("collab.invite.sending");
        try {
          const res = await onInvite({ email: email.value.trim(), role: role.value });
          status.textContent = res.message || "";
          status.dataset.kind = res.ok ? "ok" : "error";
          status.replaceChildren(res.message || "");
          if (res.link) status.append(" ", el("button", { type: "button", class: "btn btn-sm", onclick: async () => { try { await navigator.clipboard.writeText(res.link); status.dataset.copied = "1"; announce(t("collab.invite.copied")); } catch { /* ignore */ } } }, t("collab.invite.copy")));
          if (res.ok) email.value = "";
        } finally {
          send.disabled = false;
          send.textContent = t("collab.invite.send");
        }
      });
      dlg.append(form);
      const pend = invites.filter((i) => i.status === "pending");
      if (pend.length) {
        dlg.append(el("h4", {}, t("collab.invite.pending")), el("ul", { class: "collab-invites-list" },
          pend.map((i) => el("li", {}, `${i.email} · ${t(`collab.role.${i.role}`)}`, el("button", { type: "button", class: "btn btn-sm btn-ghost", onclick: () => onRevoke(i) }, t("collab.invite.revoke"))))));
      }
    }
    const foot = el("div", { class: "collab-dialog-actions" });
    if (!perms.canManageMembers && you) foot.append(el("button", { type: "button", class: "btn", onclick: () => { close(); onLeave(); } }, t("collab.members.leave")));
    if (!host) foot.append(el("button", { type: "button", class: "btn btn-primary", onclick: close }, t("collab.members.close")));
    if (foot.childNodes.length) dlg.append(foot);
    if (host) return close;
    dlg.addEventListener("close", () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
    return close;
  }

  /** Tela de convite (#/join/<token>): sempre mostra o que vai acontecer antes de aceitar. */
  function showJoin({ roleLabel, project = "", status = "ready", message = "", onAccept, onLater }) {
    document.getElementById("collab-join-dialog")?.remove();
    const dlg = el("dialog", { class: "studio-modal collab-dialog collab-join-dialog", id: "collab-join-dialog", "aria-labelledby": "collab-join-title" });
    const close = () => { try { dlg.close(); } catch { /* ignore */ } dlg.remove(); };
    const body = [el("h3", { id: "collab-join-title" }, t("collab.join.title"))];
    if (status === "ready") body.push(el("p", {}, project ? t("collab.join.body", { role: roleLabel, project }) : t("collab.join.bodyGeneric")));
    if (message) body.push(el("p", { class: "collab-join-msg", role: "alert", "data-kind": status }, message));
    const actions = el("div", { class: "collab-dialog-actions" });
    if (status === "ready" || status === "busy") {
      const accept = el("button", { type: "button", class: "btn btn-primary", onclick: () => onAccept?.() }, status === "busy" ? t("collab.join.accepting") : t("collab.join.accept"));
      if (status === "busy") accept.disabled = true;
      actions.append(el("button", { type: "button", class: "btn btn-ghost", onclick: () => { close(); onLater?.(); } }, t("collab.join.later")), accept);
    } else actions.append(el("button", { type: "button", class: "btn btn-primary", onclick: () => { close(); onLater?.(); } }, t("collab.access.ok")));
    dlg.append(...body, actions);
    document.body.append(dlg);
    dlg.addEventListener("cancel", (e) => { if (status === "busy") e.preventDefault(); });
    dlg.showModal();
    return close;
  }

  /** Lista "Compartilhados comigo" na biblioteca. */
  function renderShared(listEl, items, { onOpen }) {
    if (!listEl) return;
    listEl.replaceChildren();
    listEl.hidden = !items.length;
    if (!items.length) return;
    listEl.append(el("h3", { class: "collab-shared-title" }, t("collab.shared.title")));
    const ul = el("ul", { class: "collab-shared-list" });
    for (const it of items) {
      ul.append(el("li", {}, el("button", { type: "button", class: "collab-shared-item", onclick: () => onOpen(it) },
        el("strong", {}, it.name || "—"), el("small", {}, `${t("collab.shared.owner", { name: it.owner?.name || "" })} · ${t(`collab.role.${it.role}`)}`))));
    }
    listEl.append(ul);
  }

  return {
    mount, unmount, announce, setPeople, paintStack, paintFilmstrip, paintFieldMarks, setLocks, paintLockBanner,
    sceneNodes, flashNodes,
    applyPermissions, setStatus, toast, flashField, showInlineConflict, showConflictDialog, showStepRemoved, showMessage,
    openMembers, showJoin, renderShared,
    isMounted: () => mounted,
    stackButton: () => stack,
    isCompact,
  };
}
